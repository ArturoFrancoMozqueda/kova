# KOV-005 — Stripe test-mode temporal convergence drill

- Executed at: `2026-09-08T02:16:39.168398Z`
- Local date: `2026-09-07` (`America/Mexico_City`)
- GitHub Actions: [run 34179307328](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/34179307328)
- Artifact: `kov-005-stripe-sandbox-6933ac2585de038f3b697e80cda6f35f078b9a00`
- Commit: `6933ac2585de038f3b697e80cda6f35f078b9a00`
- GitHub environment: `stripe-sandbox`
- Stripe mode: `livemode=false`
- Stripe account: `acct_…fRqmMP`
- Stripe price: `price_…hiydcF` (`MXN 299.00`, monthly)
- Application/database: isolated GitHub runner, loopback only

## Hosted Checkout

- Session: `cs_test_…jFILYN`
- Provider result: `complete/paid`
- Local result: `active`
- Delivery: `stripe_cli_forward`

## Lifecycle and ordering evidence

| Step | # | Event | Event ID | Provider created | Arrived | Result | Local status | Lifecycle watermark | Payment watermark |
|---|---:|---|---|---|---|---|---|---|---|
| initial_active | 1 | `customer.subscription.created` | `evt_…eHZcqL` | 2026-09-08T02:15:20Z | 2026-09-08T02:15:22.380388Z | `processed` | `active` | customer.subscription.created @ 2026-09-08T02:15:20Z (evt_…eHZcqL) | None @ None (None) |
| initial_active | 2 | `invoice.payment_succeeded` | `evt_…QmPbVW` | 2026-09-08T02:15:20Z | 2026-09-08T02:15:22.593363Z | `processed` | `active` | customer.subscription.created @ 2026-09-08T02:15:20Z (evt_…eHZcqL) | invoice.payment_succeeded @ 2026-09-08T02:15:22.589316Z (authoritative:evt_…QmPbVW) |
| renewal_paid | 1 | `invoice.paid` | `evt_…mBLj1M` | 2026-09-08T02:15:34Z | 2026-09-08T02:15:36.601887Z | `processed` | `active` | customer.subscription.created @ 2026-09-08T02:15:20Z (evt_…eHZcqL) | invoice.paid @ 2026-09-08T02:15:34Z (evt_…mBLj1M) |
| payment_failed | 1 | `invoice.payment_failed` | `evt_…zfQa3G` | 2026-09-08T02:15:51Z | 2026-09-08T02:15:55.285507Z | `processed` | `past_due` | customer.subscription.created @ 2026-09-08T02:15:20Z (evt_…eHZcqL) | invoice.payment_failed @ 2026-09-08T02:15:51Z (evt_…zfQa3G) |
| payment_recovered | 1 | `invoice.paid` | `evt_…Y7ex7n` | 2026-09-08T02:15:58Z | 2026-09-08T02:16:00.556260Z | `processed` | `active` | customer.subscription.created @ 2026-09-08T02:15:20Z (evt_…eHZcqL) | invoice.paid @ 2026-09-08T02:15:58Z (evt_…Y7ex7n) |
| period_end_canceled | 1 | `customer.subscription.deleted` | `evt_…f7dzjA` | 2026-09-08T02:16:09Z | 2026-09-08T02:16:11.397358Z | `processed` | `canceled` | customer.subscription.deleted @ 2026-09-08T02:16:09Z (evt_…f7dzjA) | invoice.paid @ 2026-09-08T02:15:58Z (evt_…Y7ex7n) |
| cancel_then_old_payment | 1 | `customer.subscription.deleted` | `evt_…uYGrys` | 2026-09-08T02:16:23Z | 2026-09-08T02:16:23.983941Z | `processed` | `canceled` | customer.subscription.deleted @ 2026-09-08T02:16:23Z (evt_…uYGrys) | None @ None (None) |
| cancel_then_old_payment | 2 | `invoice.payment_succeeded` | `evt_…zYpql8` | 2026-09-08T02:16:15Z | 2026-09-08T02:16:24.175746Z | `processed` | `canceled` | customer.subscription.deleted @ 2026-09-08T02:16:23Z (evt_…uYGrys) | invoice.payment_succeeded @ 2026-09-08T02:16:15Z (evt_…zYpql8) |
| cancel_then_old_payment_duplicate | 3 | `invoice.payment_succeeded` | `evt_…zYpql8` | 2026-09-08T02:16:15Z | 2026-09-08T02:16:24.188444Z | `processed` | `canceled` | customer.subscription.deleted @ 2026-09-08T02:16:23Z (evt_…uYGrys) | invoice.payment_succeeded @ 2026-09-08T02:16:15Z (evt_…zYpql8) |
| old_payment_then_cancel | 1 | `invoice.payment_succeeded` | `evt_…WEzJ7H` | 2026-09-08T02:16:28Z | 2026-09-08T02:16:36.903602Z | `processed` | `active` | None @ None (None) | invoice.payment_succeeded @ 2026-09-08T02:16:28Z (evt_…WEzJ7H) |
| old_payment_then_cancel | 2 | `customer.subscription.deleted` | `evt_…4TV2Gf` | 2026-09-08T02:16:36Z | 2026-09-08T02:16:36.916509Z | `processed` | `canceled` | customer.subscription.deleted @ 2026-09-08T02:16:36Z (evt_…4TV2Gf) | invoice.payment_succeeded @ 2026-09-08T02:16:28Z (evt_…WEzJ7H) |
| old_payment_then_cancel_duplicate | 3 | `invoice.payment_succeeded` | `evt_…WEzJ7H` | 2026-09-08T02:16:28Z | 2026-09-08T02:16:36.926426Z | `processed` | `canceled` | customer.subscription.deleted @ 2026-09-08T02:16:36Z (evt_…4TV2Gf) | invoice.payment_succeeded @ 2026-09-08T02:16:28Z (evt_…WEzJ7H) |

## Acceptance

- Hosted Checkout completed using Stripe's test-mode page.
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
