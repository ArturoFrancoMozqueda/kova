"""Routing affinity only; the API still authenticates and authorizes every call."""

import hashlib

_DASHBOARD_CHAIN = frozenset({
    "/api/v1/settings/business-profile", "/api/v1/reports/business-story",
    "/api/v1/reports/sales-summary", "/api/v1/reports/sales-by-hour",
})
_PARALLEL_LANES = {
    "/api/v1/catalog/products": 1, "/api/v1/onboarding/state": 1,
    "/api/v1/branches": 1, "/api/v1/assistant/capabilities": 1,
    "/api/v1/inventory/stock": 2, "/api/v1/billing/subscription": 2, "/api/v1/shifts": 2,
    "/api/v1/employees": 3, "/api/v1/inventory/low-stock": 3, "/api/v1/settings/receipt": 3,
}


def coordinator_shard(cookie: str | None, path: str) -> int:
    identity = cookie or "anonymous"
    base = (hashlib.sha256(identity.encode()).digest()[0] % 4) * 4
    normalized = path.rstrip("/") or "/"
    if normalized.startswith("/api/v1/auth/") or normalized in _DASHBOARD_CHAIN:
        return base
    if normalized in _PARALLEL_LANES:
        return base + _PARALLEL_LANES[normalized]
    return base + 1 + hashlib.sha256(f"{identity}\n{normalized}".encode()).digest()[0] % 3
