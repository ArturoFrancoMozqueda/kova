# PLAN-01 — Billing Lifecycle Correctness

## Priority and rationale

**Rank 1 (highest leverage).** This is the only set of findings that directly leaks revenue and blocks safe paid onboarding. Three defects compound:

- **B1 — access granted forever:** production `customer.subscription.*` events carry no `tenant_id`, so cancellations never reach Kova; a churned customer keeps full paid access. Direct revenue loss + trust risk.
- **B2 — double billing:** a `past_due`/`canceled` tenant can start a second checkout that mints a *new* Stripe customer + subscription while the old one may keep billing.
- **B4 — trial reminders never fire:** the trial→paid conversion email path is implemented and tested but has no scheduler, so it never runs in production.

Plus two smaller gaps (B3 lost-webhook reconciliation, B6 live/test secret guard). All are small, well-contained changes to `backend/app/billing/*`. Fixing them is the difference between "Kova charges correctly" and "Kova gives away access and double-charges."

## Goal

After this work:
1. Every Stripe subscription-lifecycle event (`created`/`updated`/`deleted`, `invoice.*`) is reliably attributed to the correct tenant and mutates the local `subscriptions` row, so local status always converges to Stripe's truth (canceled → access removed).
2. A tenant with an existing live Stripe subscription cannot create a duplicate subscription; re-subscription reuses the Stripe customer.
3. Trial-ending reminder emails are sent daily in production via a scheduled job.
4. A lost `checkout.session.completed` webhook self-heals on the billing return page via a Stripe session lookup, so a paying customer is not left 402-blocked.
5. Webhook secret and price ID are guarded for live/test mode consistency.

## Current behavior (repository evidence)

- **Checkout** (`backend/app/billing/stripe_client.py:55-64`) sets session metadata `tenant_id`/`user_id` and `client_reference_id`, but **not** `subscription_data.metadata.tenant_id`. Stripe does not copy session metadata onto the subscription object.
- **Webhook tenant resolution** (`backend/app/billing/service.py:535-615`): tries `metadata.tenant_id` on the event object, then `stripe_object.get("subscription")` / `parent.subscription_details.subscription`. For a `customer.subscription.*` event the object's id is in `id` (not `subscription`), so the fallback never fires; `tenant_id is None` → event marked `ignored` "Missing tenant metadata" (`service.py:612-615`). No logger/alert.
- **`_maybe_resync_period`** (`service.py:164-207`) early-returns unless status ∈ `{active, trialing}` and heals only `current_period_*`, never status.
- **Checkout guard** (`service.py:235-236`) blocks only when status ∈ `{active, trialing}`. No `customer` field is passed to Checkout (`stripe_client.py:55-64`), so every checkout mints a new customer.
- **Billing return page** (`frontend/src/billing/BillingView.tsx:90-116`) shows a toast on `/success` and reads the cached subscription but does not poll or reconcile.
- **Trial reminders** (`backend/app/email/trial_reminders.py:64-106`, runner `backend/scripts/send_trial_reminders.py`) are complete + unit-tested (`test_trial_reminders.py`) but nothing schedules them: `main.py` registers routers only; `fly.toml` has a single `app` process; `.github/workflows/` has only `ci.yml` and `db-backup.yml`.
- **Webhook secret** (`service.py:126-129`) returns `settings.stripe_webhook_secret` with no mode assertion.

## Problems identified

1. B1: subscription-lifecycle events dropped (no tenant) → status never converges → access-forever.
2. B2: duplicate subscriptions possible for non-active statuses; no customer reuse → double billing + orphaned Stripe customers.
3. B3: lost checkout webhook → paying customer stays blocked with no reconciliation.
4. B4: trial reminders never sent (no scheduler).
5. B6: no live/test guard on webhook secret; success/cancel URL domains unvalidated.
6. Observability: ignored-unknown-tenant events are invisible (no log/metric/alert).

## Scope

**Included:** `backend/app/billing/{service,stripe_client,router}.py`, a small addition to `backend/app/billing/access.py` only if needed for reconciliation, `frontend/src/billing/{BillingView.tsx,api.ts}`, a new GitHub Actions workflow for reminders, tests. **Excluded:** switching to live Stripe keys (deferred per project memory), pricing/plan changes, dispute handling (tracked as B7, out of scope here), the RLS work (PLAN-02).

## Exact files to modify

- **`backend/app/billing/stripe_client.py`** — `create_checkout_session`: add `subscription_data={"metadata": {"tenant_id": ...}}`; pass `customer=<stored stripe_customer_id>` when the tenant already has one; keep `Idempotency-Key`.
- **`backend/app/billing/service.py`** —
  - `process_stripe_webhook` / tenant-resolution helper (`_tenant_id_from_event_object` ~`:536`, fallback ~`:594-603`): for `customer.subscription.*` events, resolve tenant via `get_subscription_by_stripe_id(stripe_object["id"])` when metadata is absent; for invoice events keep the existing `subscription` field resolution.
  - Add a structured `logger.warning` (no PII, no tokens) when an event is marked `ignored` for missing tenant, including event type + id.
  - `create_checkout_session` (`:235-236`): broaden the duplicate guard — if a live Stripe subscription exists (query Stripe or trust local status ∈ {active, trialing, past_due, unpaid}), block or route to the existing subscription; ensure customer reuse.
  - Add `reconcile_checkout_session(session_id, tenant_id)`: fetch the session from Stripe, verify it belongs to the tenant, and if paid, run the same activation path as `checkout.session.completed` (idempotent).
  - `_webhook_secret` (`:126-129`): assert the secret's mode matches `_requires_live_stripe()` (a live deployment must not use a `whsec` bound to test mode — enforce via config presence of a separate `stripe_webhook_secret` per mode, or a boot check).
- **`backend/app/billing/router.py`** — add `POST /billing/checkout/reconcile` (or reuse the subscription GET) calling `reconcile_checkout_session`, permission `BILLING_MANAGE`, rate-limited, CSRF-protected.
- **`frontend/src/billing/api.ts`** — add `reconcileCheckout(sessionId)`; **`frontend/src/billing/BillingView.tsx`** (`:90-116`) — on `/success`, if the subscription is not yet active, call reconcile (with a short bounded retry) before showing the final state.
- **New `.github/workflows/trial-reminders.yml`** — daily cron (e.g. `0 15 * * *`) that runs `backend/scripts/send_trial_reminders.py` against prod DB, mirroring `db-backup.yml`'s secret-handling and PG-client setup. (Alternative: a Fly scheduled machine — choose the GH-Actions cron for parity with backups and zero new infra.)

New files: `.github/workflows/trial-reminders.yml`; tests listed below.

## Dependencies

- Stripe API keys (test mode is fine for CI/tests; live deferred).
- Requires the local subscription row to store `stripe_customer_id` (already in `billing/models.py`). Verify the column exists and is populated on `checkout.session.completed`.
- No dependency on PLAN-02–05.

## Step-by-step implementation order

1. **`stripe_client.py` — propagate tenant metadata + reuse customer.**
   - Behavior: `subscription_data.metadata.tenant_id = tenant_id`; when `subscription.stripe_customer_id` is set, pass `customer=`.
   - Data model: none. API: outbound Stripe payload only. UI: none. Security: metadata is non-sensitive (tenant UUID). Backward-compat: additive; old sessions unaffected. Migration: none.
   - Tests: unit-assert the checkout payload includes `subscription_data.metadata.tenant_id` and reuses `customer`.

2. **`service.py` — webhook tenant resolution for subscription events.**
   - Behavior: if `event.type` starts with `customer.subscription.` and no `metadata.tenant_id`, resolve via `get_subscription_by_stripe_id(stripe_object["id"])`. If still unresolved, mark `ignored` **and** `logger.warning`.
   - Data model: none. API: none (internal). UI: none. Security: no PII in logs. Backward-compat: events that already carried metadata still work. Migration: none.
   - Tests: replay `customer.subscription.deleted` / `.updated` **without** injected metadata (production-realistic) and assert the local row transitions to `canceled`/`past_due` and access is removed.

3. **`service.py` — checkout duplicate guard + `service.py`/`stripe_client.py` customer reuse.**
   - Behavior: block a new checkout (or return the existing subscription's management link) when the tenant has a live Stripe subscription in any billable status; always reuse `stripe_customer_id`.
   - Data model: none. Security: none new. Backward-compat: `active`/`trialing` already blocked; extends to `past_due`/`unpaid`/`incomplete`/`canceled-but-live`. Migration: none.
   - Tests: assert a `past_due` tenant cannot mint a second Stripe customer/subscription; assert re-subscription reuses the customer.

4. **`service.py` + `router.py` — reconcile endpoint.**
   - Behavior: `reconcile_checkout_session` fetches the session, verifies `metadata.tenant_id == current tenant`, and idempotently activates if paid.
   - API impact: new `POST /billing/checkout/reconcile` (BILLING_MANAGE, rate-limited, CSRF). Security: verifies tenant ownership of the session before acting. Backward-compat: additive.
   - Tests: API test — lost webhook simulated; reconcile activates; second reconcile is a no-op.

5. **`BillingView.tsx` + `api.ts` — return-page reconciliation.**
   - Behavior: on `/success`, if subscription not active, call reconcile with a short bounded retry, then refresh the subscription cache.
   - UI impact: success page converges to "active" without a manual refresh. Backward-compat: if the webhook already landed, reconcile is a no-op.
   - Tests: vitest — success state calls reconcile only when not active.

6. **`.github/workflows/trial-reminders.yml` — scheduler.**
   - Behavior: daily cron runs `send_trial_reminders.py` against prod DB using the same `SUPABASE_DB_URL` handling as `db-backup.yml`.
   - Security: DB URL from GH secrets; no secret echoed. Backward-compat: additive; script is idempotent via `tenants.trial_reminder_sent_at`.
   - Tests: keep `test_trial_reminders.py` green; add a smoke assertion that the script's entrypoint runs a dry pass.

7. **`service.py` `_webhook_secret` — live/test guard.**
   - Behavior: on boot in a live deployment, assert the configured webhook secret is not a test-mode secret; validate success/cancel URL domains against `frontend_url`.
   - Security: prevents test events verifying in prod. Backward-compat: local unaffected.
   - Tests: config test asserting a test `whsec` in a live env fails boot.

## Edge cases

- **Replayed webhooks** (Stripe retries): all handlers idempotent via `webhook_events` unique `stripe_event_id`; a `failed` event is reprocessed on retry (confirmed existing behavior — preserve it).
- **Out-of-order events:** `subscription.updated` arriving before `checkout.session.completed` — after fix, tenant resolves by subscription id even with no prior row (upsert path must create the row).
- **Subscription deleted then re-subscribed:** customer reuse must not attach a new subscription to a canceled one; verify the new subscription overwrites the local row cleanly.
- **Pending-cancel undo (B5):** if reconciliation/guard changes affect the `cancel_at_period_end` window, ensure an owner in that window can still reach billing management (do not hard-block).
- **Reconcile for a session that belongs to another tenant:** must 403 (tenant-ownership check).
- **Trial reminder during an active session / after upgrade:** `trial_reminder_sent_at` idempotency + skip active subscribers (already tested) must hold under the scheduled run.
- **Timezone at day-7 boundary:** trial math is UTC and inclusive — do not change it.
- **Clock/duplicate cron runs:** the reminder script must be safe to run twice in a day (idempotent).

## Security requirements

- Webhook signature verification remains mandatory and unchanged; no new unverified path.
- Reconcile endpoint verifies tenant ownership of the Stripe session before acting; BILLING_MANAGE permission; CSRF-protected; rate-limited.
- No secrets, tokens, or payment details in logs; the new ignored-event warning logs only event type + id + reason.
- Live/test separation guards must not weaken; add the webhook-secret guard.
- Tenant isolation: reconcile and webhook handlers must only ever mutate the resolved tenant's subscription row.

## Data migration and rollback

- **No schema migration required** (all needed columns exist in `billing/models.py`). If a `stripe_customer_id` index is desired for the new resolution path, add it as an additive, reversible Alembic migration (expand-only).
- **Backfill:** optionally run a one-off reconciliation over existing `active` local rows against Stripe to catch already-missed cancellations (script, not a migration). Compatibility window: none needed.
- **Rollback:** revert the code; the new workflow file can be disabled. No data shape changes to undo.
- **Recovery if deploy fails:** webhook handling is additive; if the new resolution path errors, events fall back to the current "ignored" behavior (no worse than today). Keep the change behind straightforward reverts.

## Testing strategy

- **Unit:** checkout payload metadata + customer reuse; webhook tenant resolution for subscription events without metadata; `_webhook_secret` mode guard.
- **Integration/API (`backend/app/tests/test_billing_api.py`, `test_billing_access_control.py`):** cancellation without metadata removes access; duplicate-checkout blocked for past_due/canceled; reconcile activates on lost webhook and is idempotent; cross-tenant reconcile 403s.
- **Reminder job (`test_trial_reminders.py`):** keep green; add scheduled-entrypoint smoke.
- **Frontend (vitest):** BillingView success reconcile path.
- **Regression:** existing billing webhook/dedup/grace/trial tests must stay green.
- **Manual:** in Stripe test mode, complete a checkout, cancel the subscription in the Stripe dashboard, confirm the local row flips to canceled and access is removed; simulate a delayed webhook and confirm the return page self-heals.

Exact test files to add/modify: `backend/app/tests/test_billing_api.py` (subscription-event-without-metadata, reconcile, duplicate-checkout), `backend/app/tests/test_billing_lifecycle.py` (new, lifecycle convergence), `frontend/src/billing/BillingView.test.tsx` (reconcile), keep `backend/app/tests/test_trial_reminders.py`.

## Observability

- Structured warning on ignored-unknown-tenant webhook events (event type + id + reason; no PII).
- Metric/log line per reminder run: counts of eligible/sent/skipped (no email addresses).
- Audit events already emitted for subscription state changes — ensure the new resolution path still writes them.
- Dashboard/alert: alert when ignored-unknown-tenant events exceed a small threshold in a window (indicates the metadata fix regressed).
- Do not log Stripe secrets, customer emails, card data, or session tokens.

## Acceptance criteria

- Given a tenant with a completed checkout, when Stripe sends `customer.subscription.deleted` with no `metadata.tenant_id` (production-realistic), then the local subscription status becomes `canceled` and `require_commercial_access` blocks the tenant.
- Given a tenant whose local status is `past_due`, when they start a new checkout, then no second Stripe customer/subscription is created (checkout is blocked or reuses the existing customer).
- Given a completed paid checkout whose `checkout.session.completed` webhook never arrives, when the owner lands on the billing success page, then the app reconciles via a Stripe session lookup and access becomes active without manual intervention.
- Given the daily schedule fires, when a tenant's trial ends in the reminder window and no reminder was sent, then exactly one trial-ending email is sent and `trial_reminder_sent_at` is set.
- Given a live deployment configured with a test-mode webhook secret, when the backend boots, then boot fails with a clear error.

## Verification commands

```bash
# Backend (inside docker per repo convention)
docker compose exec -T backend uv run ruff check
docker compose exec -T backend uv run pytest app/tests/test_billing_api.py app/tests/test_billing_access_control.py app/tests/test_billing_lifecycle.py app/tests/test_trial_reminders.py -q
docker compose exec -T backend uv run alembic upgrade head   # only if an index migration is added

# Frontend
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test -- BillingView

# Workflow lint (optional)
# validate .github/workflows/trial-reminders.yml via gh/act or CI dry-run
```

## Definition of done

- All acceptance criteria pass with automated tests.
- Cancellation/downgrade convergence is proven by a metadata-free webhook test.
- Duplicate-checkout and customer-reuse are test-covered.
- The trial-reminder workflow exists, is idempotent, and `test_trial_reminders.py` is green.
- Ruff, pytest (billing subset + full suite), lint, typecheck, and vitest all pass.
- No new secrets in logs; ignored-event alerting in place.

## Risks and mitigations

- **Risk:** the customer-reuse change accidentally attaches a subscription to a canceled customer. **Mitigation:** only reuse `stripe_customer_id` for the same tenant; test re-subscription explicitly.
- **Risk:** reconcile endpoint abused to probe sessions. **Mitigation:** tenant-ownership check + BILLING_MANAGE + rate limit + CSRF.
- **Risk:** scheduled reminder run double-sends. **Mitigation:** existing `trial_reminder_sent_at` idempotency; add a run-level guard/test.
- **Risk:** changing the webhook resolution path regresses invoice handling. **Mitigation:** keep invoice resolution on the `subscription` field; only add the id-based path for `customer.subscription.*`; full regression suite.
