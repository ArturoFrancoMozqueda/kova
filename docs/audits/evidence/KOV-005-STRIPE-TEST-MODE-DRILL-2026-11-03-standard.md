# KOV-005 — Stripe test-mode temporal convergence drill

- Executed at: `2026-11-03T17:32:25.069313Z`
- Commit: `1a181853162b92f5d9a0c4d6432416c3dd157ed6`
- GitHub environment: `stripe-sandbox`
- Stripe mode: `livemode=false`
- Stripe account: `acct_…fRqmMP`
- Plan under acceptance: `standard`
- Stripe price: `price_…hiydcF` (`MXN 299.00`, monthly, count 1)
- Catalog tax inclusive: `None`
- Application/database: isolated GitHub runner, loopback only

## Hosted Checkout

- Session: `cs_test_…19ruqK`
- Provider result: `complete/paid`
- Local result: `active`
- Kova paid plan: `{"amount_minor_units": 29900, "features": ["pos", "inventory", "sales_reports", "public_catalog", "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"], "plan_code": "standard"}`
- Kova access at actual application time: `{"allowed": true, "reason": "active", "valid_until": "2026-11-04T17:31:20.458125Z"}`
- Delivery: `stripe_cli_forward`

## Lifecycle and ordering evidence

| Step | # | Event | Stripe object status | Event ID | Provider created | Arrived | Result | Kova status / plan / amount / features | Lifecycle watermark | Payment watermark |
|---|---:|---|---|---|---|---|---|---|---|---|
| initial_active | 1 | `customer.subscription.created` | `active` | `evt_…HuPHTf` | 2026-11-03T17:31:25Z | 2026-11-03T17:31:27.702806Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:31:25Z (evt_…HuPHTf) | None @ None (None) |
| initial_active | 2 | `invoice.paid` | `paid` | `evt_…1CWuLT` | 2026-11-03T17:31:25Z | 2026-11-03T17:31:27.921092Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:31:25Z (evt_…HuPHTf) | invoice.paid @ 2026-11-03T17:31:27.916932Z (authoritative:evt_…1CWuLT) |
| renewal_paid | 1 | `invoice.paid` | `paid` | `evt_…QUPLRD` | 2026-11-03T17:31:35Z | 2026-11-03T17:31:36.807231Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:31:25Z (evt_…HuPHTf) | invoice.paid @ 2026-11-03T17:31:35Z (evt_…QUPLRD) |
| payment_failed | 1 | `invoice.payment_failed` | `open` | `evt_…ldZiXz` | 2026-11-03T17:31:49Z | 2026-11-03T17:31:51.816711Z | `processed` | `past_due / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:31:25Z (evt_…HuPHTf) | invoice.payment_failed @ 2026-11-03T17:31:49Z (evt_…ldZiXz) |
| payment_recovered | 1 | `invoice.payment_succeeded` | `paid` | `evt_…nTS1TA` | 2026-11-03T17:31:54Z | 2026-11-03T17:31:56.331995Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.created @ 2026-11-03T17:31:25Z (evt_…HuPHTf) | invoice.payment_succeeded @ 2026-11-03T17:31:54Z (evt_…nTS1TA) |
| period_end_canceled | 1 | `customer.subscription.deleted` | `canceled` | `evt_…hgvfPP` | 2026-11-03T17:32:03Z | 2026-11-03T17:32:05.459733Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:32:03Z (evt_…hgvfPP) | invoice.payment_succeeded @ 2026-11-03T17:31:54Z (evt_…nTS1TA) |
| cancel_then_old_payment | 1 | `customer.subscription.deleted` | `canceled` | `evt_…htrfyO` | 2026-11-03T17:32:12Z | 2026-11-03T17:32:13.209322Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:32:12Z (evt_…htrfyO) | None @ None (None) |
| cancel_then_old_payment | 2 | `invoice.payment_succeeded` | `paid` | `evt_…XDRDHy` | 2026-11-03T17:32:09Z | 2026-11-03T17:32:13.413936Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:32:12Z (evt_…htrfyO) | invoice.payment_succeeded @ 2026-11-03T17:32:09Z (evt_…XDRDHy) |
| cancel_then_old_payment_duplicate | 3 | `invoice.payment_succeeded` | `paid` | `evt_…XDRDHy` | 2026-11-03T17:32:09Z | 2026-11-03T17:32:13.428002Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:32:12Z (evt_…htrfyO) | invoice.payment_succeeded @ 2026-11-03T17:32:09Z (evt_…XDRDHy) |
| old_payment_then_cancel | 1 | `invoice.paid` | `paid` | `evt_…cDlL3t` | 2026-11-03T17:32:17Z | 2026-11-03T17:32:22.885660Z | `processed` | `active / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | None @ None (None) | invoice.paid @ 2026-11-03T17:32:17Z (evt_…cDlL3t) |
| old_payment_then_cancel | 2 | `customer.subscription.deleted` | `canceled` | `evt_…KaFAlY` | 2026-11-03T17:32:22Z | 2026-11-03T17:32:22.901264Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:32:22Z (evt_…KaFAlY) | invoice.paid @ 2026-11-03T17:32:17Z (evt_…cDlL3t) |
| old_payment_then_cancel_duplicate | 3 | `invoice.paid` | `paid` | `evt_…cDlL3t` | 2026-11-03T17:32:17Z | 2026-11-03T17:32:22.913569Z | `processed` | `canceled / standard / MXN 29900 minor / pos,inventory,sales_reports,public_catalog,purchasing,advanced_reports,loyalty,customer_orders,quotes` | customer.subscription.deleted @ 2026-11-03T17:32:22Z (evt_…KaFAlY) | invoice.paid @ 2026-11-03T17:32:17Z (evt_…cDlL3t) |

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
