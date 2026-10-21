# Resident FastAPI candidate on Cloudflare

This directory prepares the native FastAPI API image and a JavaScript Container
controller. It keeps the existing `kova-backend` Worker, `KovaApi` namespace,
`KovaRateLimit` SQLite buckets, public gateway, domain, frontend and private job
Worker. It does not expose a new HTTP hostname or a public container port.

Only the existing `api-0` object starts a process. Other API shard names forward
to it. `maxInstances: 1` and `instanceType: lite` prevent accidental horizontal
replication or a larger instance. The SDK's idle hook deliberately returns
without `stop()`/`destroy()` so the Linux process remains resident through idle
periods. Stops schedule recovery with the SDK scheduler, without replacing its
alarm handler. Platform maintenance and releases can still restart a process.

Native environment values are projected from the checked-in Settings allowlist
inside the Worker runtime. Existing sealed configuration remains in the same
Worker; no secret-export endpoint or serialized binding exists. Native runtime
and privileged database URLs must be separately provisioned before activation.
The runtime role must pass the application's existing RLS/ownership guards.
Retired Fly configuration and document ingestion remain disabled.

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

The official [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)
and [idle lifecycle](https://developers.cloudflare.com/containers/api/container-class/#onactivityexpired)
were checked on 2026-10-20. One lite process running 720 hours provisions
180 GiB-hours RAM and 1,440 GB-hours disk. After the Workers Paid included
allowances, those two resources add approximately USD 1.71 to the existing
USD 5 plan, before actual CPU overages, other account usage, egress and taxes.
This estimate is not a fixed total-spend cap.
