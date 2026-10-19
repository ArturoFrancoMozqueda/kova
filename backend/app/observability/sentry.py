import sys

import sentry_sdk

from app.config import settings
from app.observability.logging import redact_sensitive_text

_SENSITIVE_EVENT_KEYS = {
    "authorization",
    "body",
    "cookie",
    "data",
    "email",
    "external_reference",
    "html",
    "name",
    "password",
    "payload",
    "secret",
    "subject",
    "token",
    "x-kova-device-key",
    "device_key",
    "pairing_code",
    "key_hash",
    "pairing_hash",
    "vars",
}


def _sanitize_event_value(value, *, key: str | None = None):
    if key is not None and key.casefold() in _SENSITIVE_EVENT_KEYS:
        return "[redacted]"
    if isinstance(value, dict):
        return {
            child_key: _sanitize_event_value(child_value, key=str(child_key))
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_event_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_event_value(item) for item in value)
    if isinstance(value, str):
        return redact_sensitive_text(value)
    return value


def sanitize_sentry_event(event: dict, _hint: dict | None = None) -> dict:
    """Remove request/customer values while retaining exception type and frames."""
    sanitized = _sanitize_event_value(event)
    exception = sanitized.get("exception")
    if isinstance(exception, dict):
        values = exception.get("values")
        if isinstance(values, list):
            for item in values:
                if isinstance(item, dict) and "value" in item:
                    item["value"] = "[redacted]"
    return sanitized


def init_sentry() -> None:
    if not settings.sentry_dsn:
        return
    transport = {}
    if sys.platform == "emscripten":
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.httpx import HttpxIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        from app.workers.sentry import WorkersTransport

        transport["transport"] = WorkersTransport
        # Optional SDK autodetection imports native transports (including the
        # unused S3 client) on every cold coordinator. Keep core defaults and
        # the web/database integrations actually used by the Workers API.
        transport["auto_enabling_integrations"] = False
        transport["integrations"] = [
            FastApiIntegration(), StarletteIntegration(),
            SqlalchemyIntegration(), HttpxIntegration(),
        ]
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        # release ties every event to the running build so the ops dashboard can
        # correlate errors with a specific deploy/commit.
        release=settings.git_sha or None,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        # Python locals can contain customer names, query params or complete
        # request payloads whose keys are not predictable enough to redact.
        include_local_variables=False,
        before_send=sanitize_sentry_event,
        **transport,
    )
