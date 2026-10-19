# Backend on Cloudflare Free

The public frontend and API use Cloudflare Workers Free. Current acceptance,
automatic publication and recovery status live in
[`docs/current-sprint.md`](../../docs/current-sprint.md).

The existing FastAPI application runs in 16 SQLite Durable Object coordinators
behind a small JavaScript HTTP gateway. This retains production bcrypt cost within
the Durable Objects compute budget. PostgreSQL remains authoritative for sessions,
RLS, billing, transactions and offline/idempotent writes; no business tables move
to SQLite. A cookie hash selects a group of four within the existing pool.
Session, business timezone and dashboard reports share the first coordinator;
catalog and other independent reads use three parallel lanes. This reuses the
authenticated bootstrap after idle and grants no permissions. Each coordinator
serializes synchronous I/O through ASGI dependency
cleanup. One-chunk JSON/bytes responses wrapped by HTTP middleware retain buffered
SDK handling; genuine streams retain backpressure and release admission through a
retained completion task. Locks remain local to each Durable Object's I/O context.
Unknown paths outside the API/health/root routes return 404 at the JavaScript edge
without starting Python or opening database connections.
Cloudflare negotiates response compression; the native-only gzip middleware is
omitted in Workers to avoid double-encoding large JSON through the ASGI adapter.

The dashboard uses `GET /api/v1/reports/dashboard?period=day|week|month` to compose
its existing real reports and context in one request-scoped session. It retains
the reports commercial/role gate, selected branch, tenant timezone and separate
billing/employee permissions. Inventory is read once; catalog and closed shifts
provide counts without modifier or drawer-finance hydration. Responses are never
cached. An explicit 404 alone permits the old individual reads during rollback.

`kova-backend` has separate Hyperdrive runtime/privileged bindings. Both disable SQL
caching and use TLS to the direct Supabase endpoint (without chaining Supavisor).
Each connection reads its binding inside the current invocation. `kova-backend-jobs` has only
the runtime binding, no owner URL and no public route. Private per-tenant alarms
process one chat job per invocation using the existing PostgreSQL leases and
uncertain-call protection. A five-minute sweep recovers missed wakes and performs
existing retention/outbox maintenance. No Docker daemon or polling process runs.

Release identity uses the versioned text binding `KOVA_BUILD_SHA`; legacy sealed
metadata is left unchanged. Publication never rotates real secrets or bypasses
Cloudflare rollback protections. Public frontend acceptance waits briefly only
when the captured previous build is still propagating, then runs the full health
and version contract. HTTP failures and unexpected builds remain blocking.

The owner chose Workers Free and postponed document ingestion. Workers forcibly
disable new document uploads/processing and Fly wake commands. Existing files and
metadata are retained under the existing access/deletion/expiration policies.
Private assistant object operations use a native binding to the existing
`kova-assistant` bucket. The adapter retains the deleted-tenant tombstone check,
bounded reads, object keys and fail-closed storage errors; native Fly keeps boto3.
Product images use the existing original-file fallback; native thumbnail resizing
is unavailable. MFA QR and accountant PDFs remain available without Pillow. The
native deployment retains its existing dependencies and behavior.

The WebAssembly lock is separate from `backend/uv.lock`: Python 3.14, pg8000 and
compatible binary wheels are required. Postgres SCRAM uses native PBKDF2 where Pyodide lacks hashlib support.
Existing encrypted Fernet/AES-GCM formats
and certificate checks use Workers' native crypto through a small adapter, keeping
the native deployment's cryptography security floor. No obsolete crypto or Pillow
wheel is introduced. Only S3 service schemas are packaged from botocore.

## Validation

Run the existing frozen native backend suite, plus the complete suite with
`pg8000==1.31.5` installed in a disposable environment and a disposable Postgres
database. The two RLS denial tests use connection-close rollback so that an
intentionally aborted transaction is never implicitly committed; authorization
assertions and expected denials are unchanged.

Create the disposable `kova_app` role with
`backend/scripts/provision_app_role.sql`, password `kova_app`, after migrations.
The runtime test configuration rejects non-local database hosts. Resend/Sentry
traffic is intercepted by a test-only worker; unexpected HTTP destinations fail.

From the repository root (Node 24, uv 0.13.1):

```sh
uv python install cpython-3.14.2-emscripten-wasm32-musl
uv venv /tmp/kova-pyodide --python cpython-3.14.2-emscripten-wasm32-musl
uv pip install --python /tmp/kova-pyodide/bin/python --only-binary :all: --preview-features pylock -r deploy/cloudflare-backend/pylock.toml
cd deploy/cloudflare-backend
npm ci
KOVA_WORKERS_PACKAGES=/tmp/kova-pyodide/lib/python3.14/site-packages npm run build
PYTHONPATH=../../backend ../../backend/.venv/bin/python test/generate_fixtures.py .cloudflare/test-fixtures.json
KOVA_WORKERS_TEST_DATABASE_URL=postgresql://pos:pos@127.0.0.1:5432/pos npm test
```

The tests cover production startup/RLS, real bcrypt login, verification mail,
cookie attributes, CSRF, cross-tenant denial, offline sale replay, refresh/logout,
shared rate limits, native/Worker ciphertext interoperability, certificate
accept/reject parity, QR PNG generation, sanitized Sentry delivery and isolated
job scheduling. Test profiles run separately to bound local Python runtime memory.
Manual PDF QA compared rendered native/Worker output pixel for pixel (identical).
Local timings are not measurements of deployed Cloudflare CPU or memory limits.

## Deployment inputs and acceptance

Use the local `node_modules/.bin/cf` with the pinned CLI/config. `npm ci` applies
a narrowly checked beta.18 fix: Python module paths must not start with `./`
inside the metadata filesystem. The packaging regression preserves JavaScript
module behavior. Keep the Free subscription; do not provision
Containers or paid compute. The current documented limits include a 64 MiB bundle,
100,000 Worker requests/day and separate Durable Objects request/duration/storage
quotas. These are ceilings, not a promise of unlimited SaaS use. Supabase, Stripe,
email, inference and existing R2 costs remain separate.

`prepare_config.py` transfers recognized existing deployment bindings via Fly SSH
directly into private local deployment files, without displaying values. Do not
inspect, commit, upload or log those files. Pass the generated inputs directly to
`cf --body @file` / `cf deploy --secrets-file file`, then delete them after use.
Do not rotate signing/encryption keys during the migration. The job secret set
excludes database owner URLs, Stripe credentials and Ops MFA roots.

Set `KOVA_HYPERDRIVE_APP_ID` and `KOVA_HYPERDRIVE_PRIVILEGED_ID` for builds. Deploy
jobs first, API second, gateway last, selecting the corresponding prebuilt Worker.
The prebuilt Worker names are `kova-backend-jobs`, `kova-backend` and
`kova-backend-gateway`. Candidate routing is only `api-preview.kovasuite.com`. Production routing requires
`KOVA_CLOUDFLARE_BACKEND=1`; never set it before deployed acceptance. Keep Fly and
its DNS/version recovery information until release and real-session acceptance.

Still required: deployed CPU/memory/startup checks, genuine production-session
acceptance on an isolated candidate frontend, release/recovery integration and
public API cutover. Stop Fly machines only after these pass; preserve recoverable
configuration. Existing CI/release safety gates remain required.

The opt-in release provider captures all three serving backend versions before
mutation, runs the existing Alembic migrations, publishes jobs/API/gateway in that
order, and recovers those exact versions on failed acceptance. CI needs the two
Hyperdrive ID variables and the existing `SUPABASE_DB_URL` migration secret; sealed
Worker secrets stay on Cloudflare. The migration credential is excluded from
frontend candidate subprocesses. Fiscal/account maintenance calls the canonical
API domain, and document-host activation is blocked while the backend flag is on.

The owner can now log into the candidate. Browser inspection found a dashboard
error: the configured assistant storage client attempted unsupported Python TLS,
and simultaneous dashboard requests queued behind one cookie's coordinator.
The R2 binding and route-aware routing fixes pass local runtime tests, including
deleted-tenant denial and parallel session isolation. Deployed dashboard, reload
and logout acceptance remain required before public cutover.
Cold startup is also under measurement; package imports now run at module scope
for Cloudflare's deployment snapshot, while credentials, RLS checks and all I/O
remain invocation-local. Temporary transport probe endpoints are not release code.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Hyperdrive TLS](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/),
[query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).
