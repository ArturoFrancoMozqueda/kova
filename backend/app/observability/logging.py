import contextvars
import json
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import jwt
from fastapi import Request, Response

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)
tenant_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "tenant_id", default=None
)
user_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("user_id", default=None)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
            "tenant_id": tenant_id_var.get(),
            "user_id": user_id_var.get(),
        }
        for key in ("method", "path", "status_code", "duration_ms"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def set_request_context(*, tenant_id: Any | None = None, user_id: Any | None = None) -> None:
    if tenant_id is not None:
        tenant_id_var.set(str(tenant_id))
    if user_id is not None:
        user_id_var.set(str(user_id))


def _set_context_from_access_cookie(request: Request) -> None:
    token = request.cookies.get("access_token")
    if not token:
        return
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.InvalidTokenError:
        return
    set_request_context(tenant_id=payload.get("tid"), user_id=payload.get("sub"))


async def request_context_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request_id_token = request_id_var.set(request_id)
    tenant_id_token = tenant_id_var.set(None)
    user_id_token = user_id_var.set(None)
    _set_context_from_access_cookie(request)

    started = time.perf_counter()
    logger = logging.getLogger("app.request")
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.exception(
            "http_request_failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": 500,
                "duration_ms": duration_ms,
            },
        )
        raise
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["x-request-id"] = request_id
    logger.info(
        "http_request",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    request_id_var.reset(request_id_token)
    tenant_id_var.reset(tenant_id_token)
    user_id_var.reset(user_id_token)
    return response
