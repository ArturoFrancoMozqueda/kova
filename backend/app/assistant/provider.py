"""Fixed provider egress, bounded output, no built-in network/code tools."""

import json
import math
import re

import httpx
from fastapi import HTTPException

from app.assistant.budget import RATES
from app.assistant.schemas import Answer
from app.config import settings

EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b"
GROQ_MODEL = "openai/gpt-oss-20b"


def chat_consent_valid(data: dict) -> bool:
    # Historical consent was collected for Cloudflare. Switching the recipient
    # requires a fresh acceptance; neither a deployment nor a flag grants it.
    return bool(data.get("chat_consent") and data.get("chat_provider", "cloudflare")
                == settings.assistant_generation_provider)


def cloudflare_ready() -> bool:
    return bool(
        settings.assistant_provider_verified
        and re.fullmatch(r"[a-fA-F0-9]{32}", settings.assistant_cloudflare_account_id)
        and settings.assistant_cloudflare_token
    )


def ready() -> bool:
    if settings.assistant_generation_provider == "groq":
        return bool(
            settings.assistant_provider_verified
            and settings.assistant_groq_api_key
            and settings.assistant_groq_free_verified
            and settings.assistant_groq_zdr_verified
            and settings.assistant_groq_quality_verified
            and settings.assistant_groq_model in groq_models()
        )
    return cloudflare_ready()


def groq_models() -> set[str]:
    # The larger model is a comparator, never an automatic production fallback.
    return {GROQ_MODEL, "openai/gpt-oss-120b"} if settings.app_env == "local" else {GROQ_MODEL}


def planning_tools(tools):
    if settings.assistant_generation_provider != "groq":
        return tools

    def compact(schema):
        # Drop documentation annotations, never types, limits or field names.
        result = {key: value for key, value in schema.items() if key not in {"title", "default"}}
        if "properties" in result:
            result["properties"] = {key: compact(value)
                                    for key, value in result["properties"].items()}
        if isinstance(result.get("items"), dict):
            result["items"] = compact(result["items"])
        for key in ("anyOf", "oneOf", "allOf"):
            if key in result:
                result[key] = [compact(value) for value in result[key]]
        return result

    return [{**tool, "function": {**tool["function"], "parameters": compact(
        tool["function"].get("parameters", {})
    )}} for tool in tools]


def _call_groq(body: dict) -> dict:
    if not ready() or body.get("model") not in groq_models():
        raise HTTPException(503, "El proveedor de IA aún no está configurado.")
    assert settings.assistant_groq_api_key is not None
    try:
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
            with client.stream(
                "POST", "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": "Bearer "
                         + settings.assistant_groq_api_key.get_secret_value()},
                json=body,
            ) as response:
                if response.status_code == 429:
                    # Never copy a remote error body or arbitrary header into the UI.
                    retry = response.headers.get("retry-after", "60")
                    seconds = min(86400, max(1, math.ceil(float(retry)))) if re.fullmatch(
                        r"\d+(?:\.\d+)?", retry
                    ) else 60
                    raise HTTPException(
                        429, "La IA alcanzó un límite temporal. La ayuda y los reportes "
                        "directos siguen disponibles.",
                        headers={"Retry-After": str(seconds),
                                 "X-Kova-Assistant-Limit": "temporary"},
                    )
                if response.status_code != 200:
                    # Keep only a recognized diagnostic code, never remote text
                    # (which can contain the prompt, failed generation or data).
                    payload = bytearray()
                    for chunk in response.iter_bytes():
                        payload.extend(chunk)
                        if len(payload) > 65536:
                            break
                    code = None
                    if len(payload) <= 65536:
                        try:
                            code = json.loads(payload).get("error", {}).get("code")
                        except (ValueError, AttributeError):
                            pass
                    recognized = code in {"tool_use_failed", "json_validate_failed",
                                          "model_not_found", "invalid_api_key"}
                    raise HTTPException(503, "El proveedor de IA no está disponible.",
                        headers={"X-Kova-Assistant-Provider-Error": code} if recognized else None)
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) > 1_000_000:
                        raise HTTPException(503, "Respuesta de IA demasiado extensa.")
                data = json.loads(content)
        choices = data.get("choices")
        if not isinstance(choices, list) or len(choices) != 1:
            raise HTTPException(503, "Respuesta de IA no verificable.")
        choice = choices[0]
        if choice.get("finish_reason") not in {"stop", "tool_calls"}:
            raise HTTPException(422, "La respuesta quedó incompleta. Acota tu consulta.")
        if not isinstance(choice.get("message"), dict) or choice["message"].get("refusal"):
            raise HTTPException(422, "No se pudo responder esta consulta con IA.")
        return data
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(503, "No se pudo completar la consulta de IA.") from None


def groq_response_format(allowed_source_ids: list[str] | None = None) -> dict:
    from app.assistant.executor import ALLOWED_FIELDS

    actions = sorted(set(ALLOWED_FIELDS) - {"invitation", "catalog_import"})
    # Use an internal closed schema. The public Step.values object remains intact;
    # entries represent explicitly supplied fields, preserving omitted vs null.
    step = {
        "type": "object", "additionalProperties": False,
        "required": ["action", "resource_id", "values"],
        "properties": {
            "action": {"type": "string", "enum": actions},
            "resource_id": {"type": ["string", "null"]},
            "values": {"type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "required": ["key", "value"], "properties": {
                    "key": {"type": "string", "enum": sorted(set().union(
                        *(ALLOWED_FIELDS[action] for action in actions)
                    ))},
                    "value": {"anyOf": [{"type": kind} for kind in
                                         ("string", "integer", "boolean", "null")]},
                },
            }},
        },
    }
    sources = {"type": "string"}
    if allowed_source_ids:
        sources["enum"] = allowed_source_ids
    schema = {
        "type": "object", "additionalProperties": False,
        "required": ["answer", "source_ids", "steps"], "properties": {
            "answer": {"type": "string", "pattern": "^[^0-9<>]*$"},
            "source_ids": {"type": "array", "items": sources},
            "steps": {"type": "array", "items": step},
        },
    }
    if not settings.assistant_mutations_enabled:
        # Read-only output has no proposal field at all. An empty object schema
        # is rejected by Groq's decoder; Kova restores its public empty steps.
        del schema["properties"]["steps"]
        schema["required"].remove("steps")
    if allowed_source_ids is not None and not allowed_source_ids:
        # Numerical tools have cards, not document source IDs. Never invite the
        # decoder to invent a citation when retrieval produced no sources.
        schema["properties"]["source_ids"]["maxItems"] = 0
    # Semantics, lengths, UUIDs, citation ACLs and disabled actions are still
    # validated by Kova. Strict JSON is not an authorization boundary.
    return {"type": "json_schema", "json_schema": {
        "name": "kova_answer", "strict": True, "schema": schema,
    }}


def _normalize_groq_answer(content: str) -> str:
    answer = json.loads(content)
    if not settings.assistant_mutations_enabled:
        answer["steps"] = []
    for step in answer["steps"]:
        values = {}
        for entry in step["values"]:
            if entry["key"] in values:
                raise HTTPException(422, "La propuesta repitió un campo de configuración.")
            values[entry["key"]] = entry["value"]
        step["values"] = values
    return json.dumps(answer, ensure_ascii=False)


def generation_messages(messages, *, structured: bool):
    """Use the same provider instructions for reservation and transport."""
    messages = [dict(message) for message in messages]
    if structured and settings.assistant_generation_provider == "groq":
        output_instruction = (
            "En steps, values usa pares {key,value} solo para campos solicitados; "
            "importes como cadenas."
            if settings.assistant_mutations_enabled else
            "Devuelve solo answer y source_ids; sin steps ni propuestas."
        )
        messages[0] = {**messages[0], "content": messages[0]["content"] + (
            "\n" + output_instruction + " Cita solo fuentes recuperadas en source_ids. "
            "answer no lleva dígitos ni medidas; remite cifras a tarjetas."
        )}
    return messages


def _generate_groq(messages, tools, *, model, structured, allowed_source_ids):
    if model not in groq_models() or model != settings.assistant_groq_model:
        raise HTTPException(503, "Modelo de generación no permitido.")
    if structured and tools:
        raise HTTPException(422, "La explicación final no admite herramientas.")
    messages = generation_messages(messages, structured=structured)
    body = {
        "model": model, "messages": messages, "stream": False,
        "reasoning_effort": "low", "include_reasoning": False,
        "max_completion_tokens": 1024,
    }
    if tools:
        body.update(tools=planning_tools(tools), parallel_tool_calls=False)
    if structured:
        body["response_format"] = groq_response_format(allowed_source_ids)
    result = _call_groq(body)
    message = result["choices"][0]["message"]
    content = message.get("content") or ""
    if structured:
        try:
            content = _normalize_groq_answer(content)
        except (ValueError, KeyError, TypeError):
            raise HTTPException(422, "La respuesta no cumplió el contrato de Kova.") from None
    return {"content": content, "tool_calls": message.get("tool_calls") or [],
            "usage": result.get("usage")}


def _call(model: str, body: dict, *, chat=False) -> dict:
    if not cloudflare_ready() or model not in RATES:
        raise HTTPException(503, "El proveedor de IA aún no está configurado.")
    base = (
        f"https://api.cloudflare.com/client/v4/accounts/{settings.assistant_cloudflare_account_id}"
    )
    url = base + ("/ai/v1/chat/completions" if chat else f"/ai/run/{model}")
    if chat:
        body = {**body, "model": model}
    assert settings.assistant_cloudflare_token is not None
    try:
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
            with client.stream(
                "POST",
                url,
                headers={
                    "Authorization": "Bearer "
                    + settings.assistant_cloudflare_token.get_secret_value(),
                },
                json=body,
            ) as response:
                if response.status_code == 429:
                    raise HTTPException(
                        429,
                        "El proveedor alcanzó su límite temporal.",
                        headers={"Retry-After": "60"},
                    )
                if response.status_code != 200:
                    raise HTTPException(503, "El proveedor de IA no está disponible.")
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) > 1_000_000:
                        raise HTTPException(503, "Respuesta de IA demasiado extensa.")
                data = json.loads(content)
            if chat:
                if not isinstance(data.get("choices"), list) or not data["choices"]:
                    raise HTTPException(503, "Respuesta de IA no verificable.")
                return data
            if not data.get("success") or not isinstance(data.get("result"), dict):
                raise HTTPException(503, "Respuesta de IA no verificable.")
            return data["result"]
    except (httpx.HTTPError, ValueError, KeyError):
        # Never include exception text, response body or request credentials.
        raise HTTPException(503, "No se pudo completar la consulta de IA.") from None


def read_only_response_format(allowed_source_ids: list[str] | None = None) -> dict | None:
    if not settings.assistant_mutations_enabled:
        schema = Answer.model_json_schema()
        schema.pop("$defs", None)
        schema["properties"]["answer"].pop("maxLength", None)
        schema["required"] = ["answer", "source_ids", "steps"]
        schema["properties"]["answer"]["pattern"] = "^[^0-9<>$]*$"
        if allowed_source_ids is not None:
            if allowed_source_ids:
                schema["properties"]["source_ids"]["items"] = {
                    "type": "string", "enum": allowed_source_ids,
                }
            else:
                schema["properties"]["source_ids"]["maxItems"] = 0
        schema["properties"]["steps"] = {
            "type": "array",
            "maxItems": 0,
            "items": {"type": "object", "properties": {}, "additionalProperties": False},
        }
        return {
            "type": "json_schema",
            "json_schema": schema,
        }
    return None


def generate(
    messages: list[dict], tools: list[dict], *, model: str, structured: bool = False,
    allowed_source_ids: list[str] | None = None,
) -> dict:
    if settings.assistant_generation_provider == "groq":
        return _generate_groq(
            messages, tools, model=model, structured=structured,
            allowed_source_ids=allowed_source_ids,
        )
    body = {
        "messages": messages,
        "store": False,
        "stream": False,
        "parallel_tool_calls": False,
    }
    # Workers AI rejects an empty tools array; omit it for the final explanation.
    if tools:
        body["tools"] = tools
    response_format = read_only_response_format(allowed_source_ids) if structured else None
    if response_format:
        body["response_format"] = response_format
    if model == "@cf/qwen/qwen3.8-27b":
        body.update(max_completion_tokens=1024, reasoning_effort="low")
    elif model in {"@cf/qwen/qwen3-30b-a3b-fp8", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"}:
        body.update(max_tokens=1024)
    else:
        raise HTTPException(503, "Modelo de generación no permitido.")
    if model == "@cf/meta/llama-3.3-70b-instruct-fp8-fast" and not structured:
        # The native Llama API consumes flat tools and textual tool-call history.
        if tools:
            body["tools"] = [tool["function"] for tool in tools]
        native_messages = []
        for message in messages:
            if message.get("tool_calls"):
                calls = []
                for call in message["tool_calls"]:
                    function = call.get("function", call)
                    arguments = function.get("arguments", {})
                    if isinstance(arguments, str):
                        arguments = json.loads(arguments)
                    calls.append({"name": function["name"], "arguments": arguments})
                native_messages.append(
                    {"role": "assistant", "content": json.dumps(calls, ensure_ascii=False)}
                )
            else:
                native_messages.append(
                    {"role": message["role"], "content": message.get("content") or ""}
                )
        body["messages"] = native_messages
        result = _call(model, body)
    else:
        result = _call(model, body, chat=True)
    # Both native Workers AI and compatible completion responses are supported.
    if "choices" in result:
        message = result["choices"][0]["message"]
        return {
            "content": message.get("content") or "",
            "tool_calls": message.get("tool_calls") or [],
            "usage": result.get("usage"),
        }
    content = result.get("response") or ""
    if isinstance(content, dict):
        content = json.dumps(content, ensure_ascii=False)
    return {
        "content": content,
        "tool_calls": result.get("tool_calls") or [],
        "usage": result.get("usage"),
    }


def embed(texts: list[str]) -> list[list[float]]:
    result = _call(EMBEDDING_MODEL, {"text": texts})
    vectors = result.get("data")
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        raise HTTPException(503, "Embeddings no verificables.")
    import math

    for vector in vectors:
        if (
            not isinstance(vector, list)
            or len(vector) != 1024
            or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in vector)
        ):
            raise HTTPException(503, "Dimensión de embeddings incompatible.")
    return vectors


def tokens_upper_bound(value: object) -> int:
    # One token cannot encode less than one UTF-8 byte. Reserve bytes instead
    # of optimistic character/4 heuristics until a verified tokenizer is used.
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
