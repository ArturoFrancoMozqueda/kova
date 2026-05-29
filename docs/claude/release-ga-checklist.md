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
- Production deploys require explicit approval.
