# Rate Limiting Spec

## Problem

Unthrottled auth endpoints allow brute-force and credential-stuffing attacks.

## Scope

Per-IP, fixed-window rate limiting on sensitive auth endpoints only. General API endpoints are not rate-limited for v1.

## Limits

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/v1/auth/login` | 20 requests | 1 minute |
| `POST /api/v1/auth/signup` | 10 requests | 1 minute |
| `POST /api/v1/auth/password-reset/request` | 5 requests | 1 minute |

## IP Resolution

Use `X-Forwarded-For` first (Fly.io proxy), fall back to `request.client.host`.
Only the first IP in the `X-Forwarded-For` header is trusted.

## Behavior on Limit Exceeded

- HTTP 429 Too Many Requests
- `Retry-After: 60` header
- JSON body: `{"detail": "Too many requests. Please try again later."}`

## Implementation

In-memory fixed-window limiter (single Fly.io instance for beta).
If multi-instance is needed post-beta, migrate to Redis.

## Non-Functional

- Limiter state is per-process; not shared across instances.
- Limits are intentionally loose for a POS with a small number of known employees.
- No rate limiting on non-auth endpoints for beta.

## Acceptance Criteria

- 21st login attempt from the same IP in 60 seconds returns 429.
- Each endpoint has its own independent window.
- `Retry-After` header is present on 429 responses.
- Automated test verifies limit behavior.
