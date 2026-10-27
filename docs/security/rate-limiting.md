# Rate limiting

Last updated: 2026-10-27
Owner: backend
Related code:
- `backend/app/middleware/rate_limit.py` — pluggable rate-limit factory
- `backend/app/tests/test_rate_limit.py` — backend abstraction tests
- `backend/app/middleware/cloudflare_rate_limit.py` — production backend (Durable Object)
- `backend/app/config.py` — `upstash_redis_rest_url`, `upstash_redis_rest_token`

## Summary

Kova enforces per-IP request rate limits on abuse-prone endpoints. The backend
is chosen at startup by `_get_backend()`:

- **Cloudflare Durable Object `KovaRateLimit` (production)** — the resident
  native container calls `http://rate-limit.kova.internal/allow`, reachable only
  through Container outbound interception. Buckets persist across deploys and
  restarts. Selected when `cloudflare_container_mode` is set.
- **Workers runtime** — the Python Workers rollback path uses the same
  `KovaRateLimit` buckets (`app/workers/rate_limit.py`).
- **Upstash Redis (sliding window)** — outside Cloudflare, selected when both
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set.
- **In-memory (fixed window)** — local fallback. Single-process only; counters
  reset on restart.

When `APP_ENV=local`, the limiter is a no-op so tests don't share a single
client IP and trip themselves.

## Backends

### Upstash (outside Cloudflare)

Uses the official `upstash-ratelimit` library with the `SlidingWindow`
algorithm. Each `Ratelimit` instance is cached per `(max_requests, window_seconds)`
pair so we don't recreate state on every request.

Failure mode: if the Upstash call raises (network blip, service outage, auth
failure), the limiter logs and **fails open by default** — the request is
allowed. The rationale is availability over strict enforcement: a Redis outage
should not block every real user. Persistent failures will surface in logs and
alerting.

**Exception — auth endpoints fail closed (`fail_closed=True`).** Signup, login,
email verification, and both password-reset endpoints deny (429) instead of
allowing when the limiter backend errors *in production*, so a Redis blip can't
open an unbounded brute-force window. `fail_closed` is inert outside production
(staging/local fail open) so developer outages don't lock anyone out.

> **Operational note:** because these endpoints fail closed, a sustained
> rate-limiter outage in production will **temporarily block legitimate email
> verification and password-reset flows** (users see 429 with a short
> `Retry-After`), not just attacks. This is an intentional safety trade-off.
> If the limiter is degraded, prioritize restoring the limiter backend; do not "fix" auth by
> flipping these endpoints to fail-open. Monitor `rate_limit_upstash_call_failed_closed`.

### In-memory (fallback)

Per-`(bucket_key, window_seconds)` list of timestamps. On each call we drop
entries older than the window, count what remains, and reject if at the cap.
Thread-safe via a single `threading.Lock`.

## Bucket keys

Every protected endpoint declares an explicit `key=` (e.g. `"auth-login"`,
`"sync-offline-sales"`) so distinct endpoints don't share quota. The factory
combines that with the client IP to form the final bucket key:

```
bucket = "<endpoint-key>:<client-ip>"
```

When `key` is omitted, the matched FastAPI route pattern is used. The IP comes
from the `X-Kova-Client-IP` header (configured by `TRUSTED_CLIENT_IP_HEADER`
in `deploy/cloudflare-native/policy.mjs`). The public gateway
(`deploy/cloudflare-backend/gateway.mjs`) overwrites it with Cloudflare's
`CF-Connecting-IP` on every request, so a client cannot set it. It falls back to the direct socket peer when that
header is absent or invalid. `X-Forwarded-For` is deliberately ignored because
an internet client can prepend values and rotate buckets. IPv4, IPv6, and
IPv4-mapped IPv6 are normalized before building the key.

This trust model assumes the backend is reachable only through the gateway; the
container exposes no public port. If direct public access or another proxy is introduced, update the trusted header
and edge controls together; never restore first-hop `X-Forwarded-For`.

## Current thresholds

Per-IP buckets:

| Endpoint | Method | Bucket key | Limit | Fail mode |
|---|---|---|---|---|
| `/api/v1/auth/signup` | POST | `auth-signup` | 10 / min | closed |
| `/api/v1/auth/login` | POST | `auth-login` | 20 / min | closed |
| `/api/v1/auth/verify` | POST | `auth-verify` | 20 / min | closed |
| `/api/v1/auth/password-reset/request` | POST | `auth-password-reset` | 5 / min | closed |
| `/api/v1/auth/password-reset/confirm` | POST | `auth-reset-confirm` | 10 / min | closed |
| `/api/v1/sync/offline-sales` | POST | `sync-offline-sales` | 60 / min | open |
| `/api/v1/billing/checkout` | POST | `billing-checkout` | 5 / min | open |
| `/api/v1/settings/receipt/logo` | POST/DELETE | `settings-logo-upload`/`-delete` | 10 / min each | open |
| `/api/v1/catalog/products/{id}/image` | POST/DELETE | `catalog-image-upload`/`-delete` | 30 / min each | open |

Per-account buckets (enforced in the handler in addition to the per-IP limit, so
a distributed spray from many IPs against one account is still bounded). The
bucket key is `<prefix>:<sha256(normalized-email)>` — the raw email is **never**
written into the limiter store:

| Endpoint | Bucket prefix | Limit | Fail mode |
|---|---|---|---|
| `/api/v1/auth/login` | `auth-login-acct` | 10 / 10 min | closed |
| `/api/v1/auth/signup` | `auth-signup-acct` | 5 / hour | closed |
| `/api/v1/auth/password-reset/request` | `auth-reset-acct` | 5 / hour | closed |

Thresholds are intentionally generous for normal usage and tight enough to
slow down credential stuffing, signup spam, brute-force checkout abuse, and
runaway clients. Adjust them with usage data; do not lower without telemetry
that justifies the change. The per-account limiter consumes a token per attempt
(including successful ones), so the worst-case targeted lockout is bounded to one
short window; failure-only counting (reset on success) is a future enhancement.

## Bypass rules

- **Local environment (`APP_ENV=local`)**: the dependency short-circuits to a
  no-op. Tests share one IP, so this prevents flakes.
- **Stripe webhooks** (`/api/v1/billing/webhooks/stripe`): not rate-limited
  here. Stripe signs each delivery; bogus deliveries are rejected at the
  signature check. If a real Stripe delivery loop gets stuck, we'd rather
  process the retry than drop billing events.
- **`X-Internal-Key` calls**: internal admin endpoints rely on the shared
  secret. The rate limiter does not currently exempt them, but they're also
  not high-volume; if that becomes a problem we add a check in the
  dependency.

## 429 response

Format:

```json
{
  "detail": "Demasiadas peticiones. Intenta de nuevo en unos momentos.",
  "headers": { "Retry-After": "<seconds>" }
}
```

Frontend handling:
- `AuthView` shows `copy.auth.loginRateLimited` ("Demasiados intentos. Espera
  un momento y vuelve a intentarlo.") on 429.
- `offline/sync.ts` re-queues sales to `pending` on 429 rather than
  dead-lettering them — they retry on the next sync attempt.
- Other endpoints surface generic toast/banner copy via existing error
  handling. A friendlier per-endpoint message can be added if telemetry shows
  it matters.

## Observability expectations

The factory logs which backend was selected once per process start
(`rate_limit_backend_selected`). Upstash failures log
`rate_limit_upstash_call_failed` with the bucket key and limits.

Future work:
- Counters of 429s per bucket, exposed at a metrics endpoint or shipped to
  Sentry. Without these, we won't notice if a real customer is being throttled.
- Alert when 429 rate exceeds a threshold so we can distinguish "limits are
  too tight" from "we're under attack."

## Multi-instance readiness

Production counters already live in the shared `KovaRateLimit` Durable Object,
so they survive restarts and would be shared if more container instances were
added. Upstash is only needed when running the backend outside Cloudflare.

## Operator checklist

- [ ] After a release, verify the startup log shows
      `rate_limit_backend_selected backend=cloudflare-container`.
- [ ] Smoke test: hammer `/api/v1/auth/login` from a single IP and confirm
      you receive a 429 with the expected `Retry-After`.
- [ ] Outside Cloudflare, set `UPSTASH_REDIS_REST_URL` and
      `UPSTASH_REDIS_REST_TOKEN` before running more than one process, and
      monitor `rate_limit_upstash_call_failed` (sustained entries mean the
      limiter is failing open).
