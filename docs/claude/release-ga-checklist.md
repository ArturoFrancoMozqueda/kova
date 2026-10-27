# Kova Release / GA Checklist

Before launch-impacting changes, verify:

## Product readiness

- Landing page explains what Kova is and why it is worth paying for.
- Signup/payment/onboarding path is understandable.
- Empty states help users configure the product.
- Reports use real data only.
- Mobile/tablet/desktop flows are usable.

## Billing readiness

- Stripe live/test separation is correct.
- Pricing copy matches configured Stripe price.
- Webhooks are configured and verified.
- Paid/unpaid states work correctly.
- Failed payment behavior is clear.

## Security readiness

- RLS and tenant isolation are preserved.
- Cookie-only auth behavior is preserved.
- No secrets are exposed.
- Merging to `main` publishes to production automatically once `CI required` passes; review the
  change before merging, not after.

## Release readiness

See [`../despliegue.md`](../despliegue.md) for the full flow.

- Migrations are reversible and work with the previous app version (rollback never downgrades
  the database).
- The release job captured a `release-rollback-<sha>` artifact and finished without
  `RELEASE_FAILED_RECOVERED` or `RECOVERY_BLOCKED`.
- `https://api.kovasuite.com/health` reports the new `release_sha` and `/health/db` succeeds.
- Authenticated manual QA follows [`manual-qa-checklist.md`](manual-qa-checklist.md).
