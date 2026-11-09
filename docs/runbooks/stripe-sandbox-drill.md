# KOV-005 Stripe Sandbox drill

This runbook closes the external evidence gate for KOV-005. It operates only in Stripe test mode
against an application and PostgreSQL database created inside a GitHub-hosted runner. It never
deploys Kova, contacts the production API, or mutates the production database.

## GitHub environment

Create a GitHub environment named exactly `stripe-sandbox` and add only these values:

| Kind | Name | Requirement |
|---|---|---|
| Secret | `KOV005_STRIPE_SECRET_KEY` | `sk_test_…` or `rk_test_…`. A restricted key needs read/write access to Checkout Sessions, Customers, Payment Methods, Subscriptions, Invoices, Events and Test Clocks, plus read access to Account and Prices. Basic Portal opt-in additionally needs configuration read and Portal Sessions write. The blocked transition option also needs Subscription Schedules read. |
| Secret | `KOV005_STRIPE_STANDARD_PRICE_ID` | Active test-mode recurring Price for exactly MXN 299.00 monthly. |
| Variable | `KOV005_STRIPE_ESENCIAL_PRICE_ID` | Required for either new plan: distinct active test-mode MXN 399.00 monthly Price, interval count 1, `tax_behavior=inclusive`. |
| Variable | `KOV005_STRIPE_GESTION_PRICE_ID` | Required for either new plan: distinct active test-mode MXN 699.00 monthly Price, interval count 1, `tax_behavior=inclusive`. |
| Variable | `KOV005_STRIPE_STANDARD_PORTAL_CONFIGURATION_ID` | For basic Portal opt-in with Standard: active dedicated test configuration, subscription changes disabled, payment/history enabled and cancellation at period end. |
| Variable | `KOV005_STRIPE_TIERED_PORTAL_CONFIGURATION_ID` | For basic Portal opt-in with either new plan: active dedicated test configuration, subscription changes disabled, payment/history enabled and cancellation at period end. The transition gate remains blocked for the separate-Product catalog. |
| Variable | `KOV005_STRIPE_ACCOUNT_ID` | Exact `acct_…` identifier of the dedicated Sandbox. It is compared with `/v1/account` before mutations. |

Do not copy production Stripe secrets into this environment. No database, webhook, application,
email, Fly or Vercel secret is required. The workflow creates ephemeral PostgreSQL, application and
webhook signing secrets and deletes the test clocks and standalone Checkout customer before it can
pass. Its PostgreSQL service uses the same pinned pgvector image as CI so current vector migrations
can run; it does not provision an external database.

The workflow itself accepts only `main`, requires the exact acknowledgement, rejects live keys,
checks the exact Sandbox account and selected catalog prices, and keeps the application and
database on runner loopback. If the repository plan supports environment protection rules, also restrict the
environment to `main` and require a reviewer. The current private-repository plan returned HTTP 422
when those protection rules were configured, so they are an optional defense and must not be
described as active unless GitHub shows them on the environment.

## Run

Preflight del 29 de octubre de 2026: el environment conserva el Price y la variable de cuenta del
sandbox, pero no el secreto `KOV005_STRIPE_SECRET_KEY` (se retiró tras la evidencia anterior, según
el paso 6). La conexión Stripe disponible sólo permite la cuenta live. El último simulacro aprobado
es del 8 de septiembre, anterior a la corrección de acceso por facturación; no acredita el checkout
de la versión actual. Reinstalar una clave test directamente en el Secret store antes de ejecutar;
no pegarla en chat, logs o archivos, ni sustituirla por una clave live. La aceptación controlada de
checkout/cancelación live continúa como gate separado en [estado actual](../current-sprint.md).

Aceptación del 3 de noviembre de 2026, sobre `1a181853162b92f5d9a0c4d6432416c3dd157ed6`:

| Plan | Ejecución aprobada | Evidencia revisada |
|---|---|---|
| Esencial, MXN 399.00 | [41683047004](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41683047004) | [Checkout, Kova y ciclo](../audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-11-03-esencial.md) |
| Gestión, MXN 699.00 | [41683860187](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41683860187) | [Checkout, Kova y ciclo](../audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-11-03-gestion.md) |
| Standard, MXN 299.00 | [41684612699](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41684612699) | [Regresión del acuerdo anterior](../audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-2026-11-03-standard.md) |

Las tres ejecuciones confirmaron `complete/paid`, Kova activo con plan/importe/funciones exactos y
acceso permitido, además del ciclo de renovación simulada, falla/gracia/recuperación, cancelación,
orden de eventos y duplicados. Cada una eliminó tres Test Clocks y un cliente de Checkout; el
listener y el backend locales se detuvieron. No se usaron tenants, base ni API productivos.

La clave restringida existente no permitía consultar la cuenta. Se validó la clave estándar de
prueba ya existente contra el identificador del sandbox y se transfirió directamente al Secret
store, sin valores en archivos ni logs. La copia `KOV005_STRIPE_SECRET_KEY` ya se retiró después
de comitear la evidencia. No se crearon claves ni se cambiaron permisos en Stripe. Para repetir,
instalar otra vez la clave únicamente en el mismo entorno aislado; nunca usar una clave live.

Estas ejecuciones no cierran Portal, upgrades, aplicación efectiva de downgrades, vencimiento de
gracia según el reloj real de Kova ni aceptación fiscal/live. La oferta nueva permanece apagada.

1. Merge the runner into `main` and select **Actions → KOV-005 Stripe sandbox drill**.
2. Choose `main`, select `plan_code` (`standard` by default, `esencial`, or `gestion`), and enter
   the acknowledgement exactly as `KOV-005-STRIPE-SANDBOX-ONLY`. Run Esencial and Gestión separately
   against the intended SHA; one passing plan does not accept the other. Standard remains available
   without the two new Price variables for regression acceptance.
3. Before dispatch, check that the key and account belong to the dedicated Sandbox. If environment
   reviewers are configured, approve the deployment after that check.
4. Download `kov-005-stripe-sandbox-<plan_code>-<sha>` only after the workflow succeeds. Portal
   opt-in artifacts include `-portal-<portal_mode>` between the plan code and SHA.
5. Review the Markdown artifact. Commit it under
   `docs/audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-<plan_code>-YYYY-MM-DD.md` without adding screenshots,
   raw exports or secrets.
6. After the evidence is committed, delete `KOV005_STRIPE_SECRET_KEY` from the GitHub environment.
   Repeating the drill requires an explicit new installation of a sandbox key.

Each successful artifact accepts only its selected plan. It checks the configured Price IDs against
`app.billing.plans.PLANS`: exact amount, MXN, monthly interval/count 1, active/test status and, for
Esencial/Gestión, inclusive tax. Both new prices must be configured and pass preflight before either
new plan runs. Existing Standard agreements retain their tax configuration. The drill does not turn
on Stripe Tax or change tax registrations.

Only the ephemeral backend process receives the two new Price IDs and
`BILLING_TIERED_PLANS_ENABLED=true` for a new-plan run. Standard forces that flag off. Signup chooses
the server cohort normally; Checkout sends explicit `plan_code`. The runner never writes plan
entitlements into a tenant to manufacture acceptance. `BILLING_PORTAL_ENABLED=false` and both
Portal configuration IDs are cleared for every baseline run, regardless of inherited settings.
The explicit Portal opt-in described below enables only its selected configuration in that child
process; it does not change any deployment, account configuration or production feature flag.

The drill checks hosted Checkout, renewal, payment failure and grace, payment recovery, scheduled
cancellation, period-end cancellation, both cross-family arrival orders and duplicate delivery. The
cross-family cases use provider-generated `livemode=false` events retrieved from Stripe and send
them through Kova's real webhook route with a valid ephemeral signature in controlled order.

Stripe Test Clocks advance **Stripe only**. The Kova process continues to use actual UTC; no
application clock, invoice timestamp or entitlement expiry is patched. Initial paid Checkout and
initial lifecycle acceptance require Kova to grant the selected plan, exact amount/features and
commercial access. Later lifecycle snapshots must retain the expected plan and features. Provider
renewals/cancellation dates and event arrival are recorded separately from Kova state. These
events demonstrate convergence; they do not demonstrate that the corresponding real time elapsed
in Kova, grace expiry, or an effective plan downgrade.

**Portal, upgrades and effective downgrades remain separate acceptance gates.** This runner does
not open the Portal or change subscription tiers. A passing new-plan artifact must not be used to
claim those gates complete. Never emulate `GITHUB_ACTIONS=true` locally to run against Stripe;
local verification uses stubbed unit tests only.

## Optional integrated hosted Portal acceptance

### Campo opcional de Link

La reproducción interactiva del 9 de noviembre guardó una tarjeta de prueba como método
predeterminado sin proporcionar teléfono ni registrar Link. Un correo precargado en el bloque
opcional no es consentimiento para ese registro. El helper conserva esos campos y sólo desmarca
un control de opt-in que realmente esté marcado; no vacía campos que Stripe mantiene como
requeridos. El fixture local anterior asumía incorrectamente que el correo precargado activaba
Link. Se corrigió ese supuesto y se comprueba que el helper conserva el correo suministrado.
La aceptación alojada sigue exigiendo que cambie el método predeterminado efectivo del mismo
Customer; el resultado local y la reproducción aislada no sustituyen el drill completo de Kova.

`include_portal` is **false by default**. With explicit opt-in, `portal_mode=basic` is the default
and supports Standard, Esencial and Gestión separately. Each artifact accepts only its selected
plan. `portal_mode=transitions` is a separate opt-in gate; it remains blocked for the correct
catalog with one distinct Product per commercial plan. Do not combine Products to force this gate
through: Stripe's billing integration guidance requires distinct Product identities for distinct
tiers, and a price nickname is not a replacement for customer-facing Checkout/invoice names.

All existing guards remain required: Actions on main, loopback application/database, exact Sandbox
account, test key, acknowledgement, Price preflight, signed listener and successful cleanup.
Preflight reads the selected Portal configuration with
`expand[]=features.subscription_update.products` and rejects live/inactive/mismatched settings.
Basic mode requires subscription updates **disabled**, payment method update/history enabled,
and cancellation enabled only with `mode=at_period_end`. Configurations enabling tier changes fail
this preflight before any customer is created. Both cohort-specific configuration inputs remain
explicit; Basic may share an accepted configuration with subscription updates disabled. Only the
ephemeral backend receives the selected configuration and Portal flag.

The verified owner requests `POST /api/v1/billing/portal`; the test never sends a customer or return
URL. The API independently reads and validates that configuration. The Node helper accepts only a
hosted URL on the exact `https://billing.stripe.com` origin emitted by Kova, together with explicit
test-mode provenance. The provider session path is opaque; do not infer an ID, mode or a fixed
`/p/session/` prefix from it. Bearer URLs live only in private temporary files, removed in `finally`, never logs or
evidence. The helper receives no provider keys or database configuration. An always-run workflow
step also removes transient state files after cancellation.

After a hosted UI failure only, `KOV005_PORTAL_FIELD_STATE` reports at most 64 visible form fields
across at most 12 frames. It contains fixed field-kind enums and booleans for filled/required/native
validity/ARIA invalid/checked, preserving distinct fields of the same kind. Hidden inputs, transparent
controls and hidden frames are excluded. Names, values, lengths, URLs, IDs, raw errors and HTML never
enter this diagnostic. The runner rejects any additional keys, invalid types or oversized/ambiguous
payload before forwarding it. Native HTML validity alone does not prove Stripe accepted a method.

The first Basic Standard attempt on `31b0693f5a74`
([41696841814](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41696841814)) stopped before
the hosted UI because the runner required a non-contractual `/p/session/` prefix. The independent
cleanup step passed. This is a failed acceptance, not evidence that the Portal flow works; repeat
after aligning the helper with the backend's exact HTTPS origin and opaque provider URL contract.

### Basic acceptance

1. A real paid Checkout establishes the selected plan in Kova. The hosted Portal overview must be
   healthy, show the current price and billing/history information, and expose no plan-change
   control. Neither a blank page nor a provider configuration alone proves this UI result.
2. The hosted UI adds/updates a Stripe test card. The effective default payment method used by the
   subscription must change to a new test PaymentMethod owned by the same customer. A newly
   attached card that does not become the effective default does not pass. Provider Price, quantity,
   period and Kova plan/amount/features/access must remain unchanged. No API payment-method update
   is substituted for this UI action.
3. The hosted UI requests cancellation. Stripe and Kova must both confirm `cancel_at_period_end`,
   preserve the existing paid period, exact plan/features/amount and current commercial access.
   This proves the cancellation request, **not** that real time elapsed or cancellation took effect.

Basic mode never attempts a tier change. It uses the already paid Checkout customer, already
registered in the durable cleanup manifest. Every created customer, including any additional
transition fixture, remains subject to the existing all-object cleanup on success or failure.
No artifact is accepted if cleanup fails. No shared configuration, Product or Price is changed.
The signed Stripe listener remains active throughout these steps; no application clock, invoice,
plan code or entitlement timestamp is patched. Kova frontend return navigation is not exercised:
the scope is Kova API → hosted Stripe UI → provider/webhooks → Kova state.

### Blocked transition acceptance

The `transitions` option retains the proposed rejection/success/scheduled-downgrade test, but the
preflight deliberately rejects the current two-Product tiered configuration before creating
objects. Stripe documents that period-end Portal downgrades are supported only between Prices
for the same Product:
[Portal subscription management](https://docs.stripe.com/customer-management/configure-portal).
A syntactically valid multi-Product Portal configuration does not establish this capability.
The runtime configuration guard also rejects unsupported tier-change configurations. Payment,
history and deferred cancellation remain compatible with separate Products and updates disabled.

A future supported plan-change design needs its own Kova API/UX, authorization, settled-payment
upgrade and scheduled-downgrade contract and evidence. This basic drill must not be used to claim
self-service plan transitions, an effective downgrade, fiscal compliance or live operation. No
provider API fallback manufactures a hosted transition result, and no real-time wait is replaced
with a fake Kova clock.

The artifact records separate provider subscription/payment-method/cancellation observations and
Kova plan/amount/features/access. Baseline artifact names stay unchanged. Portal opt-in artifacts
include `-portal-<portal_mode>` between plan and SHA. Commit reviewed evidence to
`docs/audits/evidence/KOV-005-STRIPE-PORTAL-<portal_mode>-<plan_code>-YYYY-MM-DD.md`, preserving
prior baseline artifacts. Failure output contains a bounded safe stage rather than URLs or page
contents. New hosted layouts or unsupported settings fail closed and require review.

## Required evidence

The artifact must contain the tested commit SHA, `livemode=false`, the redacted Sandbox account and
Price, selected `plan_code`, minor-unit amount, exact features, authenticated Kova access result,
provider object status, event creation and arrival timestamps, local subscription state, lifecycle
and payment watermarks, access outcome, duplicate outcome and successful cleanup counts. Stripe identifiers
must remain redacted to their prefix and final six characters.

The gate remains open if the job is skipped, fails, cannot delete every created Test Clock/customer,
uses a commit other than the intended `main` SHA, or lacks the downloaded and reviewed artifact.


### Diagnóstico seguro del control del Portal

El segundo intento Standard sobre `88bb94056a0f`
([41702585620](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41702585620)) abrió el Portal
y verificó la oferta, pero falló en `save_payment_method`; la limpieza independiente aprobó. No
acepta cambio de método ni cancelación. El helper eliminó un filtro inmediato de `isEnabled`
que impedía el auto-wait; la regresión reprodujo ese defecto, sin atribuirle aún la causa real.

El clic espera hasta 15 segundos por aparición/visibilidad y conserva el auto-wait de Playwright
para controles deshabilitados o todavía no accionables. Nunca se fuerza un clic ni se omite la
validación del formulario. Un fallo distingue `control_not_found`, `control_not_visible`,
`control_disabled`, `click_timeout` o `click_failed`; un timeout de otra etapa es `stage_timeout`.
El resumen sólo incluye etiquetas públicas conocidas convertidas a enums y su estado habilitado.
Cualquier texto de botón no reconocido se convierte en `other`; no se registran URLs, errores
crudos, valores de campos, datos de tarjeta ni contenido del cliente. Estas observaciones indican
el estado del control al fallar, no confirman por sí solas una causa de validación o de transición.

El fixture de pago usa US y el código postal de QA 10001 explícitamente. El helper pulsa Tab tras
CVC y tras el postal requerido, para que PaymentElement confirme los campos al perder foco. No
rellena el nombre opcional de Link y desmarca únicamente opt-ins identificados como Link.
Cuando la sección opcional observada no tiene checkbox, vacía sólo el campo visible
`search-linkEmail` y confirma el opt-out con blur. Repite ese paso tras país/postal por si Stripe
vuelve a prellenarlo. No modifica el correo del Customer ni campos genéricos de billing, teléfono,
nombre, configuración de Link o CAPTCHA. La regresión de iframe conserva intactos los proxies
invisibles y el email de billing y no envía peticiones externas. Este comportamiento se apoya en
la inscripción opcional y el prefill documentados por
[Stripe Link](https://docs.stripe.com/payments/link/payment-element-link#automatically-prefill-link-for-your-customers). Ausencia
de controles de país/postal se reporta con enums `billing_country_missing`/`billing_postal_missing`,
sin valores ni etiquetas de campos. La regresión local usa un iframe sin red cuyo botón permanece
deshabilitado hasta completar país, postal y blur; corre obligatoriamente en el paso sandbox con
`KOV005_PORTAL_LOCAL_BROWSER_TEST=true` después de instalar Chromium. El CI normal conserva los
puros y puede omitir sólo ese fixture de navegador. Esta elección determinista de país no prueba
que el país fuese la causa del fallo del proveedor; la aceptación real sigue siendo independiente.

El intento Standard con riesgos/Portal
[41752448546](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41752448546) superó el
reembolso QA de MXN 1.00 y falló al guardar el método de pago. El diagnóstico observó el email de
Link prellenado, teléfono vacío requerido y ningún checkbox; la inspección visible confirmó la
sección «Optional». Ambas limpiezas aprobaron, pero no existe artefacto de aceptación de esa
corrida. El ajuste del helper y sus pruebas locales no acreditan el Portal del proveedor: hace
falta repetir el workflow sobre el SHA corregido.

El siguiente intento, [41754550717](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41754550717),
volvió a detenerse en Add deshabilitado aunque el campo de Link ya estaba vacío. Por tanto, esa
observación no demuestra que Link causara el fallo. La inspección manual con datos QA, `fill` y
Tab habilitó Add tanto con país MX como con US y postal; no se pulsó Add ni se guardó un método de
pago. No está probada una restricción universal del Portal, un problema de vencimiento o una causa
antifraude.

La variante de entrada usa `fill("")`, `pressSequentially(text, {delay: 25})` y Tab para número,
vencimiento, CVC y postal; el país conserva `selectOption("US")` y Tab. Esta es una hipótesis
acotada de sincronización/eventos de teclado. La regresión DOM local modela una máscara que
requiere `keydown` y demuestra ese mecanismo, no la implementación interna de Stripe. Playwright
[documenta entrada secuencial para manejo especial de teclado](https://playwright.dev/docs/input#type-characters).
La causa y la aceptación real siguen pendientes del workflow. El helper no fuerza controles,
no lee internos del SDK ni evita desafíos de seguridad.

El diagnóstico añade `fixture_match` boolean únicamente a `card_number`, `card_expiry`, `card_cvc`,
`billing_country` y `billing_postal`. Compara los fixtures dentro del frame visible (normaliza
espacios de tarjeta y espacios/separador de vencimiento); no exporta valores, longitudes, mensajes
crudos ni atributos. Los demás kinds no incluyen esa clave. El parser exige exactamente esa forma
y tipos boolean, y rechaza claves extra, números, texto, null o valores anidados. Coincidir con
un fixture y tener `html_valid=true` no equivale al `complete` del SDK ni a un pago aceptado.

## Optional risk-event acceptance

`include_risk` is **false by default**. Opt in on the same reviewed `main` SHA that contains the
risk handler and its threadpool fix, with the existing acknowledgement and dedicated sandbox
account/key. This does not change a live event destination or any production flag. A baseline run
without this option does not accept risk events. The artifact name adds `-risk` before any Portal
suffix, and the Markdown must contain three successful risk records.

The sandbox key additionally needs Charges read, InvoicePayments read, PaymentIntents read/write
and Refunds read/write. Existing Account, Checkout, Customer, Subscription, Invoice and Event
permissions remain necessary. The risk-only HTTP client pins `2026-09-30.endive`; other drill
requests keep their existing version. Install credentials only in the GitHub `stripe-sandbox`
secret store. Do not emulate Actions locally, expose a key, or replace it with a live credential.

The risk sequence runs immediately after a settled paid Checkout and **before** Portal changes,
while the real Stripe CLI listener and isolated Kova receiver are running:

1. Prove that the test Checkout, its Customer, local/remote Subscription, paid Invoice,
   InvoicePayments, successful PaymentIntent and Charge belong together. Reject live objects,
   contradictory ownership, prior refunds and payments shared with another invoice before making
   a refund. Request a partial refund of **100 MXN minor units (MXN 1.00)** on that Charge;
   the Charge must exceed that amount so the refund stays partial. The resulting
   `charge.refunded` must arrive through the signed listener and persist as processed/matched,
   associated with the proven local tenant, with exactly one risk audit and processing attempt.
2. Create separate, tagged QA Customers and durably register their cleanup **before** creating
   payments. Confirm test PaymentIntents using Stripe's documented `pm_card_createDispute` and
   `pm_card_createIssuerFraudRecord` fixtures. Their real dispute/early-warning events have no
   invoice or subscription: each must persist as processed/global `no_subscription`, never failed
   or assigned to the Checkout tenant. No subscription default payment method changes.
3. For every type, compare the full local Subscription (including both watermark streams), Kova
   Payment/refund rows and commercial access before/after. Replay the actual provider event once with
   the ephemeral signing secret; require one audit and attempt again. Verify the critical incident
   through Ops queries and persisted acknowledgement/resolution, including pending-health counts.
   This exercises **services/repositories in the disposable database**, not founder MFA, the Ops
   authenticated API or its UI. It does not authorize an operator action on a production case.

The Standard risk/Portal attempt
[41737681325](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41737681325) failed before
Portal: Stripe rejected the original MXN 0.01 refund with `amount_too_small` because of currency
conversion. The QA fixture now uses MXN 1.00; this is not a universal Stripe minimum or an exchange
rate assertion. Repeat the guarded drill to accept the corrected fixture; this code change does
not constitute provider acceptance.

The official CLI version has a dispute fixture but no early-fraud-warning trigger. This option
uses documented test PaymentMethods through Stripe HTTP instead of inventing an event or card:
[Stripe dispute and early-warning fixtures](https://docs.stripe.com/testing#disputes),
[PaymentIntent creation](https://docs.stripe.com/api/payment_intents/create),
[partial refund API](https://docs.stripe.com/api/refunds/create).
Radar rules can block the fixture. A missing provider event times out and fails the run; do not
change Radar settings, inject a synthetic successful event, or accept a partial artifact to get a
passing result. Unmapped lookup errors also fail acceptance rather than passing as no_subscription.

Every newly created Customer uses the existing durable cleanup manifest and the always-run retry.
Checkout/fixture Customers and baseline Test Clocks must be deleted before evidence is accepted.
Successful test PaymentIntents, Charges, refunds and dispute/fraud history remain provider records;
Stripe does not provide deletion of paid Charges. No real customer data is submitted. The artifact
contains only fixed risk result fields and counts, never IDs, metadata, raw payloads, client secrets
or provider error bodies. API failures in this option also omit object IDs from diagnostics.

Three sandbox records accept only this selected plan/SHA and these cases: **matched partial
refund, global dispute, global early warning**. They do not establish a subscription-linked
fraud/dispute workflow, a multi-invoice provider scenario, Ops MFA UI, live delivery, or an automatic
risk decision. Local tests use doubles; provider acceptance begins only when the guarded workflow
actually runs successfully. Publish the reviewed code with commercial flags off, inspect the
same-SHA sandbox evidence, and complete the separate Portal/plan gates before enabling the
commercial offer. Subscribe live risk events only after the handler release and provider acceptance.
