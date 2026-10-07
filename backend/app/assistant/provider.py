"""Fixed Cloudflare egress, bounded output, no built-in network/code tools."""

import json
import re

import httpx
from fastapi import HTTPException

from app.assistant.budget import RATES
from app.assistant.schemas import Answer
from app.config import settings

EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b"


def ready() -> bool:
    return bool(
        settings.assistant_provider_verified
        and re.fullmatch(r"[a-fA-F0-9]{32}", settings.assistant_cloudflare_account_id)
        and settings.assistant_cloudflare_token
    )


def _call(model: str, body: dict, *, chat=False) -> dict:
    if not ready() or model not in RATES:
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
