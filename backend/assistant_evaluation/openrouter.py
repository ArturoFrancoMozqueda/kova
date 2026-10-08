"""Evaluation-only transport. Never imported by the production assistant."""

import json
import math
import time
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal

import httpx

BASE = "https://openrouter.ai/api/v1"
MAX_OUTPUT = 1024
MAX_REQUEST_SECONDS = 60
MIN_POST_INTERVAL_SECONDS = 2


class EvaluationBlocked(Exception):
    """Fixed diagnostic codes only; never copy remote bodies or credentials."""

    def __init__(self, code, *, diagnostics=None):
        super().__init__(code)
        self.diagnostics = diagnostics


@dataclass(frozen=True)
class Candidate:
    model: str
    route: str
    provider: str
    input_nanousd: int
    output_nanousd: int
    reasoning_enabled: bool | None = None


# Conservative ceilings, without temporary discounts or cache savings.
# Verified public endpoint catalog and ZDR list on 2026-10-07.
CANDIDATES = {
    "glm-flash": Candidate("z-ai/glm-5.3-flash", "fireworks", "Fireworks", 150, 500),
    "glm-deepinfra": Candidate("z-ai/glm-5.3-flash", "deepinfra/fp4", "DeepInfra", 150, 500),
    "qwen-38": Candidate("qwen/qwen3.8-27b", "deepinfra/bf16", "DeepInfra", 200, 2500),
    "qwen-fast": Candidate("qwen/qwen3.8-27b", "deepinfra/bf16", "DeepInfra", 200, 2500,
                           reasoning_enabled=False),
    "qwen-coreweave-fast": Candidate("qwen/qwen3.8-27b", "coreweave/fp8", "CoreWeave",
                                    400, 3000, reasoning_enabled=False),
    "mistral-small": Candidate("mistralai/mistral-small-2603", "mistral/zdr", "Mistral",
                               150, 600, reasoning_enabled=False),
    "mistral-us": Candidate("mistralai/mistral-small-2603", "mistral/us", "Mistral",
                            165, 660, reasoning_enabled=False),
    "deepseek-flash": Candidate("deepseek/deepseek-v4.1-flash", "deepinfra/fp8", "DeepInfra",
                                200, 600),
    "deepseek-fast": Candidate("deepseek/deepseek-v4.1-flash", "deepinfra/fp8", "DeepInfra",
                               200, 600, reasoning_enabled=False),
}


def nanousd(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0:
            raise ValueError
        return int((amount * 1_000_000_000).to_integral_value(rounding=ROUND_CEILING))
    except (ValueError, ArithmeticError):
        raise EvaluationBlocked("invalid_cost") from None


def validate_ledger(ledger):
    if not isinstance(ledger, list):
        raise EvaluationBlocked("invalid_ledger")
    for row in ledger:
        if not isinstance(row, dict):
            raise EvaluationBlocked("invalid_ledger")
        charge = row.get("charge_nanousd", 0)
        if type(charge) is not int or charge < 0 or row.get("paid") and "charge_nanousd" not in row:
            raise EvaluationBlocked("invalid_ledger")


def reserve(ledger, candidate, input_tokens, budget_nanousd):
    validate_ledger(ledger)
    if type(input_tokens) is not int or not 0 <= input_tokens <= 8000:
        raise EvaluationBlocked("context_limit")
    if type(budget_nanousd) is not int or not 0 < budget_nanousd <= 10_000_000_000:
        raise EvaluationBlocked("invalid_budget")
    prompt_bound = math.ceil((input_tokens + 256) * 1.15)
    charge = prompt_bound * candidate.input_nanousd + MAX_OUTPUT * candidate.output_nanousd
    if sum(row.get("charge_nanousd", 0) for row in ledger) + charge > budget_nanousd:
        raise EvaluationBlocked("evaluation_budget")
    receipt = {"at": time.time(), "groq": False, "provider": "openrouter", "paid": True,
               "model": candidate.model, "route": candidate.route,
               "input_tokens": prompt_bound, "output_tokens": MAX_OUTPUT,
               "amount": prompt_bound + MAX_OUTPUT, "charge_nanousd": charge}
    ledger.append(receipt)
    return receipt


def reconcile(receipt, usage):
    """Release only verified charges; reasoning is part of completion, not added twice."""
    if not isinstance(usage, dict):
        return False
    counts = [usage.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")]
    details = usage.get("completion_tokens_details")
    if (not all(type(v) is int and v >= 0 for v in counts) or counts[0] == 0
            or counts[2] != counts[0] + counts[1] or not isinstance(details, dict)
            or type(details.get("reasoning_tokens")) is not int
            or not 0 <= details["reasoning_tokens"] <= counts[1] or usage.get("cost") is None):
        return False
    actual = nanousd(usage["cost"])
    if (counts[0] > receipt["input_tokens"] or counts[1] > receipt["output_tokens"]
            or actual > receipt["charge_nanousd"]):
        raise EvaluationBlocked("usage_exceeded_reservation")
    receipt.update(charge_nanousd=actual, amount=counts[2], usage_verified=True)
    return True


def validate_endpoint(candidate, endpoints, zdr):
    endpoint = next((row for row in endpoints if row.get("tag") == candidate.route
                     and row.get("model_id") == candidate.model), None)
    private = any(row.get("tag") == candidate.route and row.get("model_id") == candidate.model
                  and row.get("status") == 0 for row in zdr)
    required = {"tools", "tool_choice", "structured_outputs", "response_format",
                "reasoning", "max_tokens"}
    if (not endpoint or endpoint.get("status") != 0 or not private
            or endpoint.get("provider_name") != candidate.provider
            or not required <= set(endpoint.get("supported_parameters", []))
            or endpoint.get("context_length", 0) < 10000
            or endpoint.get("max_completion_tokens", 0) < MAX_OUTPUT):
        raise EvaluationBlocked("endpoint_unavailable_or_incompatible")
    rates = endpoint.get("pricing", {})
    if (nanousd(rates.get("prompt")) > candidate.input_nanousd
            or nanousd(rates.get("completion")) > candidate.output_nanousd
            or rates.get("overrides")
            or any(nanousd(rates.get(key, 0)) for key in ("request", "image", "web_search"))):
        raise EvaluationBlocked("endpoint_price_changed")
    return {"model": candidate.model, "route": candidate.route, "provider": candidate.provider,
            "zdr": True, "structured_outputs": True, "tools": True,
            "input_usd_per_million": str(Decimal(candidate.input_nanousd) / 1000),
            "output_usd_per_million": str(Decimal(candidate.output_nanousd) / 1000)}


def validate_account(data, budget_nanousd):
    if (data.get("is_free_tier") is not False or data.get("is_management_key") is not False
            or data.get("limit_reset") is not None or data.get("limit") is None
            or data.get("limit_remaining") is None):
        raise EvaluationBlocked("dedicated_capped_key_required")
    limit = nanousd(data["limit"])
    remaining = nanousd(data["limit_remaining"])
    if not 0 < limit <= budget_nanousd or not 0 < remaining <= limit:
        raise EvaluationBlocked("account_budget")
    return {"key_limit_nanousd": limit, "key_remaining_nanousd": remaining,
            "balance_check": "operator_required"}


class Client:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self._last_inference_started = None

    def request(self, method, path, body=None, *, authenticated=False):
        if authenticated and not self.api_key:
            raise EvaluationBlocked("missing_evaluation_key")
        headers = {"Authorization": "Bearer " + self.api_key} if authenticated else {}
        if method == "POST":
            # Conservative serial probing, not a claim about the vendor's quota.
            # This spaces new requests; it never retries a failed paid request.
            if self._last_inference_started is not None:
                delay = self._last_inference_started + MIN_POST_INTERVAL_SECONDS - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
            self._last_inference_started = time.monotonic()
        started = time.monotonic()
        try:
            with httpx.Client(timeout=60, follow_redirects=False, trust_env=False) as client:
                with client.stream(method, BASE + path, json=body, headers=headers) as response:
                    if response.status_code != 200:
                        diagnostic = {}
                        for header in ("retry-after", "x-ratelimit-limit",
                                       "x-ratelimit-remaining", "x-ratelimit-reset"):
                            value = response.headers.get(header, "")
                            if value.isdigit() and len(value) <= 16:
                                diagnostic[header] = int(value)
                        payload = bytearray()
                        for chunk in response.iter_bytes():
                            payload.extend(chunk)
                            if len(payload) > 65536:
                                break
                        if len(payload) <= 65536:
                            try:
                                metadata = json.loads(payload).get("error", {}).get("metadata", {})
                                for key, allowed in {
                                    "error_type": {"rate_limit_exceeded"},
                                    "provider_name": {c.provider for c in CANDIDATES.values()},
                                    "limit_source": {"openrouter_in_flight_budget",
                                                     "openrouter_credits", "openrouter_key_limit"},
                                    "reason": {"in_flight_budget_exhausted",
                                               "weight_exceeds_budget"},
                                }.items():
                                    if (isinstance(metadata.get(key), str)
                                            and metadata[key] in allowed):
                                        diagnostic[key] = metadata[key]
                            except (ValueError, AttributeError):
                                pass
                        raise EvaluationBlocked(f"provider_http_{response.status_code}",
                                                diagnostics=diagnostic)
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        # Streaming whitespace must not reset the request deadline.
                        if time.monotonic() - started >= MAX_REQUEST_SECONDS:
                            raise EvaluationBlocked("provider_response_deadline")
                        content.extend(chunk)
                        if len(content) > (4_000_000 if method == "GET" else 1_000_000):
                            raise EvaluationBlocked("provider_response_too_large")
                    data = json.loads(content)
            if not isinstance(data, dict) or data.get("error"):
                raise EvaluationBlocked("provider_invalid_response")
            return data
        except (httpx.HTTPError, ValueError, TypeError):
            raise EvaluationBlocked("provider_transport_failed") from None

    def preflight(self, candidate):
        endpoints = self.request("GET", "/models/" + candidate.model + "/endpoints")
        zdr = self.request("GET", "/endpoints/zdr")
        result = validate_endpoint(candidate, endpoints["data"]["endpoints"], zdr["data"])
        catalog = self.request("GET", "/models")
        model = next((row for row in catalog["data"] if row.get("id") == candidate.model), {})
        reasoning = model.get("reasoning", {})
        if candidate.reasoning_enabled is False:
            if reasoning.get("mandatory") is not False:
                raise EvaluationBlocked("reasoning_disable_not_supported")
        elif "low" not in (reasoning.get("supported_efforts") or []):
            raise EvaluationBlocked("reasoning_effort_not_supported")
        result["reasoning_mode"] = "disabled" if candidate.reasoning_enabled is False else "low"
        return result

    def account(self, budget_nanousd):
        key = self.request("GET", "/key", authenticated=True)
        # /credits requires a management key. Never request account-management
        # privileges just to run inference; balance is verified in the console.
        return validate_account(key["data"], budget_nanousd)

    @staticmethod
    def body(candidate, messages, tools, *, structured, allowed_source_ids=None):
        from app.assistant import provider

        body = {"model": candidate.model,
                "messages": provider.generation_messages(messages, structured=structured),
                "stream": False, "max_tokens": MAX_OUTPUT,
                "reasoning": {"effort": "low", "exclude": True},
                "provider": {"only": [candidate.route], "allow_fallbacks": False,
                             "require_parameters": True, "data_collection": "deny", "zdr": True,
                             "max_price": {"prompt": candidate.input_nanousd / 1000,
                                           "completion": candidate.output_nanousd / 1000}}}
        if candidate.reasoning_enabled is False:
            body["reasoning"] = {"enabled": False, "exclude": True}
        if tools:
            if structured:
                raise EvaluationBlocked("final_tools_forbidden")
            body.update(tools=provider.planning_tools(tools), tool_choice="auto")
        if structured:
            body["response_format"] = provider.groq_response_format(allowed_source_ids)
        return body

    def generate(self, candidate, body, *, structured):
        from app.assistant import provider

        result = self.request("POST", "/chat/completions", body, authenticated=True)
        if result.get("provider") != candidate.provider:
            raise EvaluationBlocked("unexpected_provider")
        choices = result.get("choices")
        if not isinstance(choices, list) or len(choices) != 1:
            raise EvaluationBlocked("invalid_completion")
        choice = choices[0]
        message = choice.get("message")
        if (not isinstance(message, dict) or message.get("refusal")
                or choice.get("finish_reason") not in {"stop", "tool_calls"}):
            raise EvaluationBlocked("incomplete_or_refused_completion")
        content = message.get("content") or ""
        if candidate.reasoning_enabled is False:
            usage = result.get("usage") or {}
            details = usage.get("completion_tokens_details") or {}
            reasoning = details.get("reasoning_tokens")
            if type(reasoning) is not int or reasoning != 0:
                raise EvaluationBlocked("disabled_reasoning_not_verified")
        if structured:
            content = provider._normalize_groq_answer(content)
        return {"content": content, "tool_calls": message.get("tool_calls") or [],
                "usage": result.get("usage")}
