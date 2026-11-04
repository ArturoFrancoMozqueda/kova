# KOV-005 — Stripe test-mode temporal convergence drill

- Executed at: `2026-11-04T01:46:57.275566Z`
- Commit: `5fd7b35f75a33a76172afb58524a4cab89e277fd`
- GitHub environment: `stripe-sandbox`
- Stripe mode: `livemode=false`
- Stripe account: `acct_…fRqmMP`
- Plan under acceptance: `standard`
- Stripe price: `price_…hiydcF` (`MXN 299.00`, monthly, count 1)
- Catalog tax inclusive: `None`
- Application/database: isolated GitHub runner, loopback only

## Hosted Checkout

- Session: `cs_test_…jqNiiS`
- Provider result: `complete/paid`
- Local result: `active`
- Kova paid plan: `{"amount_minor_units": 29900, "features": ["pos", "inventory", "sales_reports", "public_catalog", "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"], "plan_code": "standard"}`
- Kova access at actual application time: `{"allowed": true, "reason": "active", "valid_until": "2026-11-05T01:45:31.304664Z"}`
- Delivery: `stripe_cli_forward`

## Lifecycle and ordering evidence

| Step | # | Event | Stripe object status | Event ID | Provider created | Arrived | Result | Kova status / plan / amount / features | Lifecycle watermark | Payment watermark |
|---|---:|---|---|---|---|---|---|---|---|---|
| initial_active | 1 | `customer.subscription.created` | `active` | `evt_…uykonY` | 2026-11-04T01:45:47Z | 2026-11-04T01:45:50.182702Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-04T01:45:47Z (evt_…uykonY) | None @ None (None) |
| initial_active | 2 | `invoice.paid` | `paid` | `evt_…ooYByV` | 2026-11-04T01:45:47Z | 2026-11-04T01:45:50.467054Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-04T01:45:47Z (evt_…uykonY) | invoice.paid @ 2026-11-04T01:45:50.462447Z (authoritative:evt_…ooYByV) |
| renewal_paid | 1 | `invoice.payment_succeeded` | `paid` | `evt_…NpSWH3` | 2026-11-04T01:45:59Z | 2026-11-04T01:46:01.678176Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-04T01:45:47Z (evt_…uykonY) | invoice.payment_succeeded @ 2026-11-04T01:45:59Z (evt_…NpSWH3) |
| payment_failed | 1 | `invoice.payment_failed` | `open` | `evt_…Du1av7` | 2026-11-04T01:46:17Z | 2026-11-04T01:46:19.474694Z | `processed` | `past_due / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-04T01:45:47Z (evt_…uykonY) | invoice.payment_failed @ 2026-11-04T01:46:17Z (evt_…Du1av7) |
| payment_recovered | 1 | `invoice.payment_succeeded` | `paid` | `evt_…zM3TuS` | 2026-11-04T01:46:22Z | 2026-11-04T01:46:24.338115Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-04T01:45:47Z (evt_…uykonY) | invoice.payment_succeeded @ 2026-11-04T01:46:22Z (evt_…zM3TuS) |
| period_end_canceled | 1 | `customer.subscription.deleted` | `canceled` | `evt_…gMTtWP` | 2026-11-04T01:46:31Z | 2026-11-04T01:46:33.306405Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-04T01:46:31Z (evt_…gMTtWP) | invoice.payment_succeeded @ 2026-11-04T01:46:22Z (evt_…zM3TuS) |
| cancel_then_old_payment | 1 | `customer.subscription.deleted` | `canceled` | `evt_…sbs4Xi` | 2026-11-04T01:46:42Z | 2026-11-04T01:46:43.475634Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-04T01:46:42Z (evt_…sbs4Xi) | None @ None (None) |
| cancel_then_old_payment | 2 | `invoice.paid` | `paid` | `evt_…KPKkoX` | 2026-11-04T01:46:37Z | 2026-11-04T01:46:43.725774Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-04T01:46:42Z (evt_…sbs4Xi) | invoice.paid @ 2026-11-04T01:46:37Z (evt_…KPKkoX) |
| cancel_then_old_payment_duplicate | 3 | `invoice.paid` | `paid` | `evt_…KPKkoX` | 2026-11-04T01:46:37Z | 2026-11-04T01:46:43.738385Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-04T01:46:42Z (evt_…sbs4Xi) | invoice.paid @ 2026-11-04T01:46:37Z (evt_…KPKkoX) |
| old_payment_then_cancel | 1 | `invoice.paid` | `paid` | `evt_…SeLxem` | 2026-11-04T01:46:47Z | 2026-11-04T01:46:53.841805Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | None @ None (None) | invoice.paid @ 2026-11-04T01:46:47Z (evt_…SeLxem) |
| old_payment_then_cancel | 2 | `customer.subscription.deleted` | `canceled` | `evt_…dH57rp` | 2026-11-04T01:46:53Z | 2026-11-04T01:46:53.856232Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-04T01:46:53Z (evt_…dH57rp) | invoice.paid @ 2026-11-04T01:46:47Z (evt_…SeLxem) |
| old_payment_then_cancel_duplicate | 3 | `invoice.paid` | `paid` | `evt_…SeLxem` | 2026-11-04T01:46:47Z | 2026-11-04T01:46:53.866751Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-04T01:46:53Z (evt_…dH57rp) | invoice.paid @ 2026-11-04T01:46:47Z (evt_…SeLxem) |

## Acceptance and boundaries

- Hosted Checkout completed using Stripe's test-mode page; Kova independently confirmed the selected paid plan, amount, exact features and commercial access.
- Provider Test Clocks advance Stripe only. Kova uses its actual UTC clock; recorded event/period dates do not prove that application time elapsed.
- Portal, upgrades and effective downgrades are NOT accepted by this drill.
- A test-clock renewal remained active and advanced the payment watermark.
- A failed renewal entered `past_due` with `past_due_grace`; payment recovery returned to `active`.
- Kova set `cancel_at_period_end`; the period-end event converged to `canceled`.
- Newer cancellation plus older payment converged to `canceled` in both arrival orders.
- Replaying the same payment event did not add audit work or another processing attempt.

## Cleanup

- Test clocks deleted: `3`
- Standalone QA customers deleted: `3`
- Local listener and backend stopped; the GitHub PostgreSQL service is ephemeral.

All Stripe identifiers are redacted to prefix plus final six characters. The artifact contains no keys, webhook signing secrets, Checkout URLs, card data, cookies, email addresses, or database URLs.

## Risk acceptance (sandbox only)

Partial Checkout refund: 100 MXN minor units (MXN 1.00), matched to its subscription. Dispute and early-warning fixtures: separate QA customers without invoices; global no_subscription review, never an invented tenant.
Ops evidence uses isolated service/repository queries and persisted acknowledgement/resolution, not the authenticated founder MFA UI. No production risk decision is made.
Signed listener received every first delivery; a signed duplicate kept one audit and one processing attempt. Full local Subscription/payment/access snapshots were unchanged.
Disposable customers are deleted; successful test PaymentIntents/Charges and their risk history remain provider records (Stripe does not offer deletion of paid charges).

- `{"audit_entries": 1, "commercial_state_unchanged": true, "duplicate_idempotent": true, "event_type": "charge.refunded", "listener_received": true, "livemode": false, "mapping": "matched", "ops_visible": true, "process_attempts": 1, "triage_persisted": true}`
- `{"audit_entries": 1, "commercial_state_unchanged": true, "duplicate_idempotent": true, "event_type": "charge.dispute.created", "listener_received": true, "livemode": false, "mapping": "no_subscription", "ops_visible": true, "process_attempts": 1, "triage_persisted": true}`
- `{"audit_entries": 1, "commercial_state_unchanged": true, "duplicate_idempotent": true, "event_type": "radar.early_fraud_warning.created", "listener_received": true, "livemode": false, "mapping": "no_subscription", "ops_visible": true, "process_attempts": 1, "triage_persisted": true}`
