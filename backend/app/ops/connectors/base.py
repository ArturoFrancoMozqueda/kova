"""Shared HTTP plumbing and result type for external connectors.

Follows the repo convention of stdlib urllib with an explicit timeout and typed
errors (see app/billing/stripe_client.py). A connector never raises out of the
service layer: missing token → not_configured, any network/parse failure →
degraded with a short, secret-free summary.
"""
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.ops.schemas import OpsStatus


class ConnectorError(Exception):
    pass


@dataclass
class ConnectorResult:
    status: OpsStatus
    data: dict | list | None = None
    error_summary: str | None = None
    checked_at: datetime = field(default_factory=lambda: datetime.now(UTC))


def not_configured() -> ConnectorResult:
    return ConnectorResult(status="not_configured")


def degraded(summary: str) -> ConnectorResult:
    return ConnectorResult(status="degraded", error_summary=summary)


def http_get_json(url: str, *, headers: dict[str, str], timeout: float) -> Any:
    request = Request(url, headers=headers, method="GET")
    return _read_json(request, timeout)


def http_post_form(
    url: str, *, data: dict[str, str], headers: dict[str, str] | None = None, timeout: float
) -> Any:
    body = urlencode(data).encode()
    request = Request(url, data=body, headers=headers or {}, method="POST")
    return _read_json(request, timeout)


def _read_json(request: Request, timeout: float) -> Any:
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode()
    except HTTPError as exc:
        # Only the status code — the response body can echo tokens/PII.
        raise ConnectorError(f"HTTP {exc.code}") from exc
    except URLError as exc:
        raise ConnectorError(f"unreachable: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ConnectorError("timeout") from exc
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConnectorError("invalid JSON response") from exc
