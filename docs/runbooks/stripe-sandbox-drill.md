# KOV-005 Stripe Sandbox drill

This runbook closes the external evidence gate for KOV-005. It operates only in Stripe test mode
against an application and PostgreSQL database created inside a GitHub-hosted runner. It never
deploys Kova, contacts the production API, or mutates the production database.

## GitHub environment

Create a GitHub environment named exactly `stripe-sandbox` and add only these values:

| Kind | Name | Requirement |
|---|---|---|
| Secret | `KOV005_STRIPE_SECRET_KEY` | `sk_test_…` or `rk_test_…`. A restricted key needs read/write access to Checkout Sessions, Customers, Payment Methods, Subscriptions, Invoices, Events and Test Clocks, plus read access to Account and Prices. |
| Secret | `KOV005_STRIPE_STANDARD_PRICE_ID` | Active test-mode recurring Price for exactly MXN 299.00 monthly. |
| Variable | `KOV005_STRIPE_ESENCIAL_PRICE_ID` | Required for either new plan: distinct active test-mode MXN 399.00 monthly Price, interval count 1, `tax_behavior=inclusive`. |
| Variable | `KOV005_STRIPE_GESTION_PRICE_ID` | Required for either new plan: distinct active test-mode MXN 699.00 monthly Price, interval count 1, `tax_behavior=inclusive`. |
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
4. Download `kov-005-stripe-sandbox-<plan_code>-<sha>` only after the workflow succeeds.
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
Portal configuration IDs are cleared for every run, regardless of inherited settings.

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

## Required evidence

The artifact must contain the tested commit SHA, `livemode=false`, the redacted Sandbox account and
Price, selected `plan_code`, minor-unit amount, exact features, authenticated Kova access result,
provider object status, event creation and arrival timestamps, local subscription state, lifecycle
and payment watermarks, access outcome, duplicate outcome and successful cleanup counts. Stripe identifiers
must remain redacted to their prefix and final six characters.

The gate remains open if the job is skipped, fails, cannot delete every created Test Clock/customer,
uses a commit other than the intended `main` SHA, or lacks the downloaded and reviewed artifact.
