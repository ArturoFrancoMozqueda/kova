# Resident FastAPI on Cloudflare

This directory builds the native FastAPI API image and a JavaScript Container
controller. It keeps the existing `kova-backend` Worker, `KovaApi` namespace,
`KovaRateLimit` SQLite buckets, public gateway, domain, frontend and private job
Worker. It does not expose a new HTTP hostname or a public container port.

Only the existing `api-0` object starts a process. Other API shard names forward
to it. `maxInstances: 1` and `instanceType: basic` pin one process to the smallest
instance above lite: 1/4 vCPU, 1 GiB RAM and 4 GB disk. The SDK's idle hook deliberately returns
without `stop()`/`destroy()` so the Linux process remains resident through idle
periods. Stops schedule recovery with the SDK scheduler, without replacing its
alarm handler. Platform maintenance and releases can still restart a process.

Native environment values are projected from the checked-in Settings allowlist
inside the Worker runtime. Existing sealed configuration remains in the same
Worker; no secret-export endpoint or serialized binding exists. Native runtime
and privileged database URLs must be separately provisioned before activation.
The runtime role must pass the application's existing RLS/ownership guards.
Retired Fly configuration and document ingestion remain disabled.

The resident projection pins database connection recycling to 1,800 seconds,
while retaining checkout pre-ping and the existing bounded pools. This avoids
needlessly replacing healthy connections after a five-minute idle interval;
pre-ping still replaces connections closed by the upstream server. Process
residency alone does not guarantee connection reuse. The shared Settings default
remains 300 seconds and Workers continue using Hyperdrive without a local pool.
This removes a known reconnect trigger; it does not establish how much of any
observed request time was spent connecting rather than querying or rendering.

Fresh public product-image SELECTs use psycopg AUTOCOMMIT on that same privileged
pool to avoid unnecessary BEGIN/ROLLBACK commands. Session close restores the
connection's default isolation before reuse. Existing transactions, scoped
sessions, other drivers and Workers retain their previous behavior; auth and
webhook writes still use transactions and rollback normally. This creates no
additional pool and keeps checkout pre-ping enabled.

`KOVA_RELEASE_SHA` and `KOVA_IMAGE_SHA` are baked together into the API image.
The Worker never projects either field, including from future Settings entries:
Worker and image rollouts can overlap different versions. The native boot guard
still requires their exact match; readiness separately compares the running
image's release SHA with the controller's `KOVA_BUILD_SHA` and the public verifier
requires the requested release and resident process identity before acceptance.

Production is active with `KOVA_NATIVE_BACKEND=1` after release
[`39531362675`](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/39531362675)
for `6bd525e42c22c2b6d8798638ef4de6f3498d47af`. The one-time database provisioning
run `39529850894` succeeded; do not repeat `provision_once` after success. It
intentionally refuses an existing native role or sealed native connection names.
Current acceptance evidence and remaining QA live in
[`docs/current-sprint.md`](../../docs/current-sprint.md).

The public-photo exception is narrow: versioned GET product image UUIDs only,
supported width and raster content type, explicit public origin response, no
session cookies/private variation. Shared cache freshness is at most 300 seconds
across all hops. Private API responses and errors stay `no-store`; database
ownership/activity checks still run on every miss. Browser/edge replacement keys
use the upload revision, while the 4 MiB native derivative cache keys actual
content. Original photo bytes remain in Postgres. The native image bounds blob
admission and decoder concurrency retain their stricter lite memory bounds.

CI retains its stricter 1/16-vCPU, 256-MiB lite resource gate: it seeds photos
only into its isolated local database, then checks
JPEG EXIF, PNG alpha, derivative reuse, process identity, 3,000 ms latency and the
same container's memory peak/OOM status. No extra Python app runs in the container
for this measurement. After publishing, manual `verify_public_images=true` on the
Resident backend acceptance workflow uses the merged commit's required CI gate
and a read-only SQL transaction to locate one existing public photo. It verifies
API/frontend cache HITs and private `no-store` boundaries without creating data,
logging photo IDs/bodies or exporting database credentials. Keep `provision_once`
false for that check.

The native process calls `http://rate-limit.kova.internal/allow` and
`http://jobs.kova.internal/wake`. These virtual hostnames are available only
through Container outbound interception. They are not public API paths. The
first preserves the existing HMAC-named persistent limiter buckets; the second
preserves immediate tenant-specific job wake-ups and the private scheduler's
cohort checks. Bodies are bounded and validated; outages never return success.

Build and validate locally with Node 24 and Docker:

```sh
npm ci --prefix deploy/cloudflare-native
npm test --prefix deploy/cloudflare-native
KOVA_BUILD_SHA="$(git rev-parse HEAD)" node deploy/cloudflare-native/build.mjs
```

The builder creates `kova-native:<full SHA>` for `linux/amd64` and writes both
the controller and the Container image reference to Build Output. Set
`KOVA_NATIVE_IMAGE` only for an already built local image; the builder checks its
architecture. Image release identity still has to pass runtime acceptance.
No database URLs, passwords, session keys or provider keys are build arguments.

Production activation must capture the exact rollback version, confirm sealed
runtime URLs exist, pass native CPU/RAM acceptance and the repository CI gate,
apply the Container application, then verify `/health`, `/health/db`, anonymous
auth contracts, cookies and resident process identity after idle. Container
readiness RPC checks the full release SHA and database reachability. Do not
publish an unverified diagnostic image/version.

Cloudflare's application GET can return expanded sizing rather than the
`instance_type` label. Rollback capture recognizes only the exact lite tuple
(`vcpu: 0.0625`, `memory_mib: 256`, `disk.size_mb: 2000`) or basic tuple
(`vcpu: 0.25`, `memory_mib: 1024`, `disk.size_mb: 4000`). It captures and restores
the original named size, so rolling back a basic rollout can restore lite.
Missing, partial, conflicting or other sizing fails closed. Never log or persist
the application's environment or full API response.

The official [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)
and [instance limits](https://developers.cloudflare.com/containers/platform/limits/)
were checked on 2026-10-21. Basic provides four times lite's CPU capacity;
this does not promise four times lower request latency. Production measurements
showed concurrent uncached photo reads still missing the interaction target on
lite after derivative reuse; they did not establish CPU throttling as the cause.

At 720 resident hours, basic provisions 720 GiB-hours RAM and 2,880 GB-hours disk.
If this instance receives all shared Workers Paid allowances (25 GiB-hours RAM
and 200 GB-hours disk), those resources cost approximately USD 6.93036, compared
with lite's USD 1.70748: an incremental USD 5.22288 per month. The existing USD 5
Workers plan is separate. CPU is billed on active usage, not reserved capacity:
375 vCPU-minutes are included, then USD 0.000020 per vCPU-second. All allowances
are shared across the account; other usage, egress and taxes remain additional.
This estimate is not a fixed total-spend cap.
