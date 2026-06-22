# Rate limiting

Last updated: 2026-06-21
Owner: backend
Related code:
- `backend/app/middleware/rate_limit.py` — pluggable rate-limit factory
- `backend/app/tests/test_rate_limit.py` — backend abstraction tests
- `backend/app/config.py` — `upstash_redis_rest_url`, `upstash_redis_rest_token`

## Summary

Kova enforces per-IP request rate limits on abuse-prone endpoints. The limiter
has two backends:

- **Upstash Redis (sliding window)** — selected automatically when both
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. Shared across
  instances, survives deploys, ~4 Redis commands per protected request.
- **In-memory (fixed window)** — fallback used in local dev and any deploy
  where Upstash is not configured. Single-process only; counters reset on
  every deploy. Tolerable while Kova runs on a single Fly machine but unsafe
  the moment we scale horizontally.

When `APP_ENV=local`, the limiter is a no-op so tests don't share a single
client IP and trip themselves.

## Backends

### Upstash (production)

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
> If the limiter is degraded, prioritize restoring Upstash; do not "fix" auth by
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

When `key` is omitted, the matched FastAPI route pattern is used. The IP
comes from `X-Forwarded-For` (first hop) when present, otherwise
`request.client.host`.

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

When Kova scales to more than one Fly machine, set the Upstash env vars
before deploying. Without them, each machine keeps its own in-memory
counter and an attacker can double their effective rate by riding the
load balancer.

## Operator checklist

- [ ] Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as Fly
      secrets before scaling beyond one machine.
- [ ] Verify the startup log shows `rate_limit_backend_selected backend=upstash`
      after deploy.
- [ ] Smoke test: hammer `/api/v1/auth/login` from a single IP and confirm
      you receive a 429 with the expected `Retry-After`.
- [ ] Monitor logs for `rate_limit_upstash_call_failed`; intermittent entries
      are tolerable, sustained entries mean Upstash is down or misconfigured
      and the limiter is failing open.
