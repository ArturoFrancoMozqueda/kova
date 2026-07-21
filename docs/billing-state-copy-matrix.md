# Billing State Copy Matrix

Last updated: 2026-07-20

Single reference for every billing state surfaced in the Kova UI. Source of truth for
`frontend/src/billing/BillingBanner.tsx`, `frontend/src/billing/BillingView.tsx`, and the
backend `require_commercial_access` dependency (`backend/app/billing/access.py`).

If you add a new billing state, update this table first, then the i18n keys in
`frontend/src/i18n/messages.ts` under `billingBanner` / `billing`, then wire it through
the banner.

## State legend

| State key (`access.reason`) | Backend trigger | Banner tone | Allowed? | Recovery path |
|---|---|---:|:---:|---|
| `signup_trial` | No subscription, tenant within `billing_trial_days` window | info | yes | `/settings/billing` |
| `trialing` | Stripe subscription `status = trialing` | info | yes | `/settings/billing` |
| `past_due_grace` | Status `past_due` AND `grace_period_ends_at > now` | warning | yes | `/settings/billing` |
| `trial_expired` | No subscription, signup-trial window has passed | danger | no | `/settings/billing` |
| `past_due` | Status `past_due` AND no active grace | danger | no | `/settings/billing` |
| `past_due_grace_expired` | Status `past_due` AND `grace_period_ends_at` in the past | danger | no | `/settings/billing` |
| `canceled` | Status `canceled` | danger | no | `/settings/billing` |
| `unpaid` | Status `unpaid` | danger | no | `/settings/billing` |
| `incomplete` | Status `incomplete` or `incomplete_expired` | danger | no | `/settings/billing` |
| (Stripe unavailable / fallback) | Status unknown or transient API failure | danger | no | `/settings/billing` |

## Copy matrix

All strings live in `frontend/src/i18n/messages.ts → billingBanner`. Headings are sentence case.
Bodies are 1 sentence, cause + recovery action.

| State | Title | Body |
|---|---|---|
| `signup_trial` | Prueba activa | Prueba activa por *N días*. Activa el Plan Estándar para conservar la operación al terminar. |
| `trialing` | Prueba activa | Tu suscripción está en prueba. Activa el Plan Estándar por $299 MXN/mes para seguir vendiendo cuando termine. |
| `past_due_grace` | Pago vencido | El pago falló. Actualiza tu facturación dentro del periodo de gracia para no perder el acceso. |
| `trial_expired` | Facturación requerida | Tu prueba terminó. Activa el Plan Estándar para seguir vendiendo. |
| `past_due` / `past_due_grace_expired` | Facturación requerida | El periodo de gracia terminó. Paga ahora para recuperar las funciones de pago. |
| `canceled` | Facturación requerida | Tu suscripción está cancelada. Reactívala para volver a usar las funciones de pago. |
| `unpaid` | Facturación requerida | Tu suscripción está sin pagar. Recupera la facturación para seguir vendiendo. |
| `incomplete` | Facturación requerida | El pago no se completó. Termina el pago para activar tu suscripción. |
| Fallback / Stripe unavailable | Facturación requerida | Activa la facturación para recuperar las funciones del POS. |

## CTA copy

All states show a single primary action:

| Element | Copy | Target |
|---|---|---|
| Banner CTA button | Administrar facturación | `access.recovery_path || /settings/billing` |
| Dismiss button (info only) | Descartar | — |

Only `info` tone banners are dismissible. Warning and danger banners stay visible until
the underlying state changes.

## Behavior rules

1. **Routing:** The banner is hidden on routes that begin with `/settings/billing` (the
   user is already on the recovery surface).
2. **Dismissal:** Info banners persist their dismissed state in `sessionStorage` under
   `kova.billingBanner.dismissed.<reason>`. Closing the tab re-shows the banner.
3. **Blocking:** When `access.allowed === false`, the backend returns HTTP 402 from
   commercial routes (`POST /api/v1/orders`, etc.) with `{ reason, recovery_path }`. The
   frontend surfaces the banner; the underlying action button shows its own inline error.
4. **Trial chip:** The header trial chip (`copy.trialChip`) is independent of the banner —
   it shows time remaining only while `signup_trial` or `trialing` is active. The chip is
   never shown for blocked states.
5. **Sentry / telemetry:** Blocked responses log `billing_blocked` with `{ reason }` to the
   telemetry router so we can detect false positives.

## Period freshness on the billing page

`GET /api/v1/billing/subscription` adds `subscription.period_freshness` without exposing the
internal Stripe synchronization timestamp.

| Value | Backend meaning | Billing UI |
|---|---|---|
| `verified` | `current_period_end` is in the future and the Stripe period was synchronized within the previous 24 hours. | Shows `Próxima renovación` and the verified date; when cancellation is scheduled, shows `Acceso hasta`. |
| `stale` | A local period exists, but it is expired or was not synchronized with Stripe in the previous 24 hours. | Hides the date and says that Kova is verifying the next renewal; current access is unchanged. |
| `unavailable` | No period end is available. | Uses the same verification/reassurance copy and does not invent a date. |

The success return from Stripe is also non-authoritative: it says `Estamos confirmando tu
suscripción` until the billing API or bounded reconciliation returns `active` or `trialing`. If
confirmation remains delayed, the UI tells the owner not to repeat the payment and provides the
official support link.

## When to update which surface

- **Banner title or body:** update `i18n/messages.ts → billingBanner` only.
- **Adding a new state:** update this matrix, then `BillingAccess.reason` (frontend type
  + backend response), then `bannerForAccess` in `BillingBanner.tsx`, then the i18n keys.
- **Recovery path:** override on a per-state basis via `access.recovery_path` from the
  backend. Default is `/settings/billing`.
