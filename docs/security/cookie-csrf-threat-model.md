# Cookie auth & CSRF threat model

Last updated: 2026-05-25
Owner: backend
Related code:
- `backend/app/auth/router.py` — issues `access_token`, `refresh_token`, `csrf_token` cookies
- `backend/app/middleware/csrf.py` — CSRF middleware (double-submit token)
- `backend/app/main.py` — middleware registration, CORS allowlist
- `frontend/src/shared/csrf.ts` — reads `csrf_token` cookie, injects `X-CSRF-Token` on writes

## Summary

Kova uses **HttpOnly cookies** for session auth (no `localStorage`). Two auth cookies
(`access_token`, `refresh_token`) plus a non-HttpOnly **double-submit CSRF token cookie**
(`csrf_token`). Every state-changing cookie-authenticated request must echo the CSRF cookie
through an `X-CSRF-Token` request header, validated by `csrf_middleware`. CORS is locked
to `settings.frontend_url` with `allow_credentials=True`, which already prevents most
arbitrary-origin reads, but does **not** by itself prevent CSRF on simple-form-style writes
— the double-submit token closes that gap.

## Cookies in use

| Cookie | HttpOnly | SameSite | Secure (non-local) | Path | TTL | Purpose |
|---|---|---|---|---|---|---|
| `access_token` | yes | lax | yes | `/` | 15 min | JWT, validates session, drives `set_config('app.tenant_id', ...)` for RLS |
| `refresh_token` | yes | lax | yes | `/api/v1/auth` | 30 days | Opaque token, hashed in `sessions` table |
| `csrf_token` | **no** (must be JS-readable) | lax | yes | `/` | 30 days | Double-submit CSRF token. Random `secrets.token_urlsafe(32)`. Not used for auth — only echoed by JS into the `X-CSRF-Token` header. |

`SameSite=Lax` already blocks the cookie from being attached to most cross-site POST/PUT
requests issued by third-party HTML forms. The CSRF token defends against the residual
cases (e.g. attacker-controlled subdomain, browser/UA quirks, top-level navigation POSTs,
future relaxation of the SameSite default).

## Threat model

In scope:
1. CSRF on state-changing cookie-auth endpoints (POST/PUT/PATCH/DELETE).
2. Forged Stripe webhook deliveries (handled by Stripe signature verification, **not** CSRF).
3. Replay of internal admin endpoints by an attacker who does not hold the `X-Internal-Key`.

Out of scope (covered elsewhere or accepted controlled-beta risk):
- Token theft via XSS — mitigated by HttpOnly on auth cookies, CSP (already enforced),
  and not putting auth tokens in `localStorage`. `csrf_token` itself is intentionally
  readable by JS; theft of the CSRF token by an XSS attacker is moot because the same
  attacker already has authority to call the API via `fetch` with `credentials: "include"`.
- Subdomain takeover — depends on DNS/Vercel/Fly operational discipline; tracked in the
  risk register.

## Enforcement rules

Middleware enforces CSRF when **all** of the following hold:
- The request method is `POST`, `PUT`, `PATCH`, or `DELETE`.
- The request carries an `access_token` cookie (i.e. it is cookie-authenticated).
- The request path is not on the exemption list.

When enforced, both must be true:
- The `csrf_token` cookie is present.
- The `X-CSRF-Token` request header is present and equals the cookie value (constant-time).

Failure returns HTTP 403 with body `{"detail": "CSRF validation failed"}`.

### Exemption list

These paths bypass CSRF enforcement because cookie auth is not in play, or because they
use a different authentication scheme:

| Path | Method(s) | Reason |
|---|---|---|
| `/api/v1/auth/login` | POST | No cookie yet; rate-limited; password-protected |
| `/api/v1/auth/signup` | POST | No cookie yet; rate-limited |
| `/api/v1/auth/verify` | POST | Email-token based; no cookie |
| `/api/v1/auth/password-reset/request` | POST | Email-token based; no cookie |
| `/api/v1/auth/password-reset/confirm` | POST | Email-token based; no cookie |
| `/api/v1/billing/webhooks/stripe` | POST | Authenticated by Stripe signature (`Stripe-Signature` header) |
| Any path with a valid `X-Internal-Key` | any | Server-to-server, authenticated by shared secret |

Logout and refresh **are** CSRF-protected: even though refresh uses `refresh_token` rather
than `access_token`, the middleware also short-circuits to require CSRF when a cookie-auth
session exists. Specifically, refresh and logout are checked by including the `refresh_token`
cookie in the "is cookie-auth" detection.

### Token issuance

The server issues or rotates the `csrf_token` cookie on:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/signup` — only after the user actually verifies and logs in this is moot;
  signup itself does not authenticate the session.
- `GET /api/v1/auth/session` — lazily sets the cookie if the caller is authenticated but
  missing the CSRF cookie (e.g. older browsers, post-deploy refresh of the cookie format).

On `POST /api/v1/auth/logout` / `logout-all`, the cookie is cleared alongside `access_token`
and `refresh_token`.

## Frontend wiring

`frontend/src/shared/csrf.ts` exposes `readCsrfCookie()` and `csrfHeaders()`. Every per-domain
`requestJson` helper merges `csrfHeaders()` into outgoing request headers for non-GET methods.
Offline-sync POSTs and the logo/product image multipart uploads use the same helper.

E2E and unit tests assume the CSRF cookie is set by `/auth/login`. Backend tests use
`TestClient`, which preserves cookies across calls; tests that POST directly without first
calling `/auth/login` (e.g. pre-auth endpoints) are unaffected.

## Future work

- Move from in-memory rate limiter to a shared backend so CSRF + rate limit are both
  multi-instance safe (tracked separately).
- Consider rotating the CSRF token on each successful state-change (not currently done; the
  token rotates only at login/refresh).
- Add an automated test that crawls all registered routers and asserts every state-changing
  endpoint either lives on the exemption list or is reachable only via CSRF.
