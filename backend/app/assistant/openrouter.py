"""Fixed Mistral model/US recipient, ZDR, strict output and bounded inference."""

import asyncio
import hashlib
import json
import math
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import HTTPException

from app.assistant import deadline
from app.config import settings

MODEL = "mistralai/mistral-small-2603"
ROUTE = "mistral/us"
RECIPIENT = "Mistral"
ROUTES = (ROUTE,)
RECIPIENTS = (RECIPIENT,)
CONSENT_RECIPIENTS = "mistral"
INPUT_NANOUSD = 350
OUTPUT_NANOUSD = 750
MAX_OUTPUT = 1024
BASE = "https://openrouter.ai/api/v1"
PROFILE_FILES = (
    "app/assistant/openrouter.py", "app/assistant/generation.py",
    "app/assistant/grounding.py", "app/assistant/provider.py", "app/assistant/tools.py",
    "app/assistant/schemas.py", "app/assistant/knowledge.py", "app/assistant/direct.py",
    "app/assistant/deadline.py", "app/assistant/openrouter_budget.py", "app/assistant/budget.py",
    "app/assistant/router.py",
    "app/reports/service.py", "app/reports/repository.py",
)


@lru_cache(maxsize=8)
def _profile_hash(model, routes, recipients, max_output, input_price, output_price):
    digest = hashlib.sha256(json.dumps([model, routes, recipients, max_output,
                                       input_price, output_price]).encode())
    root = Path(__file__).resolve().parents[2]
    for relative in PROFILE_FILES:
        digest.update(relative.encode())
        digest.update((root / relative).read_bytes())
    return digest.hexdigest()


def profile_hash():
    return _profile_hash(MODEL, ROUTES, RECIPIENTS, MAX_OUTPUT, INPUT_NANOUSD, OUTPUT_NANOUSD)


def ready():
    return bool(
        settings.assistant_provider_verified
        and settings.assistant_openrouter_api_key
        and settings.assistant_openrouter_privacy_verified
        and settings.assistant_openrouter_quality_verified
        and settings.assistant_openrouter_approved_profile == profile_hash()
        and settings.assistant_openrouter_monthly_usd > 0
        and not settings.assistant_mutations_enabled
    )


def pause_error(retry_after=None):
    try:
        delay = int(retry_after)
    except (ValueError, TypeError):
        try:
            delay = math.ceil((parsedate_to_datetime(retry_after)
                               - datetime.now(UTC)).total_seconds())
        except (ValueError, TypeError, AttributeError):
            delay = 60
    return HTTPException(429, "La IA tiene una pausa temporal. "
                         "La ayuda y los reportes directos siguen disponibles.",
                         headers={"Retry-After": str(max(1, min(3600, delay))),
                                  "X-Kova-Assistant-Limit": "temporary"})


async def request(url, body, authorization):
    """Async cancellation bounds the entire HTTP exchange, not each socket phase."""
    try:
        async with asyncio.timeout(deadline.remaining()):
            async with httpx.AsyncClient(
                timeout=deadline.remaining(), trust_env=False, follow_redirects=False
            ) as client:
                async with client.stream(
                    "POST", url, json=body, headers={"Authorization": authorization}
                ) as response:
                    if response.status_code == 429:
                        raise pause_error(response.headers.get("Retry-After"))
                    if response.status_code != 200:
                        raise HTTPException(
                            503,
                            "El proveedor de IA no está disponible.",
                            headers={
                                "X-Kova-Assistant-Provider-Error": "http_"
                                + str(response.status_code)
                            },
                        )
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        deadline.remaining()
                        content.extend(chunk)
                        if len(content) > 1_000_000:
                            raise HTTPException(503, "Respuesta de IA demasiado extensa.")
                    result = json.loads(content)
        deadline.remaining()
        if isinstance(result, dict) and isinstance(result.get("error"), dict) and (
            result["error"].get("code") == 429
        ):
            raise pause_error(response.headers.get("Retry-After"))
        if not isinstance(result, dict) or result.get("error"):
            raise HTTPException(503, "Respuesta de IA no verificable.")
        return result
    except (TimeoutError, httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(
            503, "No se pudo completar la consulta dentro del tiempo disponible."
        ) from None


def body(messages, tools, *, structured, allowed_source_ids):
    from app.assistant import grounding, provider

    if structured and tools:
        raise HTTPException(422, "La explicación final no admite herramientas.")
    result = {
        "model": MODEL,
        "messages": messages,
        "stream": False,
        "max_tokens": MAX_OUTPUT,
        "reasoning": {"enabled": False, "exclude": True},
        "provider": {
            "only": list(ROUTES),
            "allow_fallbacks": len(ROUTES) > 1,
            "require_parameters": True,
            "zdr": True,
            "data_collection": "deny",
            "max_price": {"prompt": 0.35, "completion": 0.75},
        },
    }
    if len(ROUTES) > 1:
        result["provider"]["order"] = list(ROUTES)
    if tools:
        # This route advertises tools/tool_choice, not parallel_tool_calls.
        result.update(tools=provider.planning_tools(tools), tool_choice="auto")
    if structured:
        if not allowed_source_ids:
            raise HTTPException(422, "La selección de pasajes requiere fuentes recuperadas.")
        result["response_format"] = grounding.response_format(grounding.passage_ids(messages))
    return result


def generate(messages, tools, *, model, structured, allowed_source_ids):
    if not ready() or model != MODEL:
        raise HTTPException(503, "El proveedor de IA aún no está configurado.")
    assert settings.assistant_openrouter_api_key is not None
    result = asyncio.run(
        request(
            BASE + "/chat/completions",
            body(
                messages,
                tools,
                structured=structured,
                allowed_source_ids=allowed_source_ids,
            ),
            "Bearer " + settings.assistant_openrouter_api_key.get_secret_value(),
        )
    )
    return decode(result, messages, structured=structured)


def decode(result, messages, *, structured):
    from app.assistant import grounding

    choices = result.get("choices")
    if (
        result.get("provider") not in RECIPIENTS
        or not isinstance(choices, list)
        or len(choices) != 1
        or not isinstance(choices[0], dict)
    ):
        raise HTTPException(503, "Respuesta de IA no verificable.")
    choice = choices[0]
    message = choice.get("message")
    if (
        choice.get("finish_reason") not in {"stop", "tool_calls"}
        or not isinstance(message, dict)
        or message.get("refusal")
    ):
        reason = choice.get("finish_reason")
        raise HTTPException(
            422,
            "La respuesta quedó incompleta. Acota tu consulta.",
            headers={
                "X-Kova-Assistant-Provider-Error": "completion_" + reason
                if reason in {"length", "content_filter"}
                else "completion_invalid"
            },
        )
    content = message.get("content") or ""
    calls = message.get("tool_calls") or []
    if not isinstance(content, str) or not isinstance(calls, list) or len(calls) > 8:
        raise HTTPException(
            422,
            "La respuesta no cumplió el contrato de Kova.",
            headers={"X-Kova-Assistant-Provider-Error": "completion_shape"},
        )
    if structured:
        if calls:
            raise HTTPException(422, "La explicación final no admite herramientas.")
        try:
            content = grounding.selected_answer(content, messages).model_dump_json()
        except (ValueError, KeyError, TypeError):
            raise HTTPException(422, "La respuesta no cumplió el contrato de Kova.") from None
    return {"content": content, "tool_calls": calls, "usage": result.get("usage")}
