import contextvars
import json
import logging
import re
import time
import traceback
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import jwt
import sentry_sdk
from fastapi import Request, Response

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)
tenant_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "tenant_id", default=None
)
user_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("user_id", default=None)

_EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_CREDENTIAL_URL_PATTERN = re.compile(
    r"(?P<scheme>\b[a-z][a-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?P<key>\b(?:token|password|secret|api[_-]?key|device[_-]?key|pairing[_-]?code|authorization|cookie|x-kova-device-key)\b)"
    r"(?P<separator>\s*[:=]\s*)[^\s,;&]+",
    re.IGNORECASE,
)
_DRAWER_CREDENTIAL_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_-])[0-9a-fA-F-]{36}\.[0-9a-fA-F-]{36}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])"
)


def redact_sensitive_text(value: str) -> str:
    """Best-effort redaction for ordinary log messages.

    Exception messages are excluded entirely below because database drivers may
    place complete row values in DETAIL fields that cannot be safely parsed.
    """
    redacted = _EMAIL_PATTERN.sub("[redacted-email]", value)
    redacted = _CREDENTIAL_URL_PATTERN.sub(r"\g<scheme>[redacted]@", redacted)
    redacted = _DRAWER_CREDENTIAL_PATTERN.sub("[redacted-device-key]", redacted)
    return _SECRET_ASSIGNMENT_PATTERN.sub(
        lambda match: f"{match.group('key')}{match.group('separator')}[redacted]",
        redacted,
    )


def _safe_exception(record: logging.LogRecord) -> dict[str, Any]:
    exc_type, _exc_value, exc_traceback = record.exc_info or (None, None, None)
    frames = []
    if exc_traceback is not None:
        frames = [
            {"file": frame.filename, "line": frame.lineno, "function": frame.name}
            for frame in traceback.extract_tb(exc_traceback)
        ]
    return {
        "type": exc_type.__name__ if exc_type is not None else "Exception",
        "frames": frames,
    }


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_sensitive_text(record.getMessage()),
            "request_id": request_id_var.get(),
            "tenant_id": tenant_id_var.get(),
            "user_id": user_id_var.get(),
        }
        for key in ("method", "path", "status_code", "duration_ms"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = _safe_exception(record)
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
        # UUID tags (not PII); lets the ops trace search find errors by tenant.
        sentry_sdk.set_tag("tenant_id", str(tenant_id))
    if user_id is not None:
        user_id_var.set(str(user_id))
        sentry_sdk.set_tag("user_id", str(user_id))


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
    # Tag every Sentry event with the request_id so /trace?request_id= can find
    # the errors a given request produced. No-op if Sentry isn't initialized.
    sentry_sdk.set_tag("request_id", request_id)
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
