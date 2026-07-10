# KOVA — Complete Production-Readiness Audit

**Date:** 2026-07-07
**Branch audited:** `feature/full-audit-plan` (backend-identical to `main`; differs only in `frontend/src/reports/**` — the reports redesign)
**Method:** Static code tracing across frontend/backend/migrations/tests, git-history and cross-branch diffing, live end-to-end walkthrough of the local `docker compose` stack with Playwright (real signup→verify→login→dashboard→catalog→reports→shifts→POS→billing→settings→mobile→offline), read-only inspection of the production landing (`kovasuite.com`) and backend (`api.kovasuite.com/health`), and full test-suite runs.
**Constraint honored:** No application code, migrations, infrastructure, or production data was modified. Only the local dev database volume was reset for an honest test run.

Confidence labels used throughout: **Confirmed** (traced to code + reproduced or test-backed), **Likely** (traced to code, not runtime-reproduced), **Possible** (plausible from partial evidence), **Not verifiable** (needs runtime/dashboard access outside the repo).

---

## 1. Executive summary

Kova is a well-built, genuinely premium multi-tenant POS + analytics SaaS for Mexican SMBs. The engineering fundamentals are strong: money is `Decimal`/`Numeric(12,2)` end-to-end with no floats, order creation is idempotent with dual dedup and row-level product locking, application-level tenant isolation is consistent and test-covered, auth uses HttpOnly-cookie JWTs with per-request DB role reads (no stale-permission window), CSRF is a sound double-submit scheme, Stripe webhook signatures are verified before parsing, and the app ships with 322 passing backend tests and 173 passing frontend tests. The live walkthrough showed a polished, coherent es-MX product with excellent empty states, an onboarding checklist, timezone-aware reports, and a real mobile bottom-nav.

The blocking risks are **not** in the POS core — they are in the **billing lifecycle** and in **operational/defense-in-depth gaps** that determine whether Kova can be *sold* safely:

- **Revenue integrity (highest leverage):** Stripe `customer.subscription.*` events arrive in production with no `tenant_id` metadata and are silently marked *ignored*, so cancellations/downgrades never reach the local subscription row — a canceled customer keeps access forever. Separately, a `past_due`/`canceled` tenant can start a second checkout with no Stripe customer reuse, producing **double billing**. Trial-ending emails are fully implemented but **have no scheduler**, so they never send.
- **Security defense-in-depth:** RLS policies exist on nearly every table but are **inert** (no `FORCE ROW LEVEL SECURITY`, app connects as the table owner/superuser). Tenant isolation currently rests **entirely** on application-level filters — which are solid and test-proven, but the documented "RLS as defense in depth" property is not actually in force, and this is a self-listed pre-beta hard gate.
- **Offline correctness:** the client sale timestamp is dropped in transit, so a sale rung offline is dated at *sync* time — cross-midnight syncs land in the wrong day and can't be reconciled against a paper close. The register is also non-functional on a cold offline start because the catalog is `NetworkOnly` and never cached to IndexedDB ("POS no abre offline").
- **Cash/inventory edges:** refunds don't validate the refund method against the order's actual payments (a transfer-paid order can be cash-refunded, draining the drawer), and manual inventory adjustments have no negative-stock floor.

None of these require a rewrite. The architecture is sound; every finding below is an incremental, testable fix. The five plans (`PLAN-01`…`PLAN-05`) sequence them by leverage.

**Overall production-readiness verdict:** Core POS is beta-ready and already deployed. **Do not onboard paying customers until the billing-lifecycle findings (§10) are fixed** — they are the difference between "charges correctly" and "gives away access / double-bills." Everything else is hardening that can land in parallel.

---

## 2. Current architecture (reconstructed from code)

**Frontend** — React 18 + Vite 6 + TypeScript SPA, `react-router-dom` v6 (all routes lazy-loaded in `frontend/src/App.tsx`), TanStack Query + React Context (`AuthProvider`) for state, Dexie/IndexedDB for the offline sale queue, `vite-plugin-pwa`/Workbox service worker, Recharts (lazy chunk) for reports, Tailwind + a small shadcn-style kit, Sentry for errors. es-MX copy centralized in `frontend/src/i18n/messages.ts`. Landing is SSR-prerendered (`scripts/prerender.mjs`). Deployed to **Vercel** (`frontend/vercel.json`), which rewrites `/api/*` → `https://api.kovasuite.com` and sets a strict CSP.

**Backend** — FastAPI modular monolith (`backend/app`), SQLAlchemy 2 ORM + Alembic (revisions 0001–0035), organized by domain module (`auth`, `billing`, `catalog`, `orders`, `pricing`, `inventory`, `modifiers`, `shifts`, `reports`, `sync`, `onboarding`, `tenants`, `employees`, `rbac`, `business_settings`, `email`, `audit`, `idempotency`, `observability`, `telemetry`, `health`). Deployed to **Fly.io** (`backend/fly.toml`, app `pos-project-backend`, single `app` process, `release_command = alembic upgrade head`). Managed by `uv`.

**Data** — Postgres. Local dev via `docker-compose.yml` (Postgres 16); staging/prod via **Supabase**. Money in `Numeric(12,2)`; stock is a derived `SUM(inventory_movements.quantity_delta)` (append-only ledger, no stored counter). Daily backups to **Cloudflare R2** via `.github/workflows/db-backup.yml` (cron `0 9 * * *`).

**External services** — Stripe (Checkout hosted redirect, single Standard Plan $299 MXN/mo, 7-day trial + 7-day grace), Resend (transactional email), Sentry, Upstash Redis (rate limiting), Cloudflare R2 (backups), UptimeRobot. Documented in `docs/service-audit.md`.

**Request pipeline (outermost→inner):** body-size limit (2 MB) → request-context/logging → CSRF → security headers → CORS (single origin, credentials) → router. Auth dependency `get_current_session` (`backend/app/shared/dependencies.py:16`) decodes the access-token cookie, re-verifies membership, and sets Postgres `app.tenant_id` via `set_config`.

**CI/CD** — `.github/workflows/ci.yml`: backend (ruff, alembic upgrade, pytest, OpenAPI export), frontend (lint, typecheck, vitest, build, bundle-secret scan), migration reversibility (up→down→up), Playwright smoke on main against the Vercel deploy, `flyctl deploy` on main, and Gitleaks on every run.

---

## 3. Repository & application map

| Area | Path | Notes |
|---|---|---|
| Frontend routes | `frontend/src/App.tsx` | Public (landing/auth/legal), dev-only previews, protected (`RequireAuth`+`AppShell`) |
| POS | `frontend/src/register/RegisterView.tsx` | Offline-first: always queues to IndexedDB then attempts immediate sync |
| Offline | `frontend/src/offline/{db,queue,sync,syncWorker,types}.ts` | Dexie store `offline_sales`, `client_uuid` idempotency, backoff worker |
| Reports | `frontend/src/reports/**` | Recharts dashboard (redesigned on this branch) |
| Billing UI | `frontend/src/billing/*` | Hosted Stripe Checkout redirect; trial chip + banner |
| Auth backend | `backend/app/auth/{router,service,repository,models}.py` | Cookie JWT + rotating refresh |
| Orders | `backend/app/orders/{router,service,repository}.py` | Idempotent create, row-locked product, refund/void |
| Pricing | `backend/app/pricing/calculator.py` | `Decimal` quantize `ROUND_HALF_UP`, no tax layer |
| Shifts | `backend/app/shifts/{service,calculator,repository}.py` | Expected cash incl. cash sales; freezes at close |
| Sync | `backend/app/sync/{router,service}.py` | Delegates each sale to `create_order` with `client_uuid` |
| Billing backend | `backend/app/billing/{router,service,access,stripe_client,models}.py` | Webhook, checkout, access gate |
| Migrations | `backend/alembic/versions/0001…0035` | RLS policies, constraints, indexes |
| Tests | `backend/app/tests/**` (322), `frontend/src/**/*.test.ts(x)` (173), `frontend/e2e/**` (20 specs) | |

---

## 4. Major business workflows (traced)

1. **Signup → verify → login** — Confirmed working end-to-end (walkthrough: signup 201 with dev token, verify 200, login → `/dashboard`). Anti-enumeration on signup/reset; email-verification required before login; sessions revoked on password reset.
2. **Tenant creation** — only via signup; creator is always `owner`; no self-join; no second-tenant-via-signup. Confirmed tight.
3. **Employees/roles/invitations** — 256-bit single-use tokens (7-day TTL), owner-only role management, "last owner" guard. Confirmed, with a TOCTOU race caveat (§8).
4. **Products / inventory** — product row-locked on sale and on manual adjustment; stock = SUM of movements.
5. **Sale** — Confirmed idempotent (idempotency key + `uq_orders_tenant_client_uuid`), atomic single commit, split payments validated server-side, cash requires open shift (online path).
6. **Concurrent same-product sale** — Confirmed race-safe via `SELECT … FOR UPDATE` on the product row.
7. **Refund / void** — order row-locked; stock restored; per-item quantity caps prevent over-refund. Gap: refund method not validated vs actual payments (§9).
8. **Offline sale → later sync** — works if the register was loaded online first; dedup solid; timestamp not preserved and cold-offline broken (§11).
9. **Subscription checkout / webhooks / lifecycle** — signature-verified, dedup by event id; but subscription-lifecycle events lack tenant metadata and are dropped (§10).
10. **Trial expiration** — access gate computes trial from `tenant.created_at + 7d` (inclusive at day 7, UTC, DST-safe). Reminder emails never fire (no scheduler).
11. **Reports** — timezone-aware (tenant tz), excludes voids and refunded items; payment-mix not refund-adjusted (§9).
12. **Tenant/account deletion, export** — **absent** (§8, compliance gap).

---

## 5. Confirmed strengths

- **Money is correct.** `Numeric(12,2)` on every monetary column; `Decimal` with `ROUND_HALF_UP` in `pricing/calculator.py`; `str(Decimal)` serialization; Stripe amounts as integer minor units. No float anywhere in the money path. (Confirmed)
- **Order idempotency is real and layered.** `create_order` checks the idempotency-key store, then the `client_uuid` order lookup, backed by `uq_orders_tenant_client_uuid` (migration 0008). Sequential replays return the same order. (Confirmed, test-backed)
- **Concurrency on stock is race-safe on the sale path.** `get_active_product_for_update` (`orders/repository.py:12`) serializes concurrent sales; stock is an append-only ledger that cannot be corrupted by lost updates. (Confirmed)
- **Application-level tenant isolation is consistent and tested.** Every sampled repository query filters `tenant_id` from the server-derived membership; `test_tenant_isolation_routes.py` proves tenant B cannot read/patch tenant A across products/orders/reports/inventory/shifts/employees/modifiers/settings/subscriptions. (Confirmed)
- **No stale-permission window.** JWT carries no role claim; `require_permission` reads `membership.role` from the DB every request, so role changes take effect immediately. `tid` is re-verified against membership, not trusted from the token; `algorithms=["HS256"]` pinned. (Confirmed)
- **Stripe webhook signature verification** runs before any parsing, with 300s tolerance and constant-time compare; no unverified path exists. (Confirmed)
- **Security posture in production is solid.** Live headers confirm HSTS preload, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict CSP (`script-src 'self' https://js.stripe.com`), single-origin CORS with credentials. No auth tokens in web storage (build-gated by `secret-exposure.test.ts`). (Confirmed)
- **Test health is good.** 322 backend tests pass on a clean DB; 173 frontend tests across 35 files pass; typecheck clean. (Confirmed this session)
- **Premium, coherent es-MX UX.** Walkthrough confirmed strong empty states, onboarding checklist, trial banner, timezone display, and mobile bottom-nav. (Confirmed)

---

## 6. Confirmed defects (non-security correctness)

| ID | Defect | Evidence | Confidence |
|---|---|---|---|
| D1 | Client sale timestamp dropped on offline sync; order dated at sync wall-clock | `offline/sync.ts:40-47` (no timestamp field), `sync/schemas.py:13-18`, `orders/models.py:33` (`created_at` default) | Confirmed |
| D2 | Cold-offline register non-functional — catalog is `NetworkOnly`, never cached to IndexedDB | `vite.config.ts:96-98`, `offline/db.ts:8-10`, `RegisterView.tsx:164-176` | Confirmed |
| D3 | Non-HTTP exception in a sync batch aborts the whole batch and false-dead-letters already-committed sales | `sync/service.py:55` (only `except HTTPException`) | Confirmed |
| D4 | Refund method not validated against the order's actual payments → cash `refund_payout` for money never collected | `orders/service.py:449-453`, `orders/schemas.py:156` | Confirmed |
| D5 | Manual inventory adjustment has no negative-stock floor | `inventory/service.py:159-212`, `inventory/schemas.py:29-38` | Confirmed |
| D6 | `payment_breakdown` / `payment_mix` not refund-adjusted; inconsistent with `net_sales` on refund days | `reports/service.py:178-209, 743-767` | Confirmed |
| D7 | No DB constraint/lock guaranteeing a single open shift per tenant | `shifts/models.py:15-39`, `shifts/repository.py:10-15` (no lock, `.first()`) | Confirmed |
| D8 | Multi-tenant user login resolves membership via `.first()` → arbitrary/wrong tenant | `auth/repository.py:73-78`, `auth/service.py:257` | Likely |
| D9 | Trial-reminder job has no scheduler → emails never sent in prod | no scheduler in `main.py`/`fly.toml`/workflows; `email/trial_reminders.py` only | Confirmed |
| D10 | `429` on sync rolls back to pending but schedules no `Retry-After` backoff | `offline/syncWorker.ts:41-53`, `offline/sync.ts:54-66` | Confirmed |

---

## 7. Security findings

| ID | Severity | Finding | Evidence | Confidence |
|---|---|---|---|---|
| S1 | High (defense-in-depth) | **RLS is inert** — policies exist but no `FORCE ROW LEVEL SECURITY`; app connects as table owner/superuser (`postgres`). Isolation rests solely on app filters. | no `FORCE` in repo; `alembic/env.py:9` + `db.py:13` share `settings.database_url`; `docs/deployment.md:59`; ADR-009 lists separate role as future work | Confirmed |
| S2 | Medium | Unauthenticated cross-tenant asset reads (product image, receipt logo) bypass both RLS and app filters; guarded only by unguessable id | `catalog/image_router.py:226-255`, `business_settings/logo_router.py:189-202` | Confirmed (by design; needs sign-off) |
| S3 | Medium | Last-owner guard TOCTOU: `_count_active_owners` is an unlocked `COUNT(*)` → two concurrent demotes can strand a tenant with 0 owners | `employees/service.py:26-35, 269, 305` | Likely |
| S4 | Low-Med | Sessions not revoked on employee deactivation / role change (lockout still works via per-request membership check, but refresh can still mint tokens) | `employees/service.py:308` (no `revoke_all_sessions`) | Confirmed |
| S5 | Low-Med | Invitation-accept password policy weaker than signup (no digit/strength/max); bcrypt 72-byte truncation unhandled | `employees/schemas.py:49`, `employees/service.py:204-207`, `auth/service.py:25-26` | Confirmed |
| S6 | Low | Internal ops key compared with plain `!=` (not constant-time), unlike the CSRF path's `hmac.compare_digest` | `billing/router.py:103` | Confirmed |
| S7 | Low | Rate limiting fails **open** on `checkout` and `sync` in prod when Upstash is down; staging fails open even on auth; no throttle on invitation preview/accept or telemetry | `middleware/rate_limit.py:156-169, 234-236`; `billing/router.py:42`; `sync/router.py:18` | Confirmed |
| S8 | Low | `dev_reset_token`/`dev_verification_token` rendered by the frontend with no `import.meta.env.DEV` guard (backend gates it to local, so defense-in-depth only) | `frontend/src/auth/ForgotPasswordView.tsx:57`, backend `auth/router.py:79,185` | Confirmed |
| S9 | Low | No `SECRET_KEY` length/entropy floor (only the default value is rejected) | `main.py:44-47` | Confirmed |
| S10 | Info | No tenant/account deletion or data-export endpoint (LFPDPPP/GDPR erasure & portability) | grep of all routers; consent is captured at signup only | Confirmed absent |

**Not found (checked):** SQL injection (ORM parameterized throughout), secrets in the frontend bundle (build-gated), unsafe CORS wildcard (single origin), missing webhook signature verification, alg-confusion on JWT, client-set prices (server-derived), IDOR on authenticated CRUD (all tenant-scoped).

---

## 8. Tenant-isolation findings

- **App-level isolation: solid (Confirmed).** All authenticated data endpoints filter by the server-derived `membership.tenant_id`; no client-supplied id is fetched without a tenant predicate on authenticated paths. Proven by `test_tenant_isolation_routes.py`.
- **RLS second layer: inert (Confirmed, S1).** Every `tenant_isolation` policy is bypassed because the connection role owns the tables and no policy is `FORCE`d. `docs/deployment.md` still lists "RLS policies authored and tested on Supabase" as an open hard gate — accurate. There is currently **no test that would fail if every policy were dropped**.
- **Intentional no-tenant-filter paths:** Stripe webhook (tenant resolved from event), internal subscriptions endpoint (`X-Internal-Key`), public asset endpoints (S2), auth/login cross-tenant lookups. Each is defensible but each is exactly what a forced-RLS layer would otherwise backstop.
- **Nested-resource queries** (`list_refund_items(refund_id)`, `get_shift_cash_movements(shift_id)`) scope only by parent id — safe *only because* the parent is fetched through a tenant-scoped lookup first. Fragile by convention.
- **Multi-tenant login `.first()` (D8):** the data model allows one user in many tenants (invitation accept adds a membership), but login/session resolves membership with `.first()`, so a multi-tenant user lands in an arbitrary tenant.

---

## 9. Data-integrity findings

- **Refund method vs payments (D4, Confirmed, P1 money).** `refund_payment_method` is a free client choice never checked against the order's collected methods. A bank-transfer-only order can be refunded `method="cash"`, generating a `refund_payout` cash movement that drains the physical drawer for money that never entered it; a split order can be over-cash-refunded. No per-method paid-amount ceiling. No test covers this.
- **Negative stock via adjustment (D5, Confirmed, P1).** `InventoryAdjustmentCreate.quantity_delta` is an unbounded `int` (only `!= 0`); `adjust_stock` applies it with no floor check → `-95` on-hand is reachable. The `OUT_OF_STOCK` guard exists only on the sale path.
- **Offline cash sale with `shift_id=None` (Confirmed, P1).** By design, a synced cash sale whose client `shift_id` is missing/foreign degrades to unattributed; it counts in sales reports but reconciles against **no** drawer. Codified as acceptable in comments; not surfaced operationally (no alert).
- **Single open shift not enforced (D7, Confirmed, P2 race).** No unique/partial constraint and no lock; double-tap/offline-replay can open two drawers; sales then split unpredictably.
- **Payment-mix not refund-adjusted (D6, Confirmed, P2).** `Σ payment_mix ≠ net_sales` on refund days (cash refunds are movements, not negative payments). Defensible as "collected by method" but undocumented and auditor-confusing.
- **Refund/void money integrity: sound.** Amounts server-derived; per-item quantity caps transitively cap total refunds ≤ order total (no tax/discount layer). Void blocks if refunds exist and vice-versa, both under the order row lock.
- **No IVA/tax layer at all (Confirmed).** `subtotal == total`; no `iva`/`tax`/`impuesto` anywhere. Confirm this matches product intent for es-MX invoicing expectations.
- **Money types: `Numeric(12,2)` + `Decimal` throughout (Confirmed).**

---

## 10. Billing & subscription findings (highest business leverage)

- **B1 — "Access granted forever" (High, Confirmed).** Checkout sets only *session*-level metadata (`stripe_client.py:61-63`), which Stripe does **not** propagate to the subscription object. So real `customer.subscription.created/updated/deleted` events arrive with **no `metadata.tenant_id`**, and the fallback never resolves a subscription object by its own `id` (`service.py:594-603`). Result: cancellations/downgrades are marked `ignored` (`service.py:612-615`), the local row stays `active`, and `_maybe_resync_period` heals only the period, never the status — a customer Stripe no longer bills keeps full access indefinitely. Tests miss it because they inject `metadata.tenant_id` that production won't send. No logger/alert on ignored-unknown-tenant events.
- **B2 — Double billing (Medium-High, Confirmed).** `create_checkout_session` blocks a new checkout only for `active`/`trialing` (`service.py:235-236`). A `past_due`/`unpaid`/`incomplete`/`canceled` tenant can start a fresh checkout; with **no Stripe customer reuse** (`stripe_client.py:55-64`), each checkout mints a new customer + subscription while the old one may keep billing. The single local row (unique on `tenant_id`) is overwritten to the newest.
- **B3 — Lost checkout webhook blocks a paying customer (Medium, Confirmed).** Access is granted only by `checkout.session.completed`; the success return page shows a toast but does **not** poll/reconcile (`BillingView.tsx:90-116`), and `_maybe_resync_period` early-returns unless a row already exists. If the webhook is lost, a paying customer stays 402-blocked until Stripe redelivers.
- **B4 — Trial reminders never fire (Medium, Confirmed, D9).** `send_due_trial_reminders` + `scripts/send_trial_reminders.py` are complete and unit-tested but nothing schedules them (no APScheduler/startup task, no Fly cron/worker, no GitHub workflow).
- **B5 — Pending-cancel window can't be undone (Low-Med, Confirmed).** While `cancel_at_period_end=true` with status still `active`, the active-guard blocks a new checkout and there's no resume endpoint; combined with B1, status may never reach `canceled`, so the owner can be stuck unable to re-subscribe.
- **B6 — Webhook secret / price ID have no live/test separation guard (Low-Med, Confirmed).** `_webhook_secret()` returns a single secret; a test-mode `whsec` in prod would silently verify test events. Success/cancel URL domains aren't validated.
- **B7 — No dispute / `trial_will_end` handling (Low, Confirmed).** Chargebacks never affect local access; `trial_will_end` is ignored (reminders are a separate DB-scan).
- **Correct & confirmed:** signature verification, event dedup, failed-event reprocessing on retry, trial/grace math (inclusive day-7, UTC, DST-safe, grace from first `past_due_at`), at-period-end cancellation semantics matching UI copy, integer-minor-unit currency handling, amount `29900` consistent backend↔frontend. Access gate blocks reads too for canceled/expired tenants (product decision to confirm).

---

## 11. Offline-sync findings

Precise capability statement (Confirmed):

| Capability | Status | Root cause |
|---|---|---|
| Open app fresh while offline | **Broken** | Shell precaches, but `RegisterView` catalog fetch (`/api/`, `NetworkOnly`) fails → error card (`vite.config.ts:96-98`) |
| View catalog offline | **Broken** | Products never persisted to IndexedDB (`db.ts:8-10` has only `offline_sales`) |
| Ring a sale offline | **Partial** | Works only if the register was loaded online first (products in React memory) |
| Sync later | **Works** | Reconnect/`online` trigger; 401 auto-refresh; dead-letters only if refresh token fully expired |
| Duplicate protection | **Works** sequential; **weak** under true concurrency | Dual dedup returns same order; concurrent same-`client_uuid` INSERT → uncaught `IntegrityError` → 500 → transient false dead-letter (never a duplicate order) |
| Timestamp fidelity | **Broken** | Client ring-time dropped in transit (D1) |

- **D1 (timestamp):** highest-impact — misdates late-synced sales; cross-midnight syncs corrupt the day's total vs paper close. Needs a schema field + payload change (expand-and-contract).
- **D2 (cold-offline):** the literal "POS no abre offline" symptom; fix = cache catalog to IndexedDB with a stale-while-offline read path.
- **D3 (batch fragility):** wrap the per-sale loop to catch non-HTTP exceptions and the concurrent `IntegrityError` so one bad/racing sale can't 500 the batch.
- **Shift attribution:** closed-shift totals are frozen at close and cannot change retroactively (Confirmed correct); the residual is the unattributed-cash gap above.
- **Dev caveat:** the live cold-offline reload in the walkthrough returned `ERR_INTERNET_DISCONNECTED` with an empty body, but the PWA service worker is typically disabled in `npm run dev`, so this specific reproduction is inconclusive on its own — the **code-level** finding (catalog never cached) is what stands.

---

## 12. Reliability & operational findings

- **No background scheduler exists** (B4/D9). Trial reminders, and any future dunning/cleanup, have nowhere to run. Fly has a single `app` process; no cron machine; only `db-backup.yml` is scheduled.
- **Rate limiting fails open** on `checkout`/`sync` in prod and everywhere in staging (S7). Single Fly VM + in-memory fallback means limits are also per-replica.
- **Backups exist; restore is unproven.** `db-backup.yml` dumps to R2 daily and prunes >7 days; `docs/current-sprint.md` still lists the **restore drill** as an open gate. (Not verifiable from repo — needs a real R2→fresh-Supabase drill.)
- **Email failures are swallowed** (`email/service.py:28`) — fire-and-forget by design, but there is no delivery gate/metric, so a Resend outage is invisible. `docs/current-sprint.md` flags making email delivery a production gate.
- **Error tracking present** (Sentry, backend + frontend). Health endpoint live in prod (`/health` 200). No documented alerting thresholds.
- **Single points of failure:** one Fly VM (`min_machines_running=1`), Supabase free tier (per `docs/service-audit.md`), single region `dfw`.

---

## 13. Testing findings

- **Backend: 322 passed** on a clean DB (exit 0). Strong coverage of auth, RBAC, tenant isolation (app-level), billing webhooks, cash reconciliation, refunds, split payments, offline sync (HTTPException branch), CSRF, rate limiting.
- **Frontend: 173 passed** across 35 files; typecheck clean. Heavy reports coverage; security guard test for token exposure.
- **E2E:** 20 Playwright specs; most mock `/api/*`, so they don't exercise real backend edges.
- **Coverage gaps (Confirmed by absence):** no test connects as a non-owner role to prove RLS (S1); no concurrency tests (last-owner race S3, double-open-shift D7, concurrent `client_uuid` D3); no test for negative-going inventory adjustment (D5); no test for refund-method-vs-payments (D4); no test for `payment_mix` vs net (D6); no test for subscription-lifecycle events *without* injected `metadata.tenant_id` (B1); no test for trial-reminder scheduling (B4); no non-HTTP sync-batch failure test (D3).
- **Test ergonomics:** the subprocess-migration fixtures (`test_tenant_isolation_routes`, `test_trial_reminders`, `test_welcome_email`) fail if the local DB volume is left at a migration from another branch (observed: volume stuck at `0036` from the internal-ops branch). CI uses a fresh Postgres so it's unaffected; `docs/current-sprint.md` already flags "backend test ergonomics for release gates."

---

## 14. Performance findings

- **Stock is a `SUM` aggregate per read** (`inventory/repository.py:32-41`). Fine at SMB scale, `product_id` indexed, batch helper avoids N+1 on listings; grows O(movements/product) over history with no rollup/snapshot table. (Likely fine for beta; watch long-lived high-volume tenants.)
- **Reports recompute aggregates per request** with no caching layer. Acceptable now; a candidate for materialized rollups if tenants scale.
- **Orders list day-bounds are naive UTC** (`orders/repository.py:159-168`) unlike the tz-aware reports module — minor cross-midnight edge on the orders list only.
- **Frontend:** Recharts is a lazy chunk; landing SSR-prerendered; PWA precache. No obvious client perf issues; landing is 98 KB gzipped-ish HTML served from Vercel cache (HIT).

---

## 15. UX & product findings

Live walkthrough (screenshots captured) — the product is genuinely premium and coherent:

**Strengths (Confirmed):** excellent empty states ("Aún sin ventas en el periodo — abre la caja para empezar a leer tu negocio"; reports "Aún no hay ventas para contar una historia"), an onboarding checklist ("Deja tu cafetería lista para vender", 0/7 with clear CTAs), a trial banner + header chip ("PRUEBA GRATIS · quedan 7 días"), timezone shown on reports ("Ciudad de México UTC-6"), the cash-guard surfaced clearly ("No hay turno abierto. Los cobros en efectivo están bloqueados hasta que abras uno"), a first-use POS tour, and a proper mobile bottom-nav (Caja / Órdenes / Panel / Más). Copy is consistent es-MX with no English leakage or placeholder text on the authenticated paths.

**Product/commercial gaps:**
- **No landing analytics/conversion tracking (Confirmed).** First-party funnel events fire inside the app (`telemetry/funnel.ts`), but the landing page fires **none** — no page-view or CTA-click tracking. Activation/conversion can't be measured at the top of the funnel. (No third-party pixel/GA either.)
- **Reads blocked for expired/canceled tenants (Confirmed).** Reports/orders GET use `require_commercial_access`, so a churned owner can't even view their own history — confirm this is the intended product stance (it increases reactivation friction).
- **`InsightStrip` TODO (`frontend/src/dashboard/InsightStrip.tsx:203`):** richer per-employee "why" insights are stubbed — a known data-completeness gap, not a bug.
- **No dangerous-action friction inventory:** confirmations exist for refund/void; verify destructive settings (e.g., product delete) all have confirms (mostly present).

**Accessibility/responsive:** mobile pass looked correct; prior audit branches added aria-live. No full a11y audit performed here (Not verifiable at depth).

---

## 16. Deployment & infrastructure findings

- **Frontend prod is at `main` HEAD** (`version.json` hash `d232cd9`) — **no frontend deployment drift.** PRs #10–#12 (input-validation + secrets hygiene) are merged to main. (Confirmed)
- **`main` is the integration branch** and already contains the substance of the `audit/*`, `security/*`, `fix/*`, and `codex/*` branches (re-landed/squashed). The genuinely **unmerged** work is: `feat/internal-ops-dashboard` (+6,619 lines, no trace on main), `codex/filter-facebook-iab-sentry-noise` (small Sentry noise filter), and the **reports redesign** (this branch, `feature/full-audit-plan` == `feature/reports-redesign`, **local-only, not pushed** — at risk of loss). (Confirmed)
- **Prod headers/CSP/SEO are correct** (§5); `robots.txt`/`sitemap.xml`/legal pages all 200; backend `/health` 200.
- **CI is comprehensive** (§2) including migration up/down/up reversibility and Gitleaks.
- **Open release gates** (`docs/current-sprint.md`, still accurate): live Stripe full-flow verification, email deliverability QA, R2 restore drill, beta agreement signed.

---

## 17. Documentation inconsistencies

- **`docs/architecture.md:129` and ADR-009** claim RLS as defense-in-depth; in reality it's inert (S1). The docs describe the *intent*, not the *runtime*. `docs/deployment.md:177` correctly still lists RLS as an open gate — so the docs are internally contradictory on RLS status.
- **Prior audits are largely resolved.** The May-2026 Top-10 gaps (pricing mismatch, English billing copy, i18n, deployment drift) are closed on main; the June-2026 P0 caja/cash-sales fix is present on main (verified in `shifts/calculator.py`). The June-2026 "role escalation to owner" is fixed on main (`employees/service.py:97,262`). The "offline timestamp not preserved" and "POS no abre offline" items from June-2026 are **still open** (D1, D2).
- **Plan display name mismatch:** backend `"Standard Plan"` vs frontend `"Plan Standard"` (cosmetic).
- **Committed dev clutter:** stray `.tmp_vite*.log` files in repo root/`frontend/`.

---

## 18. Quick wins (high value / low effort)

1. **Set `subscription_data[metadata][tenant_id]` at checkout** + resolve subscription events by `stripe_object["id"]` — closes B1 (the "access forever" bug). ~10 lines + a test. (Part of PLAN-01)
2. **Wire the trial-reminder script into `db-backup.yml`'s pattern as a new daily GitHub workflow** — makes B4/D9 real. Low effort.
3. **Validate refund method against the order's collected payment methods** (D4) — a server-side check + test.
4. **Add a negative-stock floor to `adjust_stock`** (D5) — one guard + test.
5. **`hmac.compare_digest` for the internal ops key** (S6) — one-line.
6. **`import.meta.env.DEV` guard around the dev-token render** (S8).
7. **`.gitignore` + remove committed `.tmp_vite*.log`** clutter.
8. **Push `feature/full-audit-plan`/reports-redesign to origin** — the redesign is local-only and at risk of loss.
9. **Consolidate the triplicated `ApiError`** into `frontend/src/lib/apiError.ts`.

---

## 19. Production blockers (must fix before onboarding paying customers)

- **P0 — B1 "Access granted forever"** (§10): canceled customers keep access; direct revenue leak + trust risk. **This is the single hard blocker.**
- **P0-adjacent — B2 double billing** (§10): a churn/retry flow can double-charge a customer.
- **P0-adjacent — B4 trial reminders never fire** (§10): trial→paid conversion depends on emails that don't send.
- **Gate — S1 RLS inert** (§7): self-listed pre-beta hard gate; app filters hold today, so this is "must close before scaling tenants," not "app is unsafe now."
- **Gate — restore drill unproven, email deliverability ungated** (§12): operational blockers already tracked in `docs/current-sprint.md`.

---

## 20. Full prioritized findings table

| Rank | Finding | Severity | Category | Evidence | Customer impact | Effort | Recommended action |
|------|---------|----------|----------|----------|-----------------|--------|--------------------|
| 1 | B1 Subscription-lifecycle events lack tenant metadata → access granted forever | Critical | Billing/Revenue | `billing/service.py:594-615`, `stripe_client.py:61-63` | Churned customers keep paid access; revenue leak | S | Set `subscription_data.metadata.tenant_id`; resolve sub events by id; alert on ignored-unknown-tenant (PLAN-01) |
| 2 | B2 Double checkout with no customer reuse → double billing | High | Billing/Revenue | `service.py:235-236`, `stripe_client.py:55-64` | Duplicate charges, disputes | S-M | Reuse Stripe customer; block/limit checkout when a live sub exists (PLAN-01) |
| 3 | B4/D9 Trial reminders never fire (no scheduler) | High | Billing/Reliability | no scheduler in `main.py`/`fly.toml`/workflows | Lost trial→paid conversion | S | Add daily GitHub-Actions cron running `send_trial_reminders.py` (PLAN-01) |
| 4 | S1 RLS inert (no FORCE, owner connection) | High (DiD) | Security/Tenancy | no `FORCE`; `alembic/env.py:9`+`db.py:13`; `deployment.md:59` | Backstop missing if an app filter is ever forgotten | M | Least-priv app role + `FORCE RLS` migration + non-owner RLS test (PLAN-02) |
| 5 | D1 Offline sale timestamp dropped → misdated sales | High | Data-integrity/Offline | `sync.ts:40-47`, `orders/models.py:33` | Wrong daily totals; unreconcilable closes | M | Add `occurred_at` (expand-and-contract), send + persist client time (PLAN-03) |
| 6 | D2 Cold-offline register broken ("POS no abre offline") | High | Offline/UX | `vite.config.ts:96-98`, `db.ts:8-10` | Can't sell offline from a cold start | M | Cache catalog to IndexedDB; stale-while-offline read (PLAN-03) |
| 7 | D4 Refund method not validated vs payments | High | Data-integrity/Money | `orders/service.py:449-453`, `schemas.py:156` | Drawer over-drained; cash refunded that wasn't collected | S | Validate/cap refund method against collected payments (PLAN-04) |
| 8 | B3 Lost checkout webhook blocks paying customer | Medium | Billing | `BillingView.tsx:90-116`, `service.py:171-173` | Paid customer locked out until retry | M | Reconcile on return via Stripe session lookup (PLAN-01) |
| 9 | D5 Negative stock via manual adjustment | Medium | Data-integrity | `inventory/service.py:159-212` | Corrupt inventory, misleading reports | S | Floor check unless explicit "shrinkage" mode (PLAN-04) |
| 10 | D3 Non-HTTP exception aborts sync batch | Medium | Offline/Reliability | `sync/service.py:55` | False dead-letters; manual retry burden | S | Catch broad + IntegrityError per item; return per-sale result (PLAN-03) |
| 11 | D7 No single-open-shift constraint | Medium | Data-integrity/Race | `shifts/models.py:15-39` | Ambiguous corte de caja | S-M | Partial unique index + lock on open (PLAN-04) |
| 12 | S3 Last-owner guard TOCTOU | Medium | Security | `employees/service.py:26-35` | Tenant stranded with 0 owners | S | Row-lock / serialize owner-count check (PLAN-05) |
| 13 | D6 payment_mix not refund-adjusted | Medium | Data-integrity/Reporting | `reports/service.py:178-209` | Auditor confusion; totals don't tie | S | Net out refunds or label as "collected" (PLAN-04) |
| 14 | D8 Multi-tenant login `.first()` | Medium | Correctness/Tenancy | `auth/repository.py:73-78` | Wrong-tenant landing for multi-tenant users | S-M | Tenant selection at login (PLAN-05) |
| 15 | S2 Public unauthenticated asset reads | Medium | Security | `catalog/image_router.py:226-255` | Cross-tenant asset read by id guess (low) | S | Signed URLs or tenant-scoped tokens; risk sign-off (PLAN-05) |
| 16 | S4 Sessions not revoked on deactivation/role change | Low-Med | Security | `employees/service.py:308` | Brief token-mint window (lockout still holds) | S | Revoke sessions on deactivate/role change (PLAN-05) |
| 17 | B6 Webhook secret / price ID no live/test guard | Low-Med | Billing/Security | `service.py:126-129` | Test events verified in prod if misconfigured | S | Assert `whsec` mode; validate URL domains (PLAN-01) |
| 18 | S5 Weak invite password + bcrypt 72-byte truncation | Low-Med | Security | `employees/service.py:204-207` | Weak passwords for invited staff | S | Reuse signup validators; SHA-256 pre-hash (PLAN-05) |
| 19 | D10 429 sync schedules no backoff | Low | Offline/Reliability | `syncWorker.ts:41-53` | Slow recovery after burst | S | Honor `Retry-After`; schedule retry (PLAN-03) |
| 20 | S7 Rate limit fails open (checkout/sync/staging) | Low | Security | `rate_limit.py:156-169, 234-236` | Abuse window on Redis outage | S | Fail closed for authed bulk writes; confirm intent (PLAN-05) |
| 21 | S6 Internal key plain `!=` | Low | Security | `billing/router.py:103` | Timing side-channel | XS | `hmac.compare_digest` (quick win) |
| 22 | S8 Dev token rendered without DEV guard | Low | Security | `ForgotPasswordView.tsx:57` | Token shown if backend misconfigured | XS | `import.meta.env.DEV` guard (quick win) |
| 23 | S10 No tenant deletion / data export | Info | Compliance | absent | LFPDPPP erasure/portability gap | M | Add erasure + export endpoints (post-beta) |
| 24 | No IVA/tax layer | Info | Product | no tax code | May block invoicing expectations | L | Confirm intent; design tax engine if needed (deferred) |
| 25 | No landing analytics | Info | Commercial | `Home.tsx` fires no funnel events | Can't measure top-of-funnel conversion | S | Add landing page-view/CTA events (PLAN-05) |
| 26 | Reports redesign local-only | Info | Ops | not on origin | Work loss risk | XS | Push branch (quick win) |
| 27 | Reads blocked for churned tenants | Info | Product | `require_commercial_access` on GETs | Reactivation friction | S | Product decision |

---

## 21. Recommended implementation sequence

1. **PLAN-01 — Billing lifecycle correctness** (B1, B2, B3, B4, B6). Closes the revenue blockers; unblocks safe paid onboarding. **Do this first.**
2. **PLAN-02 — Tenant-isolation defense-in-depth** (S1): least-privilege app role + `FORCE RLS` + a real RLS test. Closes the security hard gate.
3. **PLAN-03 — Offline-sync integrity** (D1, D2, D3, D10): timestamp preservation, cold-offline catalog cache, per-item batch resilience.
4. **PLAN-04 — Cash & inventory correctness** (D4, D5, D6, D7): refund-method validation, negative-stock floor, single-open-shift, payment-mix consistency.
5. **PLAN-05 — Security & operational hardening** (S2–S10, D8, plus quick wins): last-owner lock, session revocation, multi-tenant login, internal-key/dev-token/rate-limit fixes, landing analytics, branch consolidation.

Quick wins (§18) can land opportunistically alongside any plan.

---

*Areas not verifiable from the repository alone:* the actual Supabase runtime DB role (inferred from `deployment.md` to be `postgres`/owner), live Stripe dashboard state and real webhook payloads, R2 backup contents and a successful restore, Resend deliverability to real inboxes, and production alerting thresholds. These require dashboard/runtime access and are called out in the relevant plans.
