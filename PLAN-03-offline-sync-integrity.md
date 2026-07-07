# PLAN-03 — Offline-Sync Integrity (Timestamp, Cold-Offline Catalog, Batch Resilience)

## Priority and rationale

**Rank 3.** "Vende sin internet, sincroniza después" is a core Kova promise and a differentiator for Mexican SMBs with unreliable connectivity. Three confirmed defects undermine it:

- **D1 — client sale timestamp dropped:** an offline sale is stamped at *sync* wall-clock, not ring time. A sale rung at 23:50 that syncs at 00:10 lands in the **next day's** report; daily totals cannot be reconciled against the paper close. This is a silent data-correctness bug in the exact reports Kova sells.
- **D2 — cold-offline register broken ("POS no abre offline"):** the catalog is fetched over `NetworkOnly` and never persisted to IndexedDB, so opening the register while offline shows an error card — you cannot ring a sale from a cold start.
- **D3 — batch fragility:** a non-HTTP exception (or a concurrent `client_uuid` `IntegrityError`) in one sale 500s the whole sync request and false-dead-letters already-committed sales.

Plus **D10** (429 schedules no backoff). High leverage: these are correctness + reliability fixes on the feature customers most need to trust, and they're contained to the sync/offline modules.

## Goal

- Offline sales carry and persist the client ring-time; reports, receipts, and shift attribution use the ring-time, not the sync time.
- The register opens and can ring sales on a cold offline start: the catalog is cached to IndexedDB and served stale-while-offline.
- A single failing or racing sale in a batch fails only that item (per-sale result), never the whole batch; already-committed sales are never false-dead-lettered.
- A 429 rolls back to pending **and** schedules a `Retry-After`-honoring retry.

## Current behavior (repository evidence)

- **Timestamp:** queue item has `created_at`/`updated_at` (`offline/types.ts:30-31`, set at ring time in `offline/queue.ts`), but `offline/sync.ts:40-47` sends only `{client_uuid, order, shift_id?}`; `sync/schemas.py:13-18` has no timestamp field; `orders/models.py:33` stamps `created_at` at INSERT (sync time). Reports/receipts key off `Order.created_at`.
- **Cold-offline:** `vite.config.ts:74` navigateFallback serves the precached shell (so the app *boots* offline), but `RegisterView.load()` (`RegisterView.tsx:164-176`) fetches `/api/v1/catalog/*` which Workbox routes as `NetworkOnly` (`vite.config.ts:96-98`); offline → both reject → `loadState="error"` → error card. Dexie schema (`offline/db.ts:8-10`) has only `offline_sales`; products/categories are never cached.
- **Batch:** `sync/service.py:55` catches only `HTTPException`; each sale commits independently in `create_order` (`orders/service.py:299`). A non-HTTP error escapes the loop → 500 with no `results` array → `offline/sync.ts:67-75` marks the whole chunk `failed`. Concurrent same-`client_uuid` INSERT hits `uq_orders_tenant_client_uuid` with no `try/except IntegrityError` around the order INSERT.
- **429:** `offline/sync.ts:54-66` rolls back to pending (no attempt burn) but `syncOfflineSales` returns normally, so `syncWorker`'s `catch`/`scheduleRetry` (`syncWorker.ts:44-53`) never runs; recovery waits for an incidental trigger, ignoring `Retry-After`.

## Problems identified

1. D1: sale time lost in transit; misdated sales corrupt daily reports/closes.
2. D2: catalog not cached → cannot open/ring offline from cold.
3. D3: non-HTTP / concurrent-race exceptions abort the batch and false-dead-letter committed sales.
4. D10: 429 schedules no backoff.

## Scope

**Included:** `backend/app/sync/{schemas,service}.py`, `backend/app/orders/{schemas,service,models,repository}.py` (add `occurred_at`), a reversible Alembic migration, `frontend/src/offline/{db,queue,sync,syncWorker,types}.ts`, `frontend/src/catalog/api.ts` + `RegisterView.tsx` (catalog caching), `frontend/vite.config.ts` (only if a runtime cache rule helps), tests. **Excluded:** changing dedup/idempotency semantics (they work), offline auth-refresh behavior (works), the billing/RLS work.

## Exact files to modify / create

- **`backend/alembic/versions/00XX_order_occurred_at.py`** (new) — add nullable `orders.occurred_at TIMESTAMPTZ`; backfill `occurred_at = created_at` for existing rows; index if reports will filter on it. Expand-and-contract (nullable first; a later contract migration can set NOT NULL once all writers populate it).
- **`backend/app/orders/models.py`** — add `occurred_at` column (default `created_at` semantics at the app layer).
- **`backend/app/orders/schemas.py`** — accept optional `occurred_at` on order create (for the sync path); default to server now for online sales.
- **`backend/app/orders/service.py`** — persist `occurred_at` (client ring-time when provided, else server now); use it wherever sale time matters. Validate `occurred_at` is not absurdly future/old (clock-skew clamp).
- **`backend/app/orders/repository.py`** — reports/order-list day-bounds should read `occurred_at` (align with the tz-aware reports module); fix the naive-UTC day bounds at `repository.py:159-168`.
- **`backend/app/sync/schemas.py`** — add `occurred_at` to `OfflineSaleSyncItem`.
- **`backend/app/sync/service.py`** — pass `occurred_at` through to `create_order`; wrap the per-sale loop to catch `Exception` (and `IntegrityError`) → record that item as `failed` with a reason and continue; on a concurrent `client_uuid` `IntegrityError`, treat as a successful replay (look up the existing order and return it as `synced`).
- **`frontend/src/offline/types.ts` / `queue.ts` / `sync.ts`** — include `occurred_at` (ring-time) in the sync payload.
- **`frontend/src/offline/db.ts`** — add a Dexie store for cached catalog (`products`, `categories`, `modifier_groups`) keyed by id, with a `cached_at`.
- **`frontend/src/catalog/api.ts` + `frontend/src/register/RegisterView.tsx`** — write catalog to IndexedDB on every successful online fetch; on fetch failure (offline), read from IndexedDB and render a "modo sin conexión — catálogo en caché" state instead of the error card.
- **`frontend/src/offline/sync.ts` / `syncWorker.ts`** — on 429, throw (or signal) so `scheduleRetry` runs and honors `Retry-After`; add a `break`/backoff so a large backlog doesn't hammer every chunk.

New files: the migration; frontend tests; `backend/app/tests/test_offline_sync_resilience.py`.

## Dependencies

- The `occurred_at` migration must land before the sync payload starts sending it (expand first).
- No dependency on PLAN-01/02, but ordering after PLAN-02 means the migration runs under the owner role (fine).

## Step-by-step implementation order

1. **Migration + model: add `orders.occurred_at` (nullable, backfill = created_at).**
   - Data model: new nullable column + backfill. API: none yet. UI: none. Security: none. Backward-compat: nullable, existing readers unaffected. Migration: expand (reversible).
   - Tests: migration up/down/up; backfill correctness.

2. **Backend accepts + persists `occurred_at` (schemas, service).**
   - Behavior: online orders set `occurred_at = now`; the sync path uses the client value with a skew clamp. Reads that represent "sale time" use `occurred_at`.
   - API impact: additive optional field on order create and sync item. Security: clamp client time to a sane window (e.g. not >24h future). Backward-compat: absent field → server now.
   - Tests: sync a sale with a past `occurred_at`; assert the order's report bucket uses ring-time, not sync-time.

3. **Reports/order-list use `occurred_at`; fix naive UTC bounds in orders repo.**
   - Data model: none. API: unchanged response shape. UI: correct dates. Backward-compat: rows with `occurred_at = created_at` behave as before.
   - Tests: cross-midnight sale synced next day lands in the ring-time day; reports totals match paper close.

4. **Frontend sends `occurred_at` (types/queue/sync).**
   - Behavior: the ring-time already captured at queue time is included in the payload.
   - Tests: vitest on `offline/queue`/`sync` payload shape.

5. **Frontend caches catalog to IndexedDB; offline read path (db, catalog/api, RegisterView).**
   - Behavior: successful online catalog fetches persist to IndexedDB; offline fetch failures read the cache and render the register with a clear offline-catalog banner.
   - Data model (client): new Dexie store. Security: catalog is tenant-scoped data already in the client; ensure the cache is cleared on logout/tenant switch. Backward-compat: additive.
   - Tests: vitest simulating offline fetch → renders register from cache; e2e `offline-sync.spec.ts` extended to cold-offline (unmock catalog offline).

6. **Batch resilience (sync/service) + 429 backoff (sync/syncWorker).**
   - Behavior: per-sale try/except so one failure → one `failed` result; concurrent `IntegrityError` → replay lookup → `synced`; 429 → rollback + scheduled `Retry-After` retry with a chunk break.
   - API impact: response always includes a per-sale `results` array (never a bare 500 for one bad item). Security: none. Backward-compat: clients already parse per-sale results.
   - Tests: `test_offline_sync_resilience.py` — one poisoned sale among good ones commits the good, fails only the bad; concurrent duplicate resolves to a single order; vitest for the 429 retry scheduling.

## Edge cases

- **Cross-midnight & DST:** ring-time in the tenant tz must bucket into the correct local day even when synced hours later or across a DST change.
- **Clock skew / malicious client time:** clamp `occurred_at` (reject/clamp absurd future or far-past values); never let a client backdate into a closed reporting period without bound.
- **Closed-shift attribution:** a late-synced sale keeps its `shift_id`; closed-shift totals stay frozen (confirmed existing behavior) — do not change it; the ring-time fix must not retroactively alter a closed corte.
- **Concurrent duplicate (`client_uuid`) INSERT:** must resolve to the single existing order and return `synced`, not a false dead-letter.
- **Poison sale (permanently invalid):** must dead-letter *only that item* after retries, with a clear reason, so the operator can fix it in the sync-queue view.
- **Cache staleness:** an offline-cached catalog may be out of date (price changed online); the offline sale still uses the cached price — acceptable, but the receipt/report must reflect the price actually charged (already stored per line at sale time).
- **Logout/tenant switch:** cached catalog must be wiped to avoid cross-tenant leakage in the client.
- **Large backlog 429:** must back off, not loop every chunk into a 429.
- **Multiple tabs:** the existing `isSyncing` guard plus dedup must still hold; the direct `syncOfflineSales` call in `RegisterView` should ideally route through the guard (noted in audit; optional cleanup here).

## Security requirements

- `occurred_at` is clamped server-side; a client cannot arbitrarily rewrite history.
- Cached catalog in IndexedDB is tenant-scoped and cleared on logout/tenant switch (no cross-tenant client cache).
- No change to auth/CSRF on the sync path; sync remains authenticated + commercially gated.
- Dedup/idempotency guarantees (idempotency key + `uq_orders_tenant_client_uuid`) are preserved — no duplicate orders under any retry/race.

## Data migration and rollback

- **Migration sequence:** add nullable `occurred_at` + backfill (expand) → writers populate it → (optional later contract) set NOT NULL.
- **Backfill:** `occurred_at = created_at` for all existing rows (they were online sales, so ring-time == created_at).
- **Compatibility window:** during expand, old clients that don't send `occurred_at` still work (server defaults to now for online, and sync items without it fall back to server now — acceptable until the frontend ships).
- **Rollback:** drop the column (contract-reverse) and revert code; reports fall back to `created_at`. Client cache store is additive and harmless if unused.
- **Recovery if deploy fails:** since `occurred_at` defaults to `created_at`, a partial rollout degrades to current behavior, not to corruption.

## Testing strategy

- **Unit (backend):** `occurred_at` clamp; sync passthrough; report bucketing by ring-time.
- **Integration (backend, `test_offline_sync_resilience.py`):** poisoned-sale isolation; concurrent-duplicate replay; cross-midnight bucketing.
- **DB:** migration up/down/up + backfill.
- **Frontend (vitest):** payload includes `occurred_at`; offline catalog read path renders register from cache; 429 retry scheduling.
- **E2E (`frontend/e2e/offline-sync.spec.ts`):** extend to a true cold-offline scenario (catalog unavailable) proving the register renders from cache and a sale can be queued.
- **Regression:** existing `test_offline_sync.py`, `bdd/test_offline_sync.py`, and offline vitest stay green.
- **Manual:** in the local stack, load the register online, go offline, reload, confirm the register renders from cache and a sale queues; ring a sale near local midnight, sync after midnight, confirm it reports on the ring-time day.

## Observability

- Log per-sync-batch counts: attempted / synced / failed / replayed (no PII).
- Metric on dead-letter creation rate (a spike indicates a regression in batch resilience).
- Log when the offline catalog cache is served (offline-mode indicator) — helps support diagnose "no products" reports.
- Do not log customer data or full order payloads.

## Acceptance criteria

- Given a sale rung offline at 23:50 local time that syncs at 00:10, when it is persisted, then its `occurred_at` is 23:50 and it appears in the 23:50 day's sales report and totals (not the next day).
- Given the register was loaded once online, when the device goes fully offline and the register page is reloaded, then the register renders from the IndexedDB catalog cache and a sale can be added to the cart and queued.
- Given a sync batch of N sales where one raises a non-HTTP exception, when the batch is processed, then the other N−1 sales are committed and returned as `synced`, and only the failing sale is returned as `failed` — the request does not 500.
- Given two concurrent sync attempts for the same `client_uuid`, when both run, then exactly one order exists and both attempts observe `synced` (no duplicate, no false dead-letter).
- Given a 429 from the sync endpoint, when the client handles it, then the affected items return to `pending` (no attempt burn) and a retry is scheduled honoring `Retry-After`.
- Given a logout, when the client state is cleared, then the cached catalog is removed from IndexedDB.

## Verification commands

```bash
docker compose exec -T backend uv run ruff check
docker compose exec -T backend uv run alembic upgrade head
docker compose exec -T backend uv run alembic downgrade -1 && docker compose exec -T backend uv run alembic upgrade head
docker compose exec -T backend uv run pytest app/tests/test_offline_sync.py app/tests/test_offline_sync_resilience.py app/tests/bdd/test_offline_sync.py -q
npm --prefix frontend run lint && npm --prefix frontend run typecheck
npm --prefix frontend test -- offline
npm --prefix frontend run test:e2e -- offline-sync
```

## Definition of done

- `occurred_at` is persisted and used for sale-time everywhere; cross-midnight test passes.
- Cold-offline register works from the IndexedDB catalog cache (e2e proven).
- Batch resilience + concurrent-duplicate handling proven; no bare-500 for one bad item.
- 429 schedules a `Retry-After` retry.
- Cache cleared on logout; dedup guarantees intact.
- Migration reversible; all offline tests (backend + frontend + e2e) green.

## Risks and mitigations

- **Risk:** allowing client-supplied time enables backdating fraud. **Mitigation:** server-side clamp + never allow writes into a closed period beyond a bounded skew; audit-log the sale.
- **Risk:** IndexedDB catalog cache grows or leaks across tenants. **Mitigation:** key by tenant, wipe on logout, bound size.
- **Risk:** broadening the sync exception handler hides real errors. **Mitigation:** record the exception reason per item + metric; do not swallow silently.
- **Risk:** reports subtly change because they now read `occurred_at`. **Mitigation:** backfill `occurred_at = created_at` so historical numbers are unchanged; snapshot-test report totals before/after.
