---
paths:
  - "**/*stripe*"
  - "**/*billing*"
  - "**/*subscription*"
  - "**/*checkout*"
  - "**/*webhook*"
  - "**/*pricing*"
  - "**/migrations/**/*billing*"
  - "**/migrations/**/*subscription*"
---

# Billing and Stripe Rules

Kova monetization depends on safe subscription logic.

## Non-negotiables

- Do not assume price, currency, billing interval, plan name, price ID, or trial behavior.
- Verify pricing in code, migrations, environment names, Stripe config references, and planning docs before changing billing copy or logic.
- Keep Stripe test and live mode clearly separated.
- Do not print, expose, or commit Stripe secret keys, webhook secrets, or customer payment details.
- Preserve billing gates that control access to paid functionality.
- Do not make unpaid accounts look fully active unless explicitly required by product requirements.
- Do not fake subscription status in production paths.

## Stripe webhook rules

- Verify event names and idempotency.
- Preserve signature verification.
- Preserve safe handling for repeated or out-of-order events.
- Do not assume one webhook event is enough to represent all subscription states.
- Never trust client-side payment success alone.
