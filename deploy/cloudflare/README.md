# Cloudflare Free frontend deployment

Kova serves its existing React/Vite build through Workers Static Assets. A small
Worker preserves the same-origin `/api` proxy to FastAPI on Fly. Supabase, Stripe,
cookie authentication, billing gates and document ingestion remain on their
existing services. This does not migrate the FastAPI runtime off Fly.

## Build and verify

Use Node 24 and the pinned package locks:

```sh
npm ci --prefix frontend
npm ci --prefix deploy/cloudflare
VITE_HOSTING_PROVIDER=cloudflare COMMIT_SHA="$(git rev-parse HEAD)" npm run build --prefix frontend
npm run check --prefix deploy/cloudflare
```

The builder packages the already-prerendered output without running Vite a second
time or changing the PWA manifest. It uses the pinned Cloudflare Build Output v0
utilities; update those and the CLI together after checking beta compatibility.
`cf deploy --prebuilt --dry-run` validates the package without uploading it.

Static assets use `_headers`, generated from the incumbent security/cache rules.
Worker responses apply the same security headers. API responses always use
`private, no-store`, and the proxy forwards the raw body, cookies, CSRF header,
request ID and idempotency key without automatic write retries. Missing assets
return 404; application navigation uses the empty `app-shell.html`.

Cloudflare's existing zone Web Analytics installation replaces the Vercel browser
beacons in Cloudflare builds. The CSP permits the Cloudflare script and collector
origins. Sentry configuration remains part of the normal production build.

## Publish and recover

`preview.kovasuite.com` is the Worker custom domain. Production routing is opt-in:
`KOVA_CLOUDFLARE_FRONTEND=1` includes only `kovasuite.com/*` and
`www.kovasuite.com/*`; the corresponding DNS records must be proxied. API, email
and automation DNS records must remain untouched. The Vercel origin records are
retained for DNS rollback.

For CI, store a scoped Workers deployment token in the GitHub secret
`CLOUDFLARE_API_TOKEN`, retain `CLOUDFLARE_ACCOUNT_ID`, and enable the repository
variable `KOVA_CLOUDFLARE_FRONTEND=1` only once the updated release workflow is
available on main. OAuth CLI credentials are local and are never copied to CI.

The existing release workflow captures the exact serving Cloudflare version
alongside the Fly image, Vercel deployment and release SHA. It checks the immutable
Vercel candidate against the updated API, publishes the same candidate static
artifact to Cloudflare, and verifies the public site/API/database SHA contracts.
Vercel stays as a release candidate and fallback during this transition.

If promotion or public acceptance fails, recovery restores the captured Cloudflare
version before Vercel and Fly. Missing capture, mixed serving versions, invalid
version IDs and failed restores block release. Version rollback does not change
DNS or database state and never bypasses deployment safety checks.

Do not run a preview-only deployment of this same Worker after production cutover:
omitting `KOVA_CLOUDFLARE_FRONTEND=1` removes its production route declarations.
Use the integrated production workflow for subsequent releases.

## Acceptance and remaining scope

Before cutover, verify landing/legal HTML, login rendering, unauthenticated
session/me behavior, health/database proxy, cookie flags/paths, CSP, hashed-asset
caching, no-store API, service-worker installation and missing-file 404s.
Authenticated browser QA must check login/refresh/logout, the billing gate and
offline retry behavior. Local mocked tests do not certify real sales or payments.

Free Workers have a finite dynamic-request quota. Static asset delivery does not
consume that quota. The proxy does; inspect real usage before relying on its
capacity. R2 retains its existing usage-based subscription/free allowance; this
change does not create storage, upgrade Workers, or promise an entirely free SaaS.

FastAPI/psycopg/SQLAlchemy support in Python Workers makes a later API experiment
possible. Existing bcrypt CPU requirements, threaded helpers, binary packages and
the Docker-isolated document parser have not passed Workers Free runtime tests.
Do not shut down Fly or weaken those controls as part of this frontend cutover.
