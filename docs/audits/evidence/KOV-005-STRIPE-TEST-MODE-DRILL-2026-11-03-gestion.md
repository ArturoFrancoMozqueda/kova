# KOV-005 — Stripe test-mode temporal convergence drill

- Executed at: `2026-11-03T17:27:36.785064Z`
- Commit: `1a181853162b92f5d9a0c4d6432416c3dd157ed6`
- GitHub environment: `stripe-sandbox`
- Stripe mode: `livemode=false`
- Stripe account: `acct_…fRqmMP`
- Plan under acceptance: `gestion`
- Stripe price: `price_…eGkr5C` (`MXN 699.00`, monthly, count 1)
- Catalog tax inclusive: `True`
- Application/database: isolated GitHub runner, loopback only

## Hosted Checkout

- Session: `cs_test_…TY8yHB`
- Provider result: `complete/paid`
- Local result: `active`
- Kova paid plan: `{"amount_minor_units": 69900, "features": ["pos", "inventory", "sales_reports", "public_catalog", "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"], "plan_code": "gestion"}`
- Kova access at actual application time: `{"allowed": true, "reason": "active", "valid_until": "2026-11-04T17:26:19.047782Z"}`
- Delivery: `stripe_cli_forward`

## Lifecycle and ordering evidence

| Step | # | Event | Stripe object status | Event ID | Provider created | Arrived | Result | Kova status / plan / amount / features | Lifecycle watermark | Payment watermark |
|---|---:|---|---|---|---|---|---|---|---|---|
| initial_active | 1 | `customer.subscription.created` | `active` | `evt_…N8wTur` | 2026-11-03T17:26:23Z | 2026-11-03T17:26:25.884599Z | `processed` | `active / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:26:23Z (evt_…N8wTur) | None @ None (None) |
| initial_active | 2 | `invoice.payment_succeeded` | `paid` | `evt_…hsKwLd` | 2026-11-03T17:26:23Z | 2026-11-03T17:26:26.330436Z | `processed` | `active / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:26:23Z (evt_…N8wTur) | invoice.payment_succeeded @ 2026-11-03T17:26:26.326745Z (authoritative:evt_…hsKwLd) |
| renewal_paid | 1 | `invoice.paid` | `paid` | `evt_…Sfa6vZ` | 2026-11-03T17:26:43Z | 2026-11-03T17:26:46.593402Z | `processed` | `active / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:26:23Z (evt_…N8wTur) | invoice.paid @ 2026-11-03T17:26:43Z (evt_…Sfa6vZ) |
| payment_failed | 1 | `invoice.payment_failed` | `open` | `evt_…wlCLYk` | 2026-11-03T17:26:59Z | 2026-11-03T17:27:01.194675Z | `processed` | `past_due / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:26:23Z (evt_…N8wTur) | invoice.payment_failed @ 2026-11-03T17:26:59Z (evt_…wlCLYk) |
| payment_recovered | 1 | `invoice.paid` | `paid` | `evt_…rmOT58` | 2026-11-03T17:27:03Z | 2026-11-03T17:27:06.533643Z | `processed` | `active / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:26:23Z (evt_…N8wTur) | invoice.paid @ 2026-11-03T17:27:03Z (evt_…rmOT58) |
| period_end_canceled | 1 | `customer.subscription.deleted` | `canceled` | `evt_…4zjnGK` | 2026-11-03T17:27:11Z | 2026-11-03T17:27:12.825552Z | `processed` | `canceled / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:27:11Z (evt_…4zjnGK) | invoice.paid @ 2026-11-03T17:27:03Z (evt_…rmOT58) |
| cancel_then_old_payment | 1 | `customer.subscription.deleted` | `canceled` | `evt_…5qsNED` | 2026-11-03T17:27:21Z | 2026-11-03T17:27:22.385451Z | `processed` | `canceled / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:27:21Z (evt_…5qsNED) | None @ None (None) |
| cancel_then_old_payment | 2 | `invoice.paid` | `paid` | `evt_…wfZLYx` | 2026-11-03T17:27:16Z | 2026-11-03T17:27:23.042811Z | `processed` | `canceled / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:27:21Z (evt_…5qsNED) | invoice.paid @ 2026-11-03T17:27:16Z (evt_…wfZLYx) |
| cancel_then_old_payment_duplicate | 3 | `invoice.paid` | `paid` | `evt_…wfZLYx` | 2026-11-03T17:27:16Z | 2026-11-03T17:27:23.054496Z | `processed` | `canceled / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:27:21Z (evt_…5qsNED) | invoice.paid @ 2026-11-03T17:27:16Z (evt_…wfZLYx) |
| old_payment_then_cancel | 1 | `invoice.paid` | `paid` | `evt_…ajQeWO` | 2026-11-03T17:27:27Z | 2026-11-03T17:27:34.328315Z | `processed` | `active / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | None @ None (None) | invoice.paid @ 2026-11-03T17:27:27Z (evt_…ajQeWO) |
| old_payment_then_cancel | 2 | `customer.subscription.deleted` | `canceled` | `evt_…j8dEG1` | 2026-11-03T17:27:33Z | 2026-11-03T17:27:34.560192Z | `processed` | `canceled / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:27:33Z (evt_…j8dEG1) | invoice.paid @ 2026-11-03T17:27:27Z (evt_…ajQeWO) |
| old_payment_then_cancel_duplicate | 3 | `invoice.paid` | `paid` | `evt_…ajQeWO` | 2026-11-03T17:27:27Z | 2026-11-03T17:27:34.569983Z | `processed` | `canceled / gestion / MXN 69900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:27:33Z (evt_…j8dEG1) | invoice.paid @ 2026-11-03T17:27:27Z (evt_…ajQeWO) |

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
- Standalone Checkout customers deleted: `1`
- Local listener and backend stopped; the GitHub PostgreSQL service is ephemeral.

All Stripe identifiers are redacted to prefix plus final six characters. The artifact contains no keys, webhook signing secrets, Checkout URLs, card data, cookies, email addresses, or database URLs.
