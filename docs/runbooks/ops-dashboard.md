# Runbook — solución interna unificada Kova Ops

The internal ops dashboard lives at `/internal/ops` and is served by the same
frontend/backend as the product. It is **read-only for production data**; the
only writes are triage notes and incident triage state. Access is gated by one
immutable founder identity, never by tenant roles.

La portada reúne el tablero ejecutivo y la consola operativa. Sus cuatro
verdades históricas —usuarios creados, usuarios verificados, negocios con una
venta completada y negocios pagando— reutilizan `build_growth_snapshot`. El
endpoint protegido de snapshot se conserva por compatibilidad, pero no existe
un segundo cálculo que pueda divergir de Kova Ops.

## Access

1. Configure the two existing, distinct MFA secrets and the single verified
   founder identity as sealed secrets on the Cloudflare `kova-backend` Worker:
   `INTERNAL_ADMIN_EMAILS`, `INTERNAL_ADMIN_USER_ID`, `INTERNAL_OPS_MFA_ROOT_KEY`
   and `INTERNAL_OPS_MFA_ENROLLMENT_KEY`. Keep values outside chat, source,
   command arguments and logs. Do not rotate the migrated keys during routine
   deployment; changing the MFA root changes the founder's TOTP seed.
   Outside local development, startup fails closed unless both values are present
   and there is exactly one email; an enabled Ops module also requires an MFA root
   and enrollment key of at least 32 characters. An empty identity configuration
   disables the dashboard.
2. Copy the UUID from the existing `users.id` record for that email. Recreating
   an account with the same email produces another UUID and therefore does not
   inherit access. The account must stay active and **email-verified**. Tenant
   role is irrelevant.
3. Navigate to `https://kovasuite.com/internal/ops`. Non-allowlisted users
   (even tenant owners) get a 404-style page; the route is never surfaced in
   normal navigation and carries `X-Robots-Tag: noindex`. This is discoverability
   hygiene only; backend authorization remains the security boundary.
4. On first access from a trusted device, enter the current password and the
   out-of-band `INTERNAL_OPS_MFA_ENROLLMENT_KEY`, then scan the QR with a TOTP app
   such as 1Password, Google Authenticator or Authy. Confirm one six-digit code,
   then store the ten recovery codes outside Kova. They are shown only once and
   each can be consumed only once.

The MFA step-up lasts `INTERNAL_OPS_MFA_STEP_UP_TTL_SECONDS` (one hour by
default). A normal Kova login or refresh does not bypass it. TOTP counters are
recorded server-side to reject replay within the accepted clock-skew window.

`INTERNAL_OPS_MFA_ROOT_KEY` is not the TOTP seed and is never returned to the
browser. Kova derives the founder seed from this root, so a database-only breach
cannot clone the factor. Do not rotate or lose it casually: rotating it changes
the TOTP seed. If rotation is required, retain a recovery code, remove the old
factor rows operationally, set the new root and enroll again.

The separate enrollment key prevents a stolen founder session and password from
claiming the first factor. Keep it outside Kova and the password manager/device
used for normal login; it is also the break-glass credential for a controlled
re-enrollment. Never send either server secret through chat, logs or source control.

## Connector tokens (all optional)

Every integration degrades gracefully: with no token it shows **Sin configurar**
(`not_configured`); on an API error it shows **Degradado** (`degraded`). The
dashboard is fully useful on Kova DB + Stripe data alone. Configure optional
credentials as sealed secrets on the Cloudflare API Worker. Fly was permanently
retired on 2026-10-19; its historical response key always reports `not_configured`
and cannot be reactivated with stale credentials.

| Setting | Where to generate | Minimum scope |
|---|---|---|
| `SENTRY_API_TOKEN` + `SENTRY_ORG_SLUG` + `SENTRY_PROJECT_SLUG` (+ `SENTRY_FRONTEND_PROJECT_SLUG`) | Sentry → Settings → Auth Tokens (org token) | `org:read`, `project:read`, `event:read` |
| `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` | Vercel → Account → Tokens | read access to project deployments |
| `UPTIMEROBOT_API_KEY` | UptimeRobot → My Settings → API | Main or Read-Only key |
| `KOVA_BUILD_SHA` | versioned public text binding set by Cloudflare CI | — |

IDs for the services above are recorded in `docs/service-audit.md`.

Tokens are **server-side only** — they are never exposed to the browser (the
frontend calls the backend, which calls the external APIs). A regression test
(`backend/app/tests/test_ops_no_secrets.py`) asserts no secret ever appears in
an ops response.

## Freshness

The frontend polls (60s for overview/technical/incidents, 120s for
tenants/revenue/funnel). The backend caches external-connector results in
memory (TTL = `OPS_CACHE_TTL_SECONDS`, default 60s; degraded results re-probe
within ≤30s) so polling never hammers the external APIs.

## Known limitations (by design)

- **Retired provider**: `fly_logs` is retained as a historical trace key with
  status `retired`. It does not issue provider requests or offer live links.
- **Sentry search**: event-level (Discover) search is a paid feature. We use
  *issue* search by the `request_id` tag (available on all plans), which only
  finds requests that produced a captured error.
- **request_id trace**: no local table stores `request_id`; a bare-request_id
  trace resolves only via Sentry + deep links. Local correlation is by
  tenant/user/stripe_event/time. `sources_queried` in the response states
  exactly what was and wasn't queried.
- **In-memory cache**: short-lived and local to each Cloudflare coordinator.
  It is not shared across coordinators or used as authoritative business data.


## Scope / safety

- No tenant, billing, or production mutation is possible from the dashboard.
- Cross-tenant reads rely on the app DB role being RLS-exempt (table owner) —
  the same mechanism as `GET /api/v1/billing/internal/subscriptions`. A
  cross-tenant test (`test_ops_tenants_revenue_funnel.py`) guards this.
- Access reads are logged as `app.ops.access` (JSON, with request_id) to Fly
  logs; note/triage writes are recorded in `audit_logs`.
- Every Ops response is `private, no-store`; state changes require both the CSRF
  token and a trusted Kova browser origin.
- Email + UUID + TOTP protects against password-only and stale-session compromise.
  A hardware-backed identity-aware proxy remains useful defense in depth for an
  especially sensitive production control plane.
