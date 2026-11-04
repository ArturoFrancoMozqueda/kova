# Billing State Copy Matrix

Last updated: 2026-11-02

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
| `complimentary` | Operator-managed `complimentary_access = true`, without a Stripe subscription | none | yes | `/settings/billing` |
| `trialing` | Stripe subscription `status = trialing` | info | yes | `/settings/billing` |
| `past_due_grace` | Status `past_due` AND `now < min(grace_period_ends_at, past_due_at + 48h)` | warning | yes | `/settings/billing` |
| `trial_expired` | No subscription, signup-trial window has passed | danger | no | `/settings/billing` |
| `past_due` | Status `past_due` AND no active grace | danger | no | `/settings/billing` |
| `past_due_grace_expired` | Status `past_due` AND `grace_period_ends_at` in the past | danger | no | `/settings/billing` |
| `canceled` | Status `canceled` | danger | no | `/settings/billing` |
| `unpaid` | Status `unpaid` | danger | no | `/settings/billing` |
| `incomplete` | Status `incomplete` or `incomplete_expired` | danger | no | `/settings/billing` |
| `verification_required` | Missing/expired paid period or authoritative status cannot be verified within 24h | danger | no | `/settings/billing` |
| (Stripe unavailable / fallback) | Status unknown or transient API failure | danger | no | `/settings/billing` |

## Copy matrix

All strings live in `frontend/src/i18n/messages.ts → billingBanner`. Headings are sentence case.
Bodies are 1 sentence, cause + recovery action.

| State | Title | Body |
|---|---|---|
| `complimentary` | Acceso de cortesía activo | Tu negocio tiene acceso permanente a Kova, sin vencimiento ni cobros automáticos. |
| `signup_trial` | Prueba activa | Prueba activa por *N días*. Activa el Plan Estándar para conservar la operación al terminar. |
| `trialing` | Prueba activa | Tu suscripción está en prueba. Activa el Plan Estándar por $299 MXN/mes para seguir vendiendo cuando termine. |
| `past_due_grace` | Pago vencido | El pago falló. Tienes hasta 48 horas desde el primer intento fallido para recuperarlo antes de perder el acceso. |
| `trial_expired` | Suscripción requerida | Tu prueba terminó. Activa el Plan Estándar para seguir vendiendo. |
| `past_due` / `past_due_grace_expired` | Suscripción requerida | El periodo de gracia terminó. Paga ahora para recuperar las funciones de pago. |
| `canceled` | Suscripción requerida | Tu suscripción está cancelada. Reactívala para volver a usar las funciones de pago. |
| `unpaid` | Suscripción requerida | Tu suscripción está sin pagar. Recupérala para seguir vendiendo. |
| `incomplete` | Suscripción requerida | El pago no se completó. Termina el pago para activar tu suscripción. |
| Fallback / Stripe unavailable | Suscripción requerida | Activa la suscripción para recuperar las funciones del POS. |
| `verification_required` | Verificación pendiente | No pudimos confirmar un periodo pagado vigente. Actualiza el estado o contacta a soporte; no repitas el pago. |

## CTA copy

All states show a single primary action:

| Element | Copy | Target |
|---|---|---|
| Banner CTA button | Administrar suscripción | `access.recovery_path || /settings/billing` |
| Dismiss button (info only) | Descartar | — |

Only `info` tone banners are dismissible. Warning and danger banners stay visible until
the underlying state changes.

## Contexto de plan y oferta

La oferta nueva sigue apagada por defecto. Los textos de Standard y $299 de esta matriz describen
la cohorte anterior; no se sustituyen masivamente ni se muestran como una oferta disponible para
una cohorte nueva. El [contrato comercial](../specs/billing/commercial_plans.md) añade información
de plan y catálogo resuelta por el backend:

- La prueba finita de una nueva cohorte permite evaluar Gestión sin afirmar que hubo un pago.
- Las acciones de contratación usan solo `available_plans`; la UI no inventa Price IDs ni habilita
  opciones ocultas por el servidor. Mostrar el precio final del plan seleccionado y la periodicidad.
- Una función excluida por plan muestra una restricción de plan; no aparenta falta de datos, falta
  de permiso de rol ni deuda. El estado de facturación conserva sus motivos y su recuperación.
- Si la oferta está deshabilitada después de asignar un plan, conservar el nombre/alcance efectivo
  y no proponer un Checkout inexistente ni un cambio automático a Standard.
- Plan desconocido o verificación pendiente no se presenta como Gestión activo, cancelación o
  prueba renovada. Una cortesía conserva su presentación sin acciones de cobro.

La publicación de precios y la configuración de proveedores requieren aceptación posterior; estos
textos no acreditan que el nuevo recorrido esté publicado.

## Behavior rules

1. **Routing:** The banner is hidden on routes that begin with `/settings/billing` (the
   user is already on the recovery surface).
2. **Dismissal:** Info banners persist their dismissed state in `sessionStorage` under
   `kova.billingBanner.dismissed.<reason>`. Closing the tab re-shows the banner.
3. **Blocking:** When `access.allowed === false`, the backend returns HTTP 402 from
   commercial routes (`POST /api/v1/orders`, etc.) with `{ reason, recovery_path }`. The
   frontend closes the commercial surface and sends the owner to billing recovery. Employees see
   a notice to contact the owner without a billing-permission redirect loop. Export/deletion remain available.
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
| `stale` | A local period exists, but it is expired or was not synchronized with Stripe in the previous 24 hours. | Recheck current Stripe state; if a current period cannot be verified, suspend commercial access and show recovery without asserting cancellation. |
| `unavailable` | No period end is available. | Uses the same verification/reassurance copy and does not invent a date. |

`subscription.cancel_at_period_end` is a normalized scheduling flag, not a copy of one provider
field. It is true for Stripe's explicit legacy boolean or for an integer `cancel_at` in the future
that exactly matches the period end in the same authoritative subscription object (top level or
item). Missing/null, booleans used as timestamps, strings, floats, expired dates and different future
dates do not establish this scheduling flag. It never uses a cached local period as proof.

When the period is verified, both representations use `Acceso hasta` and the existing scheduled
cancellation copy; neither changes the active plan, price, paid boundary, debt or access gates.
An authoritative resume with false/null clears the flag, while stale/replayed events cannot undo a
newer state. `canceled_at` can be the cancellation request time and is not the service end; only the
subscription's authoritative status establishes effective cancellation. See the
[Stripe Subscription fields](https://docs.stripe.com/api/subscriptions/object) and
[cancellation lifecycle](https://docs.stripe.com/billing/subscriptions/cancel).

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

## Existing subscription with a pending payment

For Stripe `past_due` and `unpaid`, the billing page must not offer a new
checkout: the backend considers both live subscriptions and rejects duplicates.
Show the pending-payment recovery explanation and the official support link
while retaining the actual subscription/access status. Recovery applies to the
existing subscription; it does not assert that the subscription is active.
