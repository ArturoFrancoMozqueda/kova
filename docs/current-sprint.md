# Current Sprint

Last updated: 2026-10-10

## Active production validation (2026-10-10): operaciones reales en Sweet Home

El propietario autorizó escrituras reales de prueba en su tenant y tres agentes.
Se ejecutaron siete ventas por UI (efectivo, transferencia, tarjeta manual, dividido,
offline, descuento/impuesto y checkout con lotes), siete devoluciones y dos anulaciones.
Los reintentos idempotentes no duplicaron ventas, devoluciones ni recepciones.
El neto final de estas ventas es 0.00; POS vuelve a 30 unidades, lotes a seis sin
reservas. Se conservan los movimientos y registros `QA-20261010`.
Se cerró el turno antiguo y se probaron cortes cuadrado, sobrante y faltante con
importes declarados de prueba; no se certifica conteo físico de efectivo.

Correcciones en `codex/sweet-home-production-validation`: búsqueda fija en tres
triggers de lotes, tabla de devoluciones accesible por teclado, encabezados de panel,
catálogo e inventario, etiquetas de compras/traspasos/pagos y claridad sobre cobros
brutos y eventos de devolución. Se prepara también restauración lógica
de backup R2 en runner aislado; su implementación no acredita una ejecución real.
La publicación debe pasar CI y verificarse en frontend/API/proxy antes de considerarse
lista. Evidencias: [POS y caja](audits/KOVA-PRODUCTION-OPERATIONS-2026-10-10.md),
[negocio](audits/KOVA-PRODUCTION-BUSINESS-2026-10-10.md) y
[acceso](audits/KOVA-PRODUCTION-ACCESS-2026-10-10.md).

El usuario confirmó que Sweet Home no tiene identidad/CSD ni cuenta de Facturapi.
La facturación Live queda sin emisión; Kova requiere una cuenta/llave de plataforma,
y cada emisor debe aportar sus requisitos fiscales. Cargos externos, dispositivos
físicos, Safari/iOS y recuperación regional siguen sin evidencia completa; no se
declara disponibilidad productiva al 100%.

## Active implementation (2026-10-09): Cajón de dinero

El propietario pidió apertura de cajón desde cualquier equipo. Implementación local de un
conector por sucursal, compatible con impresoras ESC/POS de red; Kova puede solicitar aperturas
desde navegador de computadora, Android o iPad. Contrato, limitaciones, seguridad y QA en
[`specs/shifts/cash_drawer.md`](../specs/shifts/cash_drawer.md).

Verificación local: 73 pruebas de backend/RLS, 45 de frontend y 12 de navegador; build, lint,
TypeScript y contrato OpenAPI pasan. Publicación y pruebas físicas pendientes; no se certifica hardware
USB/Bluetooth ni apertura remota offline. No modifica cobros, cortes ni sesiones por cookies.

## Source Of Truth

The dated section at the top is the active execution board. Older sections below are retained as
historical evidence and are labelled with their period.

- Current execution target and release gates live here.
- Historical sprint notes, completed audit findings, and future roadmap live in
  `docs/sprint-planning.md`.
- Audit deliverables and superseded phase plans live in `docs/audits/`.
- Operational runbooks live in `docs/runbooks/`.
- Risks live in `docs/risk-register.md`.
- Do not duplicate detailed acceptance criteria here; link to the owning spec, runbook, or planning
  section instead.
- Setup, test commands, architecture and operational entry points live in
  [`engineering-operations-index.md`](engineering-operations-index.md).

## Active fiscal onboarding (2026-10-09): facturación administrada por Kova

El propietario solicitó que el negocio active facturación dentro de Kova sin configurar
cuentas ni llaves de Facturapi. Implementación en `codex/managed-fiscal-onboarding`: alta
por tenant, CSD efímeros, autorización embebida, Test/Live separados y journal de recuperación.
Contrato en [CFDI](../specs/integrations/cfdi-contract.md) y operación en
[alta fiscal administrada](runbooks/managed-fiscal-onboarding.md). Las conexiones previas
se conservan. La activación externa exige cuenta/llave de plataforma y requisitos fiscales
reales; no declarar emisión validada sólo por compilar o mostrar el formulario.

## Active branch integration (2026-10-08): correcciones de auditoría

El propietario solicitó implementar correctamente las ramas de mejoras y correcciones.
Las 24 ramas `codex/audit-*` se reúnen desde `codex/audit-verified` en
`codex/integrate-audit-fixes`, con revisión de solapamientos y una corrección adicional
para no afirmar activación tras un rechazo de Checkout sin estado confirmado.
Alcance, validación repetida y límites en
[`audits/KOVA-BRANCH-INTEGRATION-2026-10-08.md`](audits/KOVA-BRANCH-INTEGRATION-2026-10-08.md).
Publicado con autorización explícita mediante PR #182: CI y publicación aprobadas.
Frontend, proxy y base de datos verificados con SHA
`f9d875c103b090c9f08a888db7464b3a2321bbd1`.

## Active production audit (2026-10-08): flujo real y equipos

El propietario autorizó evaluación autenticada integral, tres equipos e implementación de los
hallazgos. Correcciones en `codex/production-comprehensive-fixes`; alcance, QA real, pruebas y
límites en [la evidencia de producción](audits/KOVA-PRODUCTION-AUDIT-2026-10-08.md).
No se registraron operaciones financieras ni ajustes de inventario durante la evaluación.
Publicado mediante PR #183: CI y publicación aprobadas; frontend, API, proxy y base de datos
verificados con SHA `fb47b342489c0a32aad34bee0ad53c5538fcc4f2`.

## Active real-flow evaluation V2 (2026-10-08): segunda pasada con equipos

El propietario solicitó otra evaluación con tres agentes navegando la aplicación real y
resolviendo defectos. Trabajo en `codex/real-flow-evaluation-v2`, con entornos separados para
caja/pedidos, operaciones/reportes y acceso/configuración. La QA productiva conserva los datos
del negocio; las escrituras y los casos adversos se verifican en bases locales desechables.
Hallazgos, archivos, regresiones y límites en
[la evaluación V2](audits/KOVA-REAL-FLOW-EVALUATION-V2-2026-10-08.md).
Los cambios de esta segunda pasada deben aprobar CI y publicación antes de marcarse publicados.

## Active product implementation (2026-10-08): Lotes y fechas

El propietario aprobó una función completa, opcional por producto, en una rama nueva.
Implementación en `codex/inventory-lots`, basada en `main` actualizado; comportamiento
acordado, contratos, seguridad, aceptación y publicación en
[`specs/inventory/lots.md`](../specs/inventory/lots.md).

Incluye reglas de fechas confirmadas, entradas/compras, ventas, reservas, traspasos,
mermas, conteos y recuperación offline. Las fechas vencidas solo advierten; los
reembolsos de ventas con lotes no reponen unidades; la anulación solicita confirmar
que no hubo entrega. La autorización actual cubre implementación y verificación
local; no publicación en producción. La evidencia final se registra en la spec.

## Active assistant implementation (2026-10-08): publicación y activación

El operador autoriza despliegue y gasto recurrente (USD 10/mes de inferencia y hasta USD 35/mes
de ingesta, sin compromiso anual). La selección técnica pasa a **Mistral Small 4**, vía
OpenRouter y exclusivamente `mistral/us`, sin razonamiento extendido ni fallback automático.
El diagnóstico completó 540 consultas: cero errores de contrato, mediana 0.947 s, p95 2.837 s,
máximo 5.816 s. No equivale a aprobación de calidad semántica ni activación. GPT-OSS conserva
su evidencia y fallos de capacidad; las conclusiones/cifras de reportes las controla Kova.

Publicado en PR #169: aprobación ligada al hash del motor, presupuesto y pausas compartidos,
recuperación mensual, capacidad independiente de chat/archivos, citas numéricas literales y
aviso OCR, host de ingesta privado en iad y publicación/rollback sin recursos adicionales.
Validación local: 263 pruebas de asistente/RLS, 31 de operaciones, 21 de publicación.

PR #170 pasó CI y se integró como `489d79b`; su publicación está en curso. La preparación
manual del host usa la identidad de CI existente, sin pedir acceso personal adicional a Fly.
Se corrige además el fallo real: «todo mi histórico» consultaba solo hoy. El histórico de
productos se agrega en PostgreSQL, descontando devoluciones y conservando tenant/sucursal;
la regresión incluye una venta de hace cuatrocientos días y otra sucursal excluida.

Pendientes: CI del motor definitivo, evaluación de ese código y revisión de pertinencia/es-MX;
credencial permanente mensual; host de archivos dentro del total
autorizado y QA autenticada R2/embeddings/ACL/carga/plazo. La sesión de Kova está disponible.
No activar el gate de calidad ni presentar archivos como listos antes de cerrar esas pruebas.
No hay tareas agendadas. [Decisión](research/ASSISTANT-DECISION-2026-10-07.md),
[operación](assistant-operations.md).

## Historical assistant status (2026-10-07): solución de consulta

**Selección técnica cerrada:** GPT-OSS-120B por Cerebras/OpenRouter, con reportes redactados
por Kova y pasajes de documentos seleccionados por identificador. Implementación en PR #169;
no está activada en producción. La integración Groq anterior se entregó mediante PR #167,
pero Groq Free no pasó calidad y la ruta Groq pagada por OpenRouter tuvo un HTTP 429.
La comparación de prosa libre mostró fallos financieros incluso con JSON válido; no se delegan
los cálculos ni sus conclusiones al modelo.

Alcance confirmado: guías, preguntas del negocio, recomendaciones y archivos propios,
sin mutaciones ni correo, máximo diez segundos y escalabilidad desde el inicio. La ruta final
exige nuevo consentimiento para OpenRouter y Cerebras, ZDR, topes compartidos de gasto,
control por negocio y concurrencia configurable. El presupuesto mensual de producción es cero.
La clave local y los USD 10 autorizados siguen siendo solo de evaluación.

La arquitectura final cerró 540 consultas al 2026-10-08: 539 contratos válidos, mediana
2.1345 s / p95 4.179 s, un timeout y una abstención innecesaria. Los campos de revisión humana
siguen pendientes; no acredita activación ni tiempo real de cola/red/UI. Conserva los 220 casos
originales y sus oráculos. Los cuarenta de mutación mantienen su gate independiente antes de
habilitar esa capacidad. No hay programación diaria.

Bloqueos de activación: cierre formal de hallazgos/revisión de pertinencia, QA autenticada de cola/red/UI y
carga; clave y techo mensual aprobados; y, para documentos, host de ingesta aislado y QA real
R2/embeddings/ACL. El worker actual de Fly no tiene el daemon Docker requerido por la ingesta.
Se requiere además separar selección de trabajos de chat/ingesta y comprobar capacidad interactiva
durante procesamiento de archivos.
No habilitar archivos ni declarar producción lista sin completar ese recorrido.
Decisión y evidencia: [selección final](research/ASSISTANT-DECISION-2026-10-07.md);
operación: [asistente](assistant-operations.md).

## Active product integration (2026-10-05): Expansión POS

The owner explicitly authorized implementation, agent branches/worktrees, integration and production
publication. This supersedes the previous discovery gates for the capabilities below. Execution plan:
[`PLAN-POS-EXPANSION-2026-10-05.md`](plans/PLAN-POS-EXPANSION-2026-10-05.md); validation/release matrix:
[`PLAN-POS-RELEASE-2026-10-05.md`](plans/PLAN-POS-RELEASE-2026-10-05.md).

- [x] Integrate sale discounts, added tax defaults, immutable line allocations and offline price snapshots.
- [x] Integrate customer records/history, product barcodes, catalog import and register selection/scanning.
- [x] Integrate suppliers, purchase orders, partial receiving and explicit cost updates.
- [x] Integrate atomic inventory transfers and optional staff assignment to one branch.
- [x] Integrate issuer profiles and internal invoice requests that remain pending external provider.
- [x] Extend tenant RLS/grants, account portability/purge graph, API contracts and mobile scenarios.
- [ ] Complete full integrated verification and CI on the final commit.
- [ ] Merge the verified PR and verify production backend/frontend acceptance.

Each domain spec records delivered behavior and tests. Implemented here means integrated into the
release branch, not yet production acceptance. No PAC or terminal service is contracted by the owner;
real CFDI emission/public autofactura and terminal payment processing remain externally blocked.
These changes do not close restore, live Stripe lifecycle or inbox-delivery research gates.

## Active Sprint (2026-09): Comprehensive audit remediation

The active execution target is the 36 findings in
[`audits/KOVA_IMPROVEMENT_BACKLOG.md`](audits/KOVA_IMPROVEMENT_BACKLOG.md). Each local remediation
lands through a focused `feature/` branch with relevant tests. Provider and production-dependent
gates remain open until their runbook contains dated evidence from the real environment.

Local remediation and independent reauditing are complete as of 2026-09-07. The disposition and
validation for every finding are recorded in
[`audits/KOVA_REMEDIATION_STATUS_2026-09-07.md`](audits/KOVA_REMEDIATION_STATUS_2026-09-07.md).
The effective Supabase grants/Data API gate, the disposable Fly/Vercel recovery drill, and the real
Stripe test-mode lifecycle drill are closed. KOV-031 restore evidence remains the only open audit
gate and was expressly excluded from the authorized remediation scope.

The July premium redesign and CRO sections below are retained as historical execution context. Their
dates and checkboxes must not be interpreted as the current release decision.

## Active product improvement (2026-10): Análisis accionable

The owner requested code improvements that make Kova's subscription value concrete through its own
operating data. The first slice extends the existing inventory recommendations; acceptance and
calculation rules live in [`specs/reports/restock_decisions.md`](../specs/reports/restock_decisions.md).

- [x] Build a replenishment plan from current available stock, reservations and trailing seven-day
      inventory consumption, with owner-selected 3/7/14-day coverage.
- [x] Open the exact inventory product without creating a purchase or changing stock on navigation;
      reread inventory on return after an actual receipt entered through the existing form.
- [x] Distinguish unavailable inventory from untracked products, and avoid suggested quantities
      when stock or consumption evidence is insufficient.
- [x] Preserve categorical telemetry and label estimates without claiming confirmed savings,
      lost sales, or subscription ROI.
- [x] Keep the quantity and next step visible, with calculation details available on demand;
      verify keyboard access, 44 px controls and 320/390 px mobile layouts.
- [x] Update the backend lockfile to patched AnyIO 4.14.2, PyJWT 2.15.1 and urllib3 2.8.0
      after the release dependency audit identified vulnerabilities in the previous versions.
      The existing audit, authentication, integration and migration gates must pass before release.

Commercial value and retention still require real business observation. This local product slice
does not close KOV-031, pilot recruitment, production deliverability or live billing gates.

## Active product improvement (2026-10): Sucursales

The owner explicitly requested multi-location operation and answers to which branch sells most
and which products sell in each branch. This authorization supersedes the Phase 4 demand gate.
Contract and acceptance criteria live in
[`specs/branches/multi_location.md`](../specs/branches/multi_location.md).

- [x] Principal-branch historical backfill, tenant RLS and branch-consistent operational FKs.
- [x] Create/rename branches and select the operating branch on mobile and desktop.
- [x] Separate sales, drawers, stock, customer orders, reservations and expenses per branch.
- [x] Compare net sales, tickets and product quantities for the selected reporting period.
- [x] Preserve the original branch of queued offline sales, including legacy principal sales.
- [x] Verify PostgreSQL migrations/grants, backend/frontend suites, production bundle and mobile
      comparison accessibility; dated local evidence is recorded in the branch spec.
- [ ] Apply migration 0068 and deploy the backend before the new frontend in production.

Catalog, prices, employee roles, subscription and fiscal periods remain business-wide. There is no
new per-location pricing. Natural-language chat, branch-restricted staff and inventory transfers
remain outside this slice. Local checks do not establish commercial traction or close existing
production gates. Once additional branches exist, schema downgrade is intentionally blocked;
retain migration 0068 when rolling back the application.

## Active implementation (2026-10): Asistente por tenant

The owner requested the complete assistant design: guided configuration with explicit confirmation,
catalog imports, private-document RAG, authorized analytics, memory, goals and proactive in-app/opt-in
email follow-up. Architecture, quota estimates, security boundaries and 72 acceptance scenarios live
in [`plans/PLAN-ASISTENTE-TENANT.md`](plans/PLAN-ASISTENTE-TENANT.md), linked from the
[product roadmap](plans/PLAN-KOVA-COPILOT.md).

- [x] Consolidate the complete scope and implementation plan against existing code/contracts.
- [ ] Validate the real provider account, quality, consumption and data-processing conditions.
- [x] Implement the pilot UI/API/worker, confirmation, tenant/private RLS, idempotency, shared budgets,
      document lifecycle, memory/goals and deterministic follow-up on `codex/tenant-assistant`.
      A floating Kova logo companion opens a private chat without leaving the current page;
      checkout, onboarding tours and confirmation dialogs retain visual priority.
- [ ] Close external provider/parser/ingestion/restore gates before enabling a real pilot.
- [ ] Complete full-flow QA, observed pilot capacity and applicable production gates.

The owner authorized implementation on a new branch from main on 2026-10-06. Code and local
verification are tracked in [assistant-operations.md](assistant-operations.md) and the plan. Flags
remain disabled by default. This does not change pricing, authorize paid inference/deployment or
close operational gates. The branch-management slice above remains independently completed.

## Historical Sprint (2026-07): Premium redesign app-wide + remaining hardening

The active backlog was `PLAN-DESIGN.md` (repo root): extend the `feature/reports-redesign` design
system to every tab so the product feels premium end-to-end, and consolidate everything left over
(PLAN-05 backend, PLAN-UX-04/05, B5 resume, quick wins, operational gates).

Merged into `main` as of 2026-07-10 (closed, do not re-open here):

- [x] PLAN-01 (billing lifecycle correctness), PLAN-02 (tenant-isolation RLS — provisioned in prod,
      `kova_app` runtime verified on Fly), PLAN-03 (offline-sync integrity), PLAN-04 (cash & inventory
      correctness).
- [x] PLAN-UX-01 (modal a11y & destructive-action safety), PLAN-UX-02 (one-tap receipt + corte de
      caja printout), PLAN-UX-03 (anonymous funnel instrumentation & landing accuracy).
- [x] Épica 0 of `PLAN-DESIGN.md`: merged `feature/reports-redesign` (design system source) with the
      T0.1–T0.6 correctness fixes (payment keys, `net_amount`, unified thresholds, Docker proxy).

Open (tracked in `PLAN-DESIGN.md`): Épicas 1–4 (shared kit + per-tab redesign + state completeness +
backend hardening PLAN-05/B5) and Épica 6 (operational gates below). PLAN-UX-04/05 detail specs live
in `docs/audits/`.

## Audit remediation execution

The approved execution backlog is
[`docs/plans/PLAN-AUDIT-REMEDIATION-2026-08-13.md`](plans/PLAN-AUDIT-REMEDIATION-2026-08-13.md).
Execute one epic per feature branch, merge only after its required checks and evidence are complete,
and keep provider/production-dependent items open until their external gate is reproducible.

## Historical CRO execution (2026-07)

The active conversion backlog is [`docs/plans/PLAN-CRO-FUNNEL.md`](plans/PLAN-CRO-FUNNEL.md).
Execute one epic per PR, merge only after required checks are green, then continue in order.

The 2026-08-09 production diagnosis supersedes the contaminated CRO baseline for growth decisions.
Requirement-by-requirement execution and proof now live in
[`docs/plans/PLAN-GROWTH-EXECUTION.md`](plans/PLAN-GROWTH-EXECUTION.md); do not treat the scheduled
2026-08-20 analysis as trustworthy unless its window excludes all rows quarantined by migration
`0055`.

- [x] Epic CRO-0 — measurement context, diagnostic events, protected 30-day export and baseline.
- [x] Epic CRO-1 — mobile home and showcase.
- [x] Epic CRO-2 — clear, recoverable signup: backend-aligned password rules, field-specific 422
  recovery with accessible focus, adjacent trial trust copy, and PII-free validation telemetry;
  evidence in [`docs/audits/CRO-2-SIGNUP-2026-07-20.md`](audits/CRO-2-SIGNUP-2026-07-20.md).
- [x] Epic CRO-3 — POS cart without premature anxiety: neutral untouched-cash guidance,
  interaction-gated validation and telemetry, preserved financial guards, and mobile coverage at
  320×844 and 390×844; evidence in
  [`docs/audits/CRO-3-POS-CASH-2026-07-20.md`](audits/CRO-3-POS-CASH-2026-07-20.md).
- [ ] Epic CRO-4 — trustworthy billing and checkout: CRO-4.1–4.5 completed. The provider and
  lifecycle portion of CRO-4.6 passed in a disposable Stripe test-mode drill; return/cancel UX and
  live checkout remain release gates. Evidence in
  [`docs/audits/CRO-4-BILLING-2026-07-20.md`](audits/CRO-4-BILLING-2026-07-20.md).
- [ ] Epic CRO-5 — rollout and learning loop: small-batch rollout and experiment isolation are
  complete; the 3.81-hour preliminary checkpoint was inconclusive as required, and reproducible
  7/30-day analysis remains scheduled for 2026-07-28 and 2026-08-20. Evidence in
  [`docs/audits/CRO-5-ROLLOUT-2026-07-21.md`](audits/CRO-5-ROLLOUT-2026-07-21.md).

## Kova como copiloto — Phase 0 foundation

The 12-month product strategy starts with validation rather than feature parity. The first shipped
slice measures whether real analysis produces a useful owner action; contract and privacy rules live
in [`specs/reports/analysis_activation.md`](../specs/reports/analysis_activation.md).

- [x] Keep **Análisis** as the authenticated surface without changing `/reports` or report API
      contracts.
- [x] Track tenant-scoped analysis views, evidence opens, action starts, completions and reopens with
      categorical metadata only.
- [x] Add the missing successful `close_shift` activation event.
- [x] Validate analysis payload categories server-side and reject financial or unsupported metadata.
- [x] Expose a protected, identity-free 7/30-day adoption report for weekly pilot review.
- [x] Measure explicit recommendation usefulness, prior-window return, active-business adoption and
      the observable sale → close → analysis journey.
- [ ] Recruit and observe the planned multi-vertical pilot cohort; this is commercial research, not
      a code-complete gate.
- [ ] Close the existing live Stripe, inbox-delivery and backup-restore production gates before broad
      rollout.

## Current Focus: Paid Beta Readiness

Kova Audit Sprints 1-6 are product-complete enough for controlled paid beta preparation. The
remaining blocker is not core POS feature work; it is production trust and commercial operations.

Goal: safely charge the first controlled beta tenants without breaking trust in checkout,
subscription state, data recovery, monitoring, or support.

Readiness snapshot:

| Area | Status |
|---|---|
| Core POS flow | Mostly ready for controlled beta. |
| Tenant isolation | Strong foundation; keep tests as a release gate. |
| Offline behavior | Foundation present; production offline drill remains a recurring gate. |
| Billing | Implemented, but live Stripe flow is still commercially gated. |
| Deployment | Vercel/Fly custom domains configured; rewrites now match backend paths. |
| Backups | R2 backup works; restore drill still open. |
| Monitoring | UptimeRobot covers frontend, API, and API + DB. |
| Support/legal | Beta agreement exists; `/seguridad` shipped; official beta support email confirmed. |

## Done

- [x] Standard Plan aligned to $299 MXN/month across product copy, billing defaults, docs, specs,
      tests, and migration.
- [x] Public/auth trust pass landed: narrowed landing claims, privacy/terms pages, signup trust
      cues, and reduced stale PWA prompts on public/auth routes.
- [x] Tenant onboarding path improved for cafe/small food retail: cafe preset, Spanish-first setup
      checklist, direct catalog/inventory actions, and first-value milestone state.
- [x] Core POS usability pass landed: cart-first payment controls, hidden advanced split payment,
      mobile navigation regression coverage, catalog/inventory/order sorting and search.
- [x] Reports storytelling pass landed: compact owner decision brief, deduped actions, restock
      prioritization, local date handling, product trends, restock alerts, and employee contribution.
- [x] Sprint 5 QA blockers substantially closed: stock guard, refund/receipt copy, real 404 and
      Spanish route aliases, session refresh, product validation, billing request dedupe,
      localization, CSP, offline QA checklist, and first-paint polish.
- [x] Sprint 6 Trust Lock product work closed: timezone-safe defaults, localized shifts, production
      data hygiene scripts, sold-out inventory badge, receipt reprint, cash refunds in shift
      reconciliation, trial value recap, dynamic comparison labels, action dedupe, and register
      hotkeys.
- [x] Custom domains validated:
      `https://kovasuite.com` on Vercel and `https://api.kovasuite.com` on Fly.
- [x] Vercel rewrites aligned to backend reality:
      `/api/health -> https://api.kovasuite.com/health`,
      `/api/health/db -> https://api.kovasuite.com/health/db`, and
      `/api/v1/:path* -> https://api.kovasuite.com/api/v1/:path*`.
- [x] GitHub Actions Supabase backup to Cloudflare R2 fixed after PostgreSQL version mismatch:
      workflow now installs PostgreSQL 17 client, puts `/usr/lib/postgresql/17/bin` on `PATH`,
      validates backup secrets/config, dumps with `pg_dump` 17, uploads to R2, verifies the object,
      and prunes after 7 days.
- [x] Uptime monitoring moved to UptimeRobot for frontend, API health, and API + DB health.
- [x] Beta agreement template exists at `docs/beta-agreement-template.md`.
- [x] Beta support email decision confirmed:
      `posprojectsupport@gmail.com` is the official support channel for controlled paid beta.
      A branded mailbox may be revisited after beta signal, but it is not a blocker for charging
      founder-assisted beta tenants.
- [x] CSRF protection hardened (2026-05-25):
      threat model in `docs/security/cookie-csrf-threat-model.md`, double-submit middleware
      in `backend/app/middleware/csrf.py`, frontend wired via `frontend/src/lib/csrf.ts`,
      negative tests in `backend/app/tests/test_csrf.py` and `frontend/src/lib/csrf.test.ts`,
      Stripe webhooks and `X-Internal-Key` paths verified as exempt.
- [x] Rate limiting moved to a pluggable backend (Upstash Redis sliding window in prod,
      in-memory fallback in dev); coverage extended to sync, uploads, and checkout;
      docs at `docs/security/rate-limiting.md`.
- [x] Senior code audit follow-ups landed (2026-05-26):
      - Centralized MXN money formatting: `formatMoney` now accepts `string | number`
        and a new `formatMoneyDelta` handles signed deltas. Removed the ad-hoc
        `formatMXN` in `routes/Home.tsx`, the `${n.toFixed(2)}` patterns in
        `shifts/CloseShiftModal.tsx` and `shifts/ShiftView.tsx`, the `+MX$` deltas
        in `catalog/CatalogView.tsx`, `register/ModifierSelectionModal.tsx`, and
        `orders/OrderDetail.tsx`, and the redundant `.toFixed(2)` wrapping in
        `dashboard/DashboardView.tsx`. `billing/BillingView.formatPlanAmount` is
        left as-is because it is multi-currency (commit `8353aad`).
      - i18n sweep: new `documentTitles` and `notFound` namespaces plus
        `register.online`; migrated the 13 `useDocumentTitle("...")` callsites,
        `routes/NotFound.tsx`, and `offline/OfflineIndicator.tsx` (commit `a765563`).
      - Landing page i18n: the stale `landing` namespace in `i18n/messages.ts` is
        replaced with one that mirrors the current `routes/Home.tsx` sections (nav,
        hero, threeNodes, posShowcase, desktopPreview, tabletPreview, features,
        firstDay, builtFor, faq, pricing, footer). All hardcoded Spanish copy in
        Home.tsx now reads from `copy.landing` (commit `570eace`).
      - Backend domain layout: `reports/` and `business_settings/` now follow the
        `{models, repository, service, router, schemas}` convention. Pure SQL
        queries moved to new `repository.py` modules; `service.py` keeps
        aggregation, timezone handling, and storytelling. No behavior change
        (commit `03b3405`).
      - Trial-reminder window fix (2026-05-26):
        `app/email/trial_reminders.send_due_trial_reminders` used the window
        `[now + (LEAD-1)d, now + LEAD d]` = `[now+2d, now+3d]`, which excluded
        trials ending around 3.5d. The window is now `[now+LEAD, now+(LEAD+1)d]`
        = `[now+3d, now+4d]`, matching the "send ~3 days before expiry" intent
        and the test fixtures in `app/tests/test_trial_reminders.py`.
      - Stripe live-mode go-live fixes (2026-05-26):
        Initial live `POST /api/v1/billing/checkout` failed with Stripe
        `url_invalid` because the deployed `STRIPE_CHECKOUT_SUCCESS_URL` /
        `STRIPE_CHECKOUT_CANCEL_URL` secrets were missing the actual frontend
        paths — fix was to set them to
        `https://kovasuite.com/settings/billing/success` and
        `.../cancel`, which match the `/settings/billing/:returnState` route
        in `App.tsx` that `BillingView` reads from `location.pathname` to
        trigger the success/cancel toasts.
      - Stripe API 2026-04-22.dahlia period field fallback (2026-05-26):
        The new Stripe API moved `current_period_start` / `current_period_end`
        off the subscription root and onto each subscription item. The
        webhook handler in `app/billing/service.py` was reading them from the
        root only, so after a successful checkout `/settings/billing` showed
        "Fin del periodo actual: No disponible". Added `_extract_period()`
        helper that falls back to `items.data[0].current_period_*` when the
        root fields are absent; applied in both
        `_upsert_subscription_from_stripe_object` and `cancel_subscription`.
        Regression test in
        `app/tests/test_billing_api.test_subscription_webhook_reads_period_from_items_when_root_missing`.
      - TrialChip stale day counter fix (2026-05-26):
        `frontend/src/billing/TrialChip.tsx` only fetched the billing status
        once on `authenticated` flip and never re-rendered, so the
        "X días restantes" header chip was frozen across an open tab — only
        a re-login refreshed it. Now ticks every 60s (recomputes
        `daysUntil(trial_ends_at)`) and refetches on `visibilitychange` /
        `focus` to catch trial → active transitions that happened in the
        background.
      - Mega-view splits (ReportsView, CatalogView, RegisterView, >1200 lines
        each) deliberately deferred — they touch business-critical logic and
        violate CLAUDE.md's "do not change component APIs" rule without a
        per-component plan and e2e coverage. To be picked up in a dedicated
        session.

## Active Release Gates

These block broad selling and should be closed before live Stripe or more than founder-assisted
controlled tenants.

- [ ] Stripe live checkout full-flow verified:
      checkout, webhook, active subscription, retry/past_due, grace period, cancel, and resume
      behavior if supported. The equivalent test-mode lifecycle passed in GitHub Actions run
      `34179307328`; this checkbox specifically requires live-mode evidence.
- [ ] Post-checkout, welcome, and trial-ending emails verified against real inbox providers
      (Gmail, Outlook/Hotmail at minimum).
- [ ] Restore drill completed from a real R2 backup into a fresh Supabase project and documented in
      `docs/runbooks/restore-supabase-backup.md`.
- [ ] Beta agreement signed by first paid tenants.
- [x] Domain/support path confirmed:
      `posprojectsupport@gmail.com` is the official support address for controlled paid beta;
      moving to a branded mailbox is deferred until after beta signal.
- [x] `/seguridad` page shipped at `frontend/src/routes/LegalPage.tsx` (security variant);
      covers tenant isolation (app + RLS), HttpOnly cookies + CSRF, backups, uptime monitoring,
      payment separation, beta expectations, and support; linked from the home footer, the legal
      pages, and the signup trust block; excluded from the SW navigation fallback so deploys
      never serve a stale copy.
- [x] Production smoke on custom domain completed after the Vercel rewrite deploy (2026-05-28):
      login, signup, session refresh, billing subscription fetch, catalog load, register sale,
      reports, settings, `/api/health`, and `/api/health/db` all verified on `kovasuite.com`.
- [x] Signup "email already registered" recovery path (regression from 2026-05-28 production
      incident: real prospect hit `POST /api/v1/auth/signup` → 400 twice and only saw the generic
      "No se pudo completar la operación", so she abandoned signup). Shipped 2026-05-28:
      - [x] Backend: `signup` in `backend/app/auth/service.py` now returns a `SignupOutcome` with
            three branches — `account_created`, `verification_resent`, `email_in_use`. Verified
            existing users get `email_in_use` (no token, no tenant_id leaked). Unverified
            existing users have prior `email_verification` tokens invalidated via
            `repo.invalidate_pending_tokens` and a fresh token reissued + resent. Rate limiting
            stays on the existing `auth-signup` bucket; response body shape is identical across
            branches except for `reason` and (for `account_created`) `user_id`/`tenant_id`.
            Audit events `user.signup_blocked_existing` and `user.signup_verification_resent`
            cover the recovery paths. Endpoint returns 201 only for `account_created`, 200 for
            the recovery branches.
      - [x] Frontend: `frontend/src/auth/AuthView.tsx` branches on `response.reason`. New states
            `email_in_use` (muted info panel + "Iniciar sesión" primary CTA that prefills the
            login form via `/login?email=…` + secondary "¿Olvidaste tu contraseña?") and
            `verification_resent` (green success panel: "Ya tenías una cuenta sin verificar. Te
            reenviamos el correo a {email}…"). Copy in `frontend/src/i18n/messages.ts`
            (`signupEmailInUse*`, `signupVerificationResent*`).
      - [x] Audited the rest of the auth surface for blind `operationError` fallbacks.
            `VerifyEmailView` now distinguishes a 400 (expired/invalid token → dedicated panel
            with "Volver a registrarme" CTA) from other errors. `ResetPasswordView` already
            mapped 400/422 to `resetTokenInvalid`. `ForgotPasswordView` intentionally stays
            generic to avoid email enumeration. Login still maps 401/403 to invalid creds and
            429 to rate limit.
      - [x] Tests: backend `test_signup_existing_verified_user_returns_email_in_use` and
            `test_signup_existing_unverified_user_resends_verification` in
            `backend/app/tests/test_auth.py` cover both branches and assert that the previous
            verification token is invalidated. Frontend `frontend/src/auth/AuthView.test.tsx`
            covers the `email_in_use` panel, the `verification_resent` confirmation, and the
            `/login?email=…` prefill. Manual Gmail QA pending before the next live deploy —
            same gate as the rest of the email-deliverability checklist.

## Sellability Audit Follow-Ups

These are detailed follow-ups from the 2026-05-25 sellability review. They should either be closed
before broad self-serve selling or explicitly accepted as controlled-beta risks by the founder.

- [x] Rate limiting hardened with pluggable backend (2026-05-25):
      `backend/app/middleware/rate_limit.py` now selects an Upstash Redis sliding-window backend
      when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set, falling back to in-memory
      otherwise. Coverage extended from auth-only to also include `sync/offline-sales`,
      `billing/checkout`, and image/logo uploads. Frontend handles 429 (auth message in `AuthView`,
      offline sync re-queues to pending). Threat model and operator checklist in
      `docs/security/rate-limiting.md`. Tests in `backend/app/tests/test_rate_limit.py`.
- [x] Fix onboarding billing completion logic:
      `GET /api/v1/onboarding/state` now marks the billing step complete when
      `get_billing_access_status` returns `active`, `trialing`, or `past_due_grace` (the prior
      check used reason strings — `active_subscription`, `subscription_trial` — that the access
      helper never emits, so the step never completed even for paying tenants). Signup-trial and
      expired-trial states keep prompting the user to activate the plan. Regression coverage in
      `backend/app/tests/test_onboarding_billing.py` exercises active subscription, trialing
      subscription, past_due within grace, signup trial, and expired trial.
- [ ] Make email delivery a production gate:
      Partial progress:
      - [x] Startup gate: `_validate_config` in `app/main.py` now fails to boot when
            `APP_ENV=production` and `RESEND_API_KEY` is missing, or when `EMAIL_FROM` is left at the
            default `onboarding@resend.dev` sandbox sender. Lifecycle emails can no longer be
            silently skipped in prod. Covered by `app/tests/test_email_gate.py`.
      - [x] Welcome / post-checkout email: `send_welcome_email` added in `app/email/service.py`
            (Spanish copy, links to dashboard and `/settings/billing`). Wired into the Stripe
            `checkout.session.completed` webhook handler in `app/billing/service.py`; resolves the
            tenant owner via `Membership.role = 'owner'`. Idempotent because the webhook handler
            already short-circuits on duplicate event IDs. Covered by
            `app/tests/test_welcome_email.py`.
      - [x] Billing receipt / billing confirmation email on `invoice.payment_succeeded`:
            `send_payment_receipt_email` in `app/email/service.py` (Spanish copy with amount,
            folio, periodo y link al recibo alojado en Stripe). Wired into the Stripe webhook
            handler in `app/billing/service.py`; resolves the tenant owner via
            `Membership.role = 'owner'`. Idempotent because the webhook handler already
            short-circuits on duplicate event IDs. Covered by
            `app/tests/test_payment_receipt_email.py`.
      - [x] Trial-ending reminder ~3 days before expiry:
            `send_trial_ending_email` in `app/email/service.py` + batch job in
            `app/email/trial_reminders.py`. Cron-friendly script at
            `scripts/send_trial_reminders.py`. Covers both signup-trial (derived from
            `tenant.created_at + billing_trial_days`) and Stripe `trialing` subscriptions.
            Idempotent via new `tenants.trial_reminder_sent_at` column (migration
            `0025_trial_reminder_sent_at.py`). Covered by `app/tests/test_trial_reminders.py`.
            Cron still needs to be wired in the deploy platform — see
            `docs/email-deliverability.md`.
      - [ ] Manual deliverability QA: Gmail + Outlook/Hotmail inboxing, spam placement,
            SPF/DKIM/DMARC for the Kova sending domain, link rendering, sender identity, Spanish
            copy review across all five lifecycle emails. Checklist in
            `docs/email-deliverability.md`.
- [x] Remediate frontend performance warning (2026-05-25):
      route-level lazy loading now splits public/auth/app screens and heavy authenticated surfaces;
      Vite manual chunks separate React, Dexie/offline, UI helpers, icons, and remaining vendor code.
      Production build no longer emits the large-main-chunk warning: the entry chunk is 72.75 kB
      minified / 24.73 kB gzip, with `vendor-react` at 180.74 kB / 54.80 kB gzip and
      `vendor-offline` at 96.37 kB / 32.46 kB gzip. Mobile 4G and returning-PWA behavior should be
      confirmed during the custom-domain production smoke gate.
- [x] Resolve frontend npm audit moderate vulnerabilities (2026-05-25):
      upgraded dev tooling to `vite@^6.4.2` and `vitest@^3.2.4`, then applied `npm audit fix` for
      `ws`; `npm audit --audit-level=moderate` now reports zero vulnerabilities.
- [ ] Improve backend test ergonomics for release gates:
      make the documented Windows backend test command easy to run with a reachable Postgres;
      document the fastest local path to start Postgres, apply migrations, and run `uv run pytest`;
      ensure CI remains the release source of truth and that the exact release commit has green
      backend tests before live Stripe is enabled.

## Known Follow-Ups

These are not blockers for controlled paid beta unless a real tenant hits them.

- [ ] Clean up the stray Vercel `frontend` project after confirming it is unused.
- [ ] Decide whether employee management should graduate from Settings to first-class navigation
      after beta usage data.
- [ ] Add invitation acceptance-path E2E once that flow is finalized.
- [ ] Decide whether the cafe preset needs modifier groups for milk/size, or keep modifiers as a
      later usability pass.

## Verification Baseline

Recent documented verification:

- Frontend performance/security follow-up passed on 2026-05-25:
  `npm run typecheck`, `npm run lint`, `npm test -- --run` (26 tests), `npm run build`, and
  `npm audit --audit-level=moderate`. Build entry chunk is now 72.75 kB minified / 24.73 kB gzip
  and no Vite large-chunk warning is emitted.
- Frontend typecheck, lint, production build, and diff hygiene passed during Sprint 6.
- Focused unit/E2E coverage exists for date handling, shifts, inventory sold-out state, receipt
  reprint, register hotkeys, routing, out-of-stock sale paths, refunds, and order detail.
- Backend CI passed after Sprint 6 refund cash-movement merge, covering the refund BDD path with
  Postgres.
- Backup workflow now produces a successful Supabase `pg_dump` 17 to Cloudflare R2 per operator
  confirmation on 2026-05-25.

Before moving beyond controlled beta, rerun:

```powershell
cd frontend
npm run typecheck
npm run lint
npm run build
npm test -- --run
npm run test:e2e -- --project=chromium
```

Backend full test gate requires a reachable Postgres:

```powershell
cd backend
$env:UV_PROJECT_ENVIRONMENT=".venv-win"
uv run pytest
```
