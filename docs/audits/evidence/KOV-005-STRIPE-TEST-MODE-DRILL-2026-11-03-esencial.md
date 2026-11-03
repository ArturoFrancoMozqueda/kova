# KOV-005 — Stripe test-mode temporal convergence drill

- Executed at: `2026-11-03T17:22:31.763757Z`
- Commit: `1a181853162b92f5d9a0c4d6432416c3dd157ed6`
- GitHub environment: `stripe-sandbox`
- Stripe mode: `livemode=false`
- Stripe account: `acct_…fRqmMP`
- Plan under acceptance: `esencial`
- Stripe price: `price_…E8Z08D` (`MXN 399.00`, monthly, count 1)
- Catalog tax inclusive: `True`
- Application/database: isolated GitHub runner, loopback only

## Hosted Checkout

- Session: `cs_test_…fQMEeH`
- Provider result: `complete/paid`
- Local result: `active`
- Kova paid plan: `{"amount_minor_units": 39900, "features": ["pos", "inventory", "sales_reports", "public_catalog"], "plan_code": "esencial"}`
- Kova access at actual application time: `{"allowed": true, "reason": "active", "valid_until": "2026-11-04T17:21:11.517512Z"}`
- Delivery: `stripe_cli_forward`

## Lifecycle and ordering evidence

| Step | # | Event | Stripe object status | Event ID | Provider created | Arrived | Result | Kova status / plan / amount / features | Lifecycle watermark | Payment watermark |
|---|---:|---|---|---|---|---|---|---|---|---|
| initial_active | 1 | `customer.subscription.created` | `active` | `evt_…eEhMYF` | 2026-11-03T17:21:16Z | 2026-11-03T17:21:19.207332Z | `processed` | `active / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.created @ 2026-11-03T17:21:16Z (evt_…eEhMYF) | None @ None (None) |
| initial_active | 2 | `invoice.payment_succeeded` | `paid` | `evt_…9e8pUV` | 2026-11-03T17:21:16Z | 2026-11-03T17:21:19.705771Z | `processed` | `active / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.created @ 2026-11-03T17:21:16Z (evt_…eEhMYF) | invoice.payment_succeeded @ 2026-11-03T17:21:19.701193Z (authoritative:evt_…9e8pUV) |
| renewal_paid | 1 | `invoice.payment_succeeded` | `paid` | `evt_…LZeAfR` | 2026-11-03T17:21:30Z | 2026-11-03T17:21:34.336566Z | `processed` | `active / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.created @ 2026-11-03T17:21:16Z (evt_…eEhMYF) | invoice.payment_succeeded @ 2026-11-03T17:21:30Z (evt_…LZeAfR) |
| payment_failed | 1 | `invoice.payment_failed` | `open` | `evt_…Q4yvs2` | 2026-11-03T17:21:47Z | 2026-11-03T17:21:49.155764Z | `processed` | `past_due / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.created @ 2026-11-03T17:21:16Z (evt_…eEhMYF) | invoice.payment_failed @ 2026-11-03T17:21:47Z (evt_…Q4yvs2) |
| payment_recovered | 1 | `invoice.paid` | `paid` | `evt_…4Ay2Aj` | 2026-11-03T17:21:52Z | 2026-11-03T17:21:54.684967Z | `processed` | `active / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.created @ 2026-11-03T17:21:16Z (evt_…eEhMYF) | invoice.paid @ 2026-11-03T17:21:52Z (evt_…4Ay2Aj) |
| period_end_canceled | 1 | `customer.subscription.deleted` | `canceled` | `evt_…BQnx0t` | 2026-11-03T17:22:02Z | 2026-11-03T17:22:04.502850Z | `processed` | `canceled / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.deleted @ 2026-11-03T17:22:02Z (evt_…BQnx0t) | invoice.paid @ 2026-11-03T17:21:52Z (evt_…4Ay2Aj) |
| cancel_then_old_payment | 1 | `customer.subscription.deleted` | `canceled` | `evt_…BPu4Kc` | 2026-11-03T17:22:16Z | 2026-11-03T17:22:16.724844Z | `processed` | `canceled / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.deleted @ 2026-11-03T17:22:16Z (evt_…BPu4Kc) | None @ None (None) |
| cancel_then_old_payment | 2 | `invoice.payment_succeeded` | `paid` | `evt_…m9qaff` | 2026-11-03T17:22:08Z | 2026-11-03T17:22:17.494398Z | `processed` | `canceled / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.deleted @ 2026-11-03T17:22:16Z (evt_…BPu4Kc) | invoice.payment_succeeded @ 2026-11-03T17:22:08Z (evt_…m9qaff) |
| cancel_then_old_payment_duplicate | 3 | `invoice.payment_succeeded` | `paid` | `evt_…m9qaff` | 2026-11-03T17:22:08Z | 2026-11-03T17:22:17.508103Z | `processed` | `canceled / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.deleted @ 2026-11-03T17:22:16Z (evt_…BPu4Kc) | invoice.payment_succeeded @ 2026-11-03T17:22:08Z (evt_…m9qaff) |
| old_payment_then_cancel | 1 | `invoice.paid` | `paid` | `evt_…4pFaGX` | 2026-11-03T17:22:21Z | 2026-11-03T17:22:29.149886Z | `processed` | `active / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | None @ None (None) | invoice.paid @ 2026-11-03T17:22:21Z (evt_…4pFaGX) |
| old_payment_then_cancel | 2 | `customer.subscription.deleted` | `canceled` | `evt_…1D4ozE` | 2026-11-03T17:22:27Z | 2026-11-03T17:22:29.409094Z | `processed` | `canceled / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.deleted @ 2026-11-03T17:22:27Z (evt_…1D4ozE) | invoice.paid @ 2026-11-03T17:22:21Z (evt_…4pFaGX) |
| old_payment_then_cancel_duplicate | 3 | `invoice.paid` | `paid` | `evt_…4pFaGX` | 2026-11-03T17:22:21Z | 2026-11-03T17:22:29.420679Z | `processed` | `canceled / esencial / MXN 39900 minor / pos,inventory,sales_reports,public_catalog` | customer.subscription.deleted @ 2026-11-03T17:22:27Z (evt_…1D4ozE) | invoice.paid @ 2026-11-03T17:22:21Z (evt_…4pFaGX) |

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
