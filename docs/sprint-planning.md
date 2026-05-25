# Sprint Planning: Customizable Multi-Tenant POS Platform

## Status

**Current:** Sprints 9-16 complete. Kova audit Sprints 1-6 are product-complete enough for
controlled paid beta preparation. The active execution target is no longer a product sprint; it is
the paid-beta readiness gate in `docs/current-sprint.md`: live Stripe verification, email
deliverability, restore drill, support/domain trust, `/seguridad`, and final production smoke on the
custom domain.

**Last updated:** 2026-05-25

This document defines the roadmap, historical sprint record, and future backlog.

Permanent rules live in `CLAUDE.md`.

Active scope lives in `docs/current-sprint.md`.

Deferred scope lives in `docs/deferred-scope.md`.

Risks live in `docs/risk-register.md`.

## Unified Planning Map

Use these documents as the planning source of truth:

| Document | Purpose |
|---|---|
| `docs/current-sprint.md` | Active execution board and release gates only. |
| `docs/sprint-planning.md` | Historical sprint record, completed audit findings, and future roadmap. |
| `docs/deferred-scope.md` | Explicitly deferred scope. |
| `docs/risk-register.md` | Product, technical, commercial, and operational risks. |
| `docs/runbooks/` | Production operating procedures. |

Kova Audit Sprint 6 product work is closed. Sprint 7 work should not start until the active
commercial/ops gates in `docs/current-sprint.md` are either closed or explicitly accepted as
controlled-beta risks.

## Commercial Readiness Plan (2026-05-23)

Source: `docs/ux-qa-review-2026-05-23.md`, based on code review plus live navigation of
`https://point-of-sale-ochre.vercel.app/`.

### Verdict

Kova is close to paid beta, but not yet ready for broad self-serve selling. Current readiness is
estimated at **7.6/10**, with a realistic path to **8.5/10 after Sprint 6**. The target is not to
add broad POS scope; it is to remove the bugs and operational gaps a cafe owner will discover in
the first 1-7 days of real usage.

### Four-Week Path To Sellable

| Week | Focus | Outcome |
|---|---|---|
| Week 1 | Kova Audit Sprint 6 + Stripe/domain/security-page kickoff | Product stops breaking trust during first real usage. |
| Week 2 | Kova Audit Sprint 7 + first white-glove paid onboarding | Conversion and support surfaces feel like a real SaaS business. |
| Week 3 | Stripe live with 5-10 real tenants | Monitor checkout, trial, support, refunds, shifts, and reports daily. |
| Week 4 | Iterate from tenant signal | Open broader acquisition only if signup -> trial -> paid is working. |

### Sprint 6 - Trust Lock + Day-1 Operations

Goal: before charging the first live $299 MXN subscription, a new tenant can sell from morning to
closing without seeing a trust-breaking timezone, localization, receipt, refund, or data-hygiene
failure.

Required specs before implementation: update or create specs for reports date behavior,
shifts localization, receipt reprint/preview, refund cash movement behavior, and trial value recap.
BDD is required for P0/P1 user-facing behavior.

| ID | Priority | Work | Scope / Acceptance Notes |
|---|---|---|---|
| KOV-S6-01 | P0 | Timezone-safe date defaults | Centralize `todayInTimezone`, `yesterdayInTimezone`, and `daysAgoInTimezone`; use them in Reports, ProductStoryCard, and order/report date defaults. Add regression coverage for CDMX after 18:00. |
| KOV-S6-02 | P0 | Localize Shifts | Map backend enum codes to es-MX labels in the frontend: `Open` -> `Abierto`, `OPENING_BALANCE` -> `Apertura de caja`, `balanced` -> `Caja cuadrada`; use centralized date/time formatting. |
| KOV-S6-03 | P0 | Production data hygiene | Run `clamp_negative_stock.py`, `fix_category_accents.py`, and `backfill_skus.py` against production; document operator, date, dry-run/result counts, and rollback notes. |
| KOV-S6-04 | P1 | Inventory sold-out badge | Render `Agotado` with destructive styling when tracked stock is `<= 0`; keep low-stock warning only for `0 < stock <= threshold`. |
| KOV-S6-05 | P0 | Reprint receipt + shared receipt component | Add an `Imprimir ticket` action on order detail. Reuse one receipt component between order detail print and receipt settings preview. Include print-only CSS and tests. |
| KOV-S6-06 | P1 | Refunds affect active shift cash | Refund flow asks how money was returned. Cash refunds create a negative `cash_movement` linked to the active shift and order; shift close reflects it. |
| KOV-S6-07 | P0 | TrialValueRecap | Dashboard shows concrete trial value while trialing: sales count, amount collected, catalog count, active employees, closed shifts, best day. This supports day-13 conversion. |
| KOV-S6-08 | P1 | Dynamic comparison labels | `InsightStrip` and `BusinessHealthCard` use the selected dashboard period and `previousPeriod` labels instead of hard-coded "yesterday" language. |
| KOV-S6-09 | P2 | Recommended-action dedupe | Deduplicate business-story recommended actions by `(action_type, target_id)` before the cap is applied. |
| KOV-S6-10 | P1 | Register keyboard shortcuts | Add basic hotkeys for cashier speed: focus search/SKU, submit charge, close success, and clear transient UI. |

Sprint 6 exit gate:

- No open P0s from the 2026-05-23 review.
- Reports "Hoy" and ProductStoryCard use tenant-local dates in CDMX regression tests.
- Shifts has no raw backend enum labels or US date strings in visible UI.
- Cash refund during an open shift changes the shift reconciliation story.
- Receipt can be reprinted from a real order.
- Trial tenants see a value recap with real tenant data.
- Production hygiene scripts have been run and documented.

### Sprint 7 - Conversion + Operational Pro

Goal: make Kova feel worth paying for, not merely functional, once the first operational blockers
are closed.

| ID | Priority | Work | Scope / Acceptance Notes |
|---|---|---|---|
| KOV-S7-01 | P1 | Manual line discount | Add line discount amount/percent plus reason, permission-gated for owner/manager by default; update receipts, reports, audit logs, and money tests. |
| KOV-S7-02 | P1 | Richer InsightStrip | Add actionable insights for zombie products, quiet hours, and employee standout where enough data exists. |
| KOV-S7-03 | P1 | Receipt live preview | Receipt settings shows a live preview using the same component as order reprint. |
| KOV-S7-04 | P2 | Reports CSV export | Export selected range with order id, timestamp, items, payment methods, refunds, discounts, gross, and net totals. |
| KOV-S7-05 | P2 | In-app Help drawer | AppShell exposes Help with WhatsApp, support email, status link, tenant/user context, and expected SLA. |
| KOV-S7-06 | P2 | Duplicate product | Catalog can duplicate a product without copying SKU. |
| KOV-S7-07 | P2 | Mobile dashboard density | KPI cards use a 2x2 mobile grid and preserve readable spacing. |
| KOV-S7-08 | P2 | Register mobile keyboard handling | `cashTendered` focus keeps the submit action reachable when the mobile keyboard is open. |
| KOV-S7-09 | P2 | Business health action cleanup | Remove, disable, or clarify dashboard actions that route to dead-end flows. |

### Parallel Pre-GA / Sellable Ops Gates

These are not all product-code tasks, but they block calling the product "ready to sell" beyond a
controlled paid beta.

- Stripe live keys configured and verified with a full real-card flow: checkout, webhook,
  active subscription, retry/past-due, grace period, cancel, and resume if supported.
- Email post-checkout and welcome flow tested against Gmail, Outlook, and Hotmail.
- Trial-ending reminder email sent 3 days before trial end.
- Restore drill completed from a real production backup into staging; result documented.
- Public status page or hosted monitor exists for frontend, API, database, and Stripe dependency.
- Beta agreement is signed by the first paid tenants.
- Data retention and export/offboarding policy is documented for cancellation.
- Domain and support trust improved: move from `posprojectsupport@gmail.com` toward
  `soporte@kova.mx` after domain purchase.
- `/seguridad` page explains tenant isolation, HttpOnly cookies, backups, uptime monitoring, and
  support expectations.

### Sellability Audit Follow-Ups (2026-05-25)

Source: deep local readiness review against `AGENTS.md`, `docs/current-sprint.md`, the backend and
frontend code, specs, CI, runbooks, and local verification.

Verdict: Kova is close to controlled paid beta, but not broad self-serve selling. The product can
move toward founder-assisted paid tenants once the active ops gates are closed. The items below
capture the additional sellability gaps that must not be lost in future sprint planning.

| ID | Priority | Area | Work | Acceptance Notes |
|---|---|---|---|---|
| SELL-01 | P0 | Stripe live | Verify live billing full flow | Configure live Stripe keys and live Standard Plan price at $299 MXN/month; complete real-card checkout; receive verified webhook; persist active subscription; verify access unlock; verify idempotent duplicate webhook; verify invoice payment failed -> `past_due`; verify grace period access; verify grace expiry blocks POS writes; verify cancel at period end; verify resume/reactivation if supported; document evidence and operator/date. |
| SELL-02 | P0 | Email | Make lifecycle email production-ready | Production must not silently skip required emails when provider config is missing. Implement or verify email verification, password reset, welcome/post-checkout, billing confirmation or receipt, and trial-ending reminder three days before trial end. Test Gmail and Outlook/Hotmail real inboxes for delivery, spam placement, sender identity, links, Spanish copy, and correct tenant context. Add logs/alerts for provider failures without leaking PII. |
| SELL-03 | P0 | Backups | Complete restore drill | Restore a real R2 backup into a fresh Supabase project using `docs/runbooks/restore-supabase-backup.md`; validate tenant/order counts, latest order timestamp, `/health/db`, and representative API reads; record operator, date, backup filename, workflow link, outcome, and cleanup decision in the runbook drill log. |
| SELL-04 | P0 | Production smoke | Run custom-domain smoke after rewrite deploy | On `https://kovasuite.com` and `https://api.kovasuite.com`, verify login, signup, email verification path, session refresh, billing subscription fetch, checkout start, catalog load/create, inventory load, open shift, register sale, receipt/order detail, reports, settings, `/api/health`, and `/api/health/db`; document browser, account, date, commit/deployment, and any production-only issue. |
| SELL-05 | P1 | Trust/security page | Ship `/seguridad` | Add a public `/seguridad` route linked from the footer/signup trust surfaces. Page must explain tenant isolation, app-layer scoping, PostgreSQL RLS, HttpOnly/Secure/SameSite cookies, backups and restore drills, uptime monitoring, support expectations, payment separation (Stripe Billing vs POS payments), and what beta tenants should expect. Keep copy honest and Spanish-first. |
| SELL-06 | P1 | Support | Confirm support/domain path | Decide whether controlled beta uses `posprojectsupport@gmail.com` temporarily or a branded mailbox. If temporary, document the cutoff for moving to branded support. Define SLA expectations, escalation owner, support intake fields (tenant, user, request_id, screenshot, severity), and where support is linked in the authenticated app. |
| SELL-07 | P1 | Auth security | Harden CSRF for cookie auth | Document the current cookie-auth CSRF threat model. Add or verify CSRF protection for state-changing cookie-auth endpoints: refresh/logout, catalog writes, order creation, refunds, voids, shifts, inventory, billing checkout/cancel, settings, employees, uploads, telemetry if needed, and offline sync. Add automated negative tests for missing/invalid CSRF. Keep Stripe webhooks and internal-key endpoints exempt only with documented rationale. |
| SELL-08 | P1 | Rate limiting | Make rate limits production-safe | The current limiter is in-memory and single-instance. Before broad selling, add provider/WAF limits or shared backing storage for login, signup, password reset, sync, uploads, billing checkout, and webhook abuse cases. Document thresholds, 429 UX copy, bypass rules for webhooks/internal jobs, observability, and alerting. |
| SELL-09 | P1 | Onboarding | Fix billing checklist completion | `GET /api/v1/onboarding/state` must mark billing complete when subscription/access state is active, trialing, or paid/grace-allowed as intended. Add regression tests for signup trial, active subscription, expired trial, past_due grace, and canceled/unpaid. Verify paid tenants do not keep seeing "Activa el plan" as incomplete. |
| SELL-10 | P1 | Release verification | Make backend test gate easy to run | Document and verify a Windows local path for starting Postgres, applying migrations, and running `$env:UV_PROJECT_ENVIRONMENT=".venv-win"; uv run pytest`. CI remains the source of truth, but the release operator must be able to reproduce backend test gates locally. The exact live-Stripe release commit must have green backend CI. |
| SELL-11 | P2 | Frontend performance | Address production bundle warning | Review the main chunk warning (~692 kB minified). Decide whether it blocks broad self-serve selling. If yes, split public/auth/app routes and heavy reports/register surfaces with dynamic imports; verify mobile first load, PWA returning-browser behavior, and no stale pricing after deploy. If not blocking, document the accepted risk and target sprint. |
| SELL-12 | P2 | Email monitoring | Add email health/ops checks | Add an operator-visible way to confirm email provider configuration and recent delivery failures before enabling live billing. Could be a health check, runbook checklist, or admin-only diagnostics. Must not expose secrets or customer-sensitive message content. |

Sellability exit criteria:

- All P0 items above are closed before live Stripe is used for real paid tenants.
- P1 items are closed before broad self-serve selling, unless explicitly accepted as controlled-beta
  risks in `docs/current-sprint.md`.
- P2 items may follow beta signal, but must remain visible in planning and not be silently dropped.

### Explicitly Deferred Until After Signal

Do not pull these into Sprint 6 unless a real tenant blocks on them:

- SSO with Google.
- Bulk CSV import.
- Dark mode in the authenticated app.
- Full restaurant/table/KDS production support.
- Stripe Terminal.
- WhatsApp receipt sending.
- Multi-location.
- Advanced report builder.
- Public API/webhooks.

## Executive Summary

We are building a customizable multi-tenant POS SaaS platform based on Sweet Home POS MVP learnings.

The initial target is a sellable closed beta for bakery / small food retail.

The product should be:

- multi-tenant from day one
- offline-first
- secure by default
- BDD/spec-driven
- modular monolith
- simple to sell
- simple to operate
- production-ready enough for paid beta tenants

The first monetization model is intentionally simple:

- Standard Plan
- $299 MXN/month
- all currently available features included
- no Basic / Pro / Premium tiers
- no plan-based feature gates for v1

## Kova Product/UX/Business Audit Findings

# Kova Product, UX, Business, and Technical Audit

Audit date: 2026-05-20

Production audited: https://point-of-sale-ochre.vercel.app/

Test account audited: `posprojectsupport@gmail.com`

Primary persona: cafeteria / small coffee shop owner in Mexico.

Scope note: This audit did not create or modify production records. Evidence comes from the
production UI, authenticated navigation, and local code inspection. The requested file name was
`sprint_planning.md`; the repository source of truth is `docs/sprint-planning.md`, so this section
was integrated here.

## Executive Summary

Kova is not yet sellable with confidence at $299 MXN/month. The core POS skeleton is real and the
backend has meaningful production-grade foundations, but the production experience currently feels
like a polished internal beta, not a premium paid SaaS. The largest blocker is trust: the public
site advertises $199 MXN/month while the audit target is $299 MXN/month, the app mixes Spanish and
English, several landing claims overpromise features not proven in the authenticated product, and
the test tenant shows an expired-trial billing state while still allowing navigation.

The product does show credible direction. The dashboard has a setup checklist, the register has an
empty-catalog path, reports attempt business storytelling, tenant-scoped backend report endpoints
exist, and audit/offline/billing architecture is present in code. However, the first value moment is
not strong enough for a cafeteria owner: the owner lands in a blank catalog, sees a billing-required
banner, gets English labels like "Business profile", sees date text like "Tuesday, May 19", and
cannot clearly understand why Kova is worth paying for before the first sale.

Current scorecard:

| Area | Score | Rationale |
|---|---:|---|
| Clarity | 3 | Navigation is clear, but pricing, trial state, report dates, and mixed copy reduce confidence. |
| Visual polish / premium feel | 3 | Brand direction is modern, but update prompts, dead footer links, and inconsistent forms weaken it. |
| Ease of use | 3 | Main tasks are findable, but onboarding is not guided enough for a fresh cafeteria tenant. |
| Business usefulness | 3 | POS, catalog, inventory, shifts, and reports exist, but insights need stronger actionability. |
| Trust | 2 | Price mismatch, overclaims, English copy, expired trial state, and placeholder links hurt trust. |
| Speed / responsiveness | 4 | Screens loaded without console errors in audit, but report loading/error behavior needs stronger QA. |
| Mobile readiness | 2 | Bottom nav exists, but mobile shows duplicated navigation/menu state and dense operational forms. |
| Conversion potential | 2 | Landing is attractive, but claims exceed product proof and $299 value is not established. |
| Data storytelling | 3 | Reports have a storytelling model, but empty/current-period handling and comparisons are weak. |
| Technical implementation risk | 3 | Backend foundations are strong; risk remains in timezone consistency, deployment drift, and UX debt. |

## Product Promise Validation

Statement 1: "Kova existe para que no sacrifiques claridad por simplicidad, ni velocidad por control."

Verdict: Partially supported, not yet proven.

Evidence:
- Supported: The authenticated navigation is simple and core modules are visible: Panel, Caja,
  Catalogo, Ordenes, Inventario, Turnos, Reportes, Configuracion, Facturacion.
- Supported: The register screen is direct and fast conceptually: catalog search, cart, payment
  method, cash received, change, and charge button.
- Contradicted: A first-use tenant sees billing-required state, empty catalog, English onboarding
  labels, and update prompts before value is established.
- Contradicted: Landing claims include sucursales, impuestos, WhatsApp receipts, restaurant tables,
  commissions, barcode/fiado, and multi-location language that are not production-proven for beta.
- Contradicted: Settings in production still shows raw text inputs for timezone/language/currency
  and a logo URL field, despite current sprint notes saying improved controls exist locally.

Product call: The statement can become true, but only after the product narrows the promise to the
actual beta core and makes the first setup/sale/report path feel controlled.

Statement 2: "Cuando sabes que se vende, quien lo compra y cuando llega el dinero, dejas de ser administrativo y vuelves a ser dueno."

Verdict: Not currently supported.

Evidence:
- What sells: Partially supported. Reports include top products and product drivers when sales
  exist, and the backend computes these from order items.
- Who buys: Not supported in the audited product. There is no visible customer capture or customer
  reporting flow.
- When money arrives: Partially supported for recorded payment method mix, but not settlement,
  transfer timing, accounts receivable, or cash reconciliation narrative.
- What changed: Weak. Dashboard has today metrics and reports include previous-period comparison
  logic in the frontend, but production empty/current-period behavior did not make change obvious.
- What to do next: Partially supported. Reports generate recommended actions, but empty and low-data
  states are generic, and the dashboard action model is still onboarding-heavy.

Product call: Do not use this positioning yet. It overpromises customer intelligence and money timing.

## End-to-End Journey Audit

Landing page:
- Goal: Convince a buyer Kova is credible and worth trying.
- 5-second clarity: Medium. "Tu negocio, en flujo constante" is memorable but not concrete enough
  for a coffee shop owner deciding to pay.
- Primary action: "Empezar gratis" is visible.
- Evidence: Production price is $199 MXN/month, not the target $299 MXN/month. Footer still has
  placeholder `#` links for Producto, Soluciones, Compania, Recursos, Privacidad, Terminos, etc.
- Risk: The page looks premium but overclaims. It mentions multi-sucursal, impuestos, WhatsApp
  receipts, restaurant tables, commissions, barcode/fiado, and other vertical-specific workflows.
- Value question: It does not yet prove "worth $299/month" because it relies on aspirational copy
  instead of concrete cafe outcomes.

Login:
- Goal: Let existing users get into the app quickly.
- 5-second clarity: High.
- Primary action: Iniciar sesion.
- Evidence: Form is simple and worked with the test account.
- Gaps: No forgot-password link visible in audited snapshot. Copy is clean but basic.
- Trust issue: Global PWA update prompt appears on login and can distract from a sensitive action.

Signup:
- Goal: Create a business account.
- 5-second clarity: High.
- Primary action: Crear cuenta.
- Evidence: Fields are business name, email, password.
- Gaps: No visible terms/privacy acceptance, no password guidance, no expectation setting for the
  7-day trial, no indication of $299/$199 price, no support/trust cue.

Pricing/payment/subscription:
- Goal: Explain plan and recover billing.
- 5-second clarity: Low.
- Evidence: Billing page says "Manage your subscription and payments", "Facturacion requerida",
  "prueba de 7 days", "Prueba expirada", "0 dias restantes", and "MX$199.00".
- Gaps: Mixed language, contradictory trial messaging, wrong price for $299 target, and no clear
  explanation of what happens after paying.
- Business impact: This is a conversion blocker.

Onboarding / first-use:
- Goal: Move a business from blank account to first sale.
- 5-second clarity: Medium.
- Evidence: Dashboard checklist is useful, but labels include "Business profile", "Receipt settings",
  "Create product", "Activate inventory", "Open shift", "First sale", "Billing".
- Gaps: Checklist links point to routes like `/settings/business-profile` and `/settings/receipt`,
  while production settings is a single page. A cafe owner needs a more guided path with examples.

Dashboard:
- Goal: Tell the owner what happened today and what to do next.
- 5-second clarity: Medium.
- Primary action: "Abrir caja" / next action.
- Evidence: Shows setup checklist, health score, "Hoy en tu negocio", KPIs, payment mix, top
  products, quick actions.
- Gaps: Date renders in English ("Tuesday, May 19"), subscription price is $199, and empty state is
  still more operational than insight-led.
- Business usefulness: Good direction, but it needs a cafe-specific owner narrative after first data.

POS / sales flow:
- Goal: Sell quickly during service.
- 5-second clarity: High when products exist, medium when empty.
- Evidence: Empty catalog shows search, cart, payment method, cash received, change, disabled charge.
- Gaps: Payment controls are visible even with no cart; split payment is exposed by default in
  production; no "add your first cafe product" inline shortcut beyond "Gestionar catalogo".
- Daily operator impact: Usable foundation, but not yet optimized for a rush.

Products / catalog:
- Goal: Create the sellable menu.
- 5-second clarity: Medium-high.
- Evidence: Catalog offers sample bakery/retail presets, empty state, categories, products, modifier
  groups, and "Nuevo producto".
- Gaps: Target is cafe, but presets are bakery and retail. Cafe owner has to translate bakery preset
  mentally. The sample catalog CTA risks creating demo data in a real tenant unless clearly framed.

Employees:
- Goal: Invite/manage staff.
- 5-second clarity: Medium.
- Evidence: Employee invitation is embedded in Settings, with role selector and active user row.
- Gaps: No dedicated employee module, role labels are raw English (`owner`, `manager`, `cashier`),
  no permissions explanation.

Inventory:
- Goal: Know what needs restocking and adjust stock.
- 5-second clarity: Medium.
- Evidence: Empty state says no tracked products and links to catalog.
- Gaps: No direct "turn on tracking for first product" path inside inventory. No cafe language such
  as beans, milk, cups, pastries, or low-stock thresholds.

Reports:
- Goal: Help the owner make better decisions.
- 5-second clarity: Medium.
- Evidence: Reports include executive summary, date range, KPIs, sales by day/daypart/hour, product
  drivers, payment mix, operations, employee performance, and actions.
- Gaps: Current date defaults to a day with no sales in the test tenant. Manual date entry did not
  reliably apply during the audit. Empty report has many sections, making "no data" feel noisy.
- Strong point: Backend `business-story` is real and tenant-scoped through membership context.
- Technical risk: `business_story` uses tenant timezone bounds, while older report endpoints such as
  `sales_by_hour` use UTC bounds, which can create inconsistent answers.

Settings / customization:
- Goal: Configure business profile, receipt, and employees.
- 5-second clarity: Medium.
- Evidence: Business profile, receipt settings, and employees are on one screen.
- Gaps: Production still shows text inputs for timezone/language/currency and URL logo field. This
  contradicts current sprint notes and creates deployment drift risk. The settings page is dense on
  mobile.

Navigation:
- Goal: Keep top tasks under three clicks.
- 5-second clarity: High on desktop.
- Evidence: All major modules are visible in sidebar; bottom nav exposes Caja, Ordenes, Panel, Mas.
- Gaps: Mobile snapshot showed both side navigation and bottom navigation visible, creating duplicated
  navigation and wasted space.

Mobile:
- Goal: Make register and owner review usable from a phone/tablet.
- 5-second clarity: Medium.
- Evidence: Bottom nav exists and register content stacks.
- Gaps: Mobile menu state appears open by default in audited snapshots, with "Cerrar menu" plus bottom
  nav. Operational forms are dense and billing/update banners compete with the task.

Empty/loading/error/success states:
- Empty states exist in catalog, register, inventory, dashboard, and reports.
- Loading states were not visually evaluated deeply, but app screens loaded without console errors.
- Error states need more production QA: pricing/billing and date filtering copy are currently not
  polished enough for paid conversion.

Trust/security perception:
- Positive: httpOnly session architecture and tenant-scoped backend patterns are visible in code.
- Negative: Placeholder links, mixed language, wrong price, overclaims, and expired-trial copy make
  the product feel less trustworthy.

Performance:
- Production navigation felt responsive during audit and no console errors were captured.
- Risk remains around report fan-out: reports call multiple endpoints plus `business-story`; this
  needs measured p95/p99 API and frontend render timing before beta.

Data quality / backend data:
- Authenticated reports and orders appear backed by real tenant data, not static mock cards.
- Landing page still uses fake/demo metrics and fake cafe orders for marketing illustration.
- Test account contains historical production records while the catalog is empty, creating an odd
  data story for audits and demos.

## Cafe Owner Scenario Review

Set up the business:
- A cafe owner can find Settings quickly.
- The form asks for business name, support email, phone, timezone, language, and currency.
- The current production controls feel technical. Timezone/language/currency should be selects with
  explanations, not raw text fields.

Add products:
- Catalog is findable and has a clear "Nuevo producto" action.
- The preset options are not cafe-specific. Bakery is close, but a cafe owner should see a cafe preset
  or guided examples like americano, latte, cold brew, pastry, milk modifiers.

Add employees:
- Employee management exists in Settings.
- It feels hidden and technical. Role names should be localized and tied to what each role can do.

Manage inventory:
- Inventory points back to catalog when nothing is tracked.
- It needs a guided activation path and cafe examples: "Track milk liters", "Track espresso beans",
  "Set low-stock alert for cups".

Make a sale:
- Register is findable and the flow is understandable.
- Empty catalog blocks value. The app should help create a first cafe product from the register path
  or show a sample mode that is clearly not production data.

Review business performance:
- Reports attempt to answer the right questions.
- The story is not yet strong enough. It needs period comparison, what changed, top drivers, restock
  suggestions, payment method split, and staffing recommendations as first-class outcomes.

Decide what to do next:
- Dashboard and reports both have action concepts.
- The actions need to be tied to real cafe patterns and thresholds, not generic recommendations.

## Top 10 Critical Gaps

1. Gap: Pricing and plan mismatch blocks paid trust.
Evidence: Landing and billing show $199 MXN/month; audit target and current commercial intent are
$299 MXN/month. Billing page also says "7 days" and "Prueba expirada" simultaneously.
Why it matters: Buyers cannot trust a product that contradicts itself at the payment moment.
User impact: The owner hesitates before entering payment details.
Business impact: Direct conversion loss and support burden.
Suggested fix: Centralize Standard Plan price/copy and update all public/app surfaces to the approved
price, trial language, and plan terms.
Implementation notes: Inspect `frontend/src/billing/standardPlan.ts`, `frontend/src/routes/Home.tsx`,
`frontend/src/billing/BillingView.tsx`, backend billing defaults/migrations, and Stripe config.
Priority: P0
Effort: S
Confidence: High

2. Gap: Landing overpromises beyond beta reality.
Evidence: Landing claims multi-sucursal, impuestos, WhatsApp receipts, tables, commissions, barcode,
fiado, and broad vertical coverage.
Why it matters: Premium SaaS trust depends on saying exactly what the product can do today.
User impact: Cafe owner expects features that may not exist or are not ready.
Business impact: Higher churn, refund risk, and weak sales demos.
Suggested fix: Rewrite landing around the real beta promise: sell, record payments, manage catalog,
track inventory basics, work offline, close shifts, and review simple reports.
Implementation notes: Update `frontend/src/routes/Home.tsx`; remove dead footer links or replace with
real pages/contact.
Priority: P0
Effort: M
Confidence: High

3. Gap: Billing state is confusing and partially English.
Evidence: Billing page says "Manage your subscription and payments", "Tu cuenta esta bloqueada",
"prueba de 7 days", "Prueba expirada", "0 dias restantes", and "MX$199.00".
Why it matters: Billing is a trust-critical screen.
User impact: User does not know whether the account is blocked, expired, in trial, or safe to pay.
Business impact: Failed activation and payment support requests.
Suggested fix: Create a single billing state model and copy matrix for active trial, expired trial,
active subscription, past due, canceled, and missing Stripe config.
Implementation notes: Inspect `BillingView.tsx`, `BillingBanner.tsx`, `trial.ts`, and backend billing
schemas. Add BDD for each state.
Priority: P0
Effort: M
Confidence: High

4. Gap: First-use activation is not cafe-specific enough.
Evidence: Dashboard checklist uses generic/English labels; catalog presets are bakery/retail, not cafe.
Why it matters: The first value moment should make a cafe owner feel "this was made for me".
User impact: Owner must infer how to set up cafe products, modifiers, employees, and inventory.
Business impact: Lower trial activation and lower perceived value.
Suggested fix: Add a cafe setup path with first product, first modifier, first inventory item, first
employee, open shift, first sale, first report.
Implementation notes: Inspect `DashboardView.tsx`, onboarding APIs, `CatalogView.tsx`, and presets.
Priority: P1
Effort: M
Confidence: High

5. Gap: Reports are promising but not yet decisive.
Evidence: Reports have story sections and recommended actions, but default to an empty current day,
manual date entry did not reliably apply during audit, and no customer/money-arrival story exists.
Why it matters: The core promise is clarity/control through insights.
User impact: Owner sees many empty/reporting sections but not a clear answer.
Business impact: Weak retention and weak premium justification.
Suggested fix: Make Reports answer cafe decisions first: what sold, what changed, best daypart/hour,
payment split, restock risk, slow movers, employee contribution, and next action.
Implementation notes: Inspect `ReportsView.tsx`, `backend/app/reports/service.py`, report specs, and
test matrix. Add date filter E2E tests.
Priority: P1
Effort: L
Confidence: High

6. Gap: Locale/i18n polish is inconsistent.
Evidence: Dashboard shows "Tuesday, May 19"; onboarding labels are English; billing includes English.
Why it matters: A Mexico-focused paid SaaS must feel native and careful.
User impact: Product feels unfinished or foreign.
Business impact: Lower trust at checkout and onboarding.
Suggested fix: Run an authenticated i18n audit for all user-facing strings and dates.
Implementation notes: Inspect `frontend/src/i18n/messages.ts`, dashboard/report date formatters, and
BillingView copy.
Priority: P1
Effort: S
Confidence: High

7. Gap: Production appears behind local/current sprint notes.
Evidence: Current sprint says logo upload/select controls are done, but production Settings still
shows raw timezone/language/currency textboxes and URL logo field.
Why it matters: Deployment drift makes audits unreliable and can hide regressions.
User impact: User gets less polished controls in production.
Business impact: Release confidence drops.
Suggested fix: Add a production smoke checklist that compares current sprint acceptance criteria
against deployed UI before marking items done.
Implementation notes: Inspect Vercel deployment, current branch, and `docs/current-sprint.md`.
Priority: P0
Effort: S
Confidence: Medium

8. Gap: Mobile navigation is not clean enough for real operations.
Evidence: Mobile snapshot showed side navigation open with "Cerrar menu" plus bottom nav on register
and settings.
Why it matters: Cafes may use tablets/phones during setup or operations.
User impact: Smaller screens feel crowded and less professional.
Business impact: Reduced confidence in "works on phone/tablet" marketing claim.
Suggested fix: Ensure mobile sidebar is closed by default, bottom nav is the primary surface, and
billing/update banners do not crowd operational screens.
Implementation notes: Inspect `AppShell.tsx`, mobile nav state, and responsive tests.
Priority: P1
Effort: M
Confidence: Medium

9. Gap: Customer intelligence is absent from current product promise.
Evidence: No visible customer capture or customer reporting in audited screens.
Why it matters: The positioning says "quien lo compra".
User impact: Owner cannot learn buyer-level patterns.
Business impact: Marketing claim creates expectation debt.
Suggested fix: Remove "who buys" messaging for now or explicitly defer customer insights.
Implementation notes: Do not build customer CRM for beta unless it becomes a P1 spec; adjust copy.
Priority: P1
Effort: S
Confidence: High

10. Gap: Report timezones may produce inconsistent answers.
Evidence: `business_story` uses tenant timezone bounds, while `sales_by_hour` and older endpoints use
UTC bounds and UTC hour extraction.
Why it matters: Mexico cafe owners care about morning/afternoon/evening performance; wrong hour
buckets destroy trust.
User impact: Owner may staff or prep based on wrong time-window insight.
Business impact: Analytics credibility risk.
Suggested fix: Normalize every report endpoint to tenant timezone for date bounds and grouping.
Implementation notes: Inspect `backend/app/reports/service.py`; add timezone golden tests and BDD.
Priority: P1
Effort: M
Confidence: High

## Reports and Business Intelligence Review

Kova's reporting model is better than raw KPI cards in code, but production does not yet deliver the
full owner-level story. The backend has a `business-story` endpoint that combines sales by day,
daypart, peak hour, product drivers, payment mix, operational signals, employee sales, refunds, and
recommended actions. That is the right architecture direction.

Current gaps:
- The default report period can show an empty current day even when the tenant has recent historical
  orders, making the product look inactive.
- The reports UI shows many empty sections instead of one focused "what to do next" path.
- Period comparison is not strong enough as the main story.
- Inventory restock and slow-mover recommendations are not first-class in production reports.
- Payment method mix exists, but "when money arrives" is not answered.
- Employee reporting exists, but it needs cafe-useful interpretation: rush coverage, average ticket,
  void/refund risk, and shift contribution.
- Customer reporting is absent.

Good report direction:
- "Sales increased/decreased vs previous period because of X product and Y daypart."
- "Afternoons drove most cafe sales; prep more cold drinks before 4 PM."
- "Latte is the top product, but milk stock is below threshold."
- "Cash is 80% of payments; reconcile cash drawer before close."

Bad report direction to avoid:
- More KPI cards without recommendations.
- Generic charts that do not tie to staffing, prep, inventory, or cashier coaching.

## Conversion and Monetization Review

Kova does not currently earn the right to charge $299 MXN/month from the public experience alone.
The buyer sees an attractive brand but not enough proof. The price is wrong, the plan copy is
inconsistent, and the app's first authenticated experience starts with expired billing pressure
instead of a guided "get to first sale" moment.

What would justify $299/month:
- One clear plan at $299 MXN/month everywhere.
- A cafe-specific setup path completed in under 10 minutes.
- First sale completed without support.
- First report that explains what sold and what to do next.
- Visible offline reliability and recoverability.
- Trust cues: real support, privacy/terms, status, security copy, and honest beta scope.

## UI/UX and Premium Feel Review

Strengths:
- Brand direction is modern and more premium than a generic admin template.
- Sidebar navigation is clear on desktop.
- Register has a practical POS layout.
- Reports have a useful information architecture concept.
- Empty states exist in core modules.

Weaknesses:
- Public and app copy overuses abstract brand language before proving concrete value.
- Dead footer links and placeholder resources make the site feel unfinished.
- Mixed English/Spanish breaks the premium impression.
- PWA update prompt appears globally and distracts from landing/login.
- Settings is too dense and technical.
- Mobile duplicated navigation state needs cleanup.
- Production settings controls do not match the local/current sprint polish.

## Technical and Data Risk Review

Positive signals:
- Backend routes use membership-derived tenant IDs for reports.
- Reporting endpoints are backed by real order/payment/refund tables.
- Decimal money helpers are used in report calculations.
- Auth/session, RLS, audit, idempotency, offline sync, and telemetry foundations exist in code.
- No console errors were observed during audited navigation.

Risks:
- Pre-Sprint 1 audit finding: price source of truth was wrong for the target price and backed by
  `19900` defaults.
- Report timezone handling is inconsistent between `business_story` and other endpoints.
- Production UI appears behind current sprint documentation.
- Landing still contains fake/demo dashboard metrics and placeholder links.
- Telemetry exists, but conversion/activation dashboards and quality gates are not proven.
- The test account has historical orders with an empty current catalog, which creates audit/demo
  data confusion.

## Quick Wins

- Change all Standard Plan surfaces to the approved $299 MXN/month or explicitly re-approve $199 as
  the commercial model before public sales.
- Replace landing overclaims with beta-true claims.
- Remove or fix footer placeholder links.
- Translate remaining English strings in dashboard, billing, reports, roles, and dates.
- Hide or soften the global PWA update prompt on landing/login.
- Create a cafe-specific catalog preset or first-product guide.
- Collapse report empty states into a single helpful path when there is no data.
- Add visible privacy/terms/support links on signup and billing.
- Fix mobile nav default state.
- Add production smoke checks for current-sprint acceptance criteria.

## Strategic Improvements

- Build a cafe-first onboarding journey that gets to first sale and first report.
- Reframe reports around business decisions, not just metrics.
- Normalize all reporting to tenant timezone and add golden tests.
- Add inventory insight joins: low-stock, velocity, slow movers, and suggested reorder quantities.
- Add activation telemetry tied to signup, first product, first shift, first sale, first report, and
  checkout start/completion.
- Create a production demo/audit tenant policy so test data does not distort product evaluation.
- Introduce a small design-system QA checklist for spacing, forms, empty states, mobile nav, and
  i18n before deployment.

## Recommended Product Messaging

Do not use the proposed positioning unchanged yet.

Safer current messaging:

"Kova es un punto de venta simple para cafeterias y comercios pequenos en Mexico. Te ayuda a vender
en caja, registrar pagos, controlar productos e inventario basico, trabajar aunque falle internet y
revisar lo mas importante del dia sin hojas de calculo."

Landing hero candidate:

"El POS simple para vender, cerrar caja y entender tu dia."

Supporting copy:

"Crea tu catalogo, cobra en efectivo, transferencia o tarjeta manual, trabaja offline y revisa ventas,
productos y pagos desde un solo lugar. Hecho para pequenos negocios en Mexico."

Report messaging candidate:

"Tus ventas convertidas en decisiones: que se vendio, en que momento, como pagaron y que conviene
preparar para el siguiente turno."

Avoid for now:
- "quien lo compra" until customer data exists.
- "cuando llega el dinero" until settlement/cash timing is explicit.
- "sucursales" until multi-location is production-ready.
- "restaurantes", "salones", "comisiones", "fiado", "WhatsApp receipts", and "impuestos" unless each
  is backed by production-ready flows.

## Sprint Backlog

### Sprint 1: Trust, Clarity, and Conversion

Objective: Make the product feel credible, clear, and worth trying.

User/business outcome: A first-time buyer understands what Kova does, what it costs, why it is safe
to try, and what happens after signup.

Tasks:
- [x] Added from Kova Product/UX Audit: Centralize and correct Standard Plan price/copy to the
  approved $299 MXN/month, or explicitly re-approve $199 before sales.
- [x] Added from Kova Product/UX Audit: Rewrite landing claims to beta-true cafe/small food retail
  value and remove unsupported vertical claims.
- [x] Added from Kova Product/UX Audit: Replace dead footer links with real privacy, terms, support,
  status, and contact destinations.
- [x] Added from Kova Product/UX Audit: Add signup trust cues: trial length, no-card statement,
  privacy/terms, support email, and password guidance.
- [ ] Added from Kova Product/UX Audit: Create a billing state copy matrix for active trial, expired
  trial, active subscription, past due, canceled, and Stripe unavailable.
- [x] Added from Kova Product/UX Audit: Hide or defer global update prompts on landing/login unless
  the user is authenticated and operationally safe to update.
- [x] Added from Kova Product/UX Audit: Translate remaining English billing/dashboard strings and
  localize date output to Spanish.

Acceptance criteria:
- Every public and app pricing surface shows the same approved plan price and terms.
- Landing contains no claims for features that are absent or deferred from beta.
- Signup includes privacy/terms links and clear trial/payment expectations.
- Billing page has exactly one clear state message and one primary action.
- No placeholder `href="#"` links remain on conversion-critical pages.
- Spanish copy and es-MX date formatting are consistent.

Suggested files/components to inspect or modify:
- `frontend/src/routes/Home.tsx`
- `frontend/src/billing/standardPlan.ts`
- `frontend/src/billing/BillingView.tsx`
- `frontend/src/billing/BillingBanner.tsx`
- `frontend/src/auth/AuthView.tsx`
- `frontend/src/components/PWAUpdatePrompt.tsx`
- `frontend/src/i18n/messages.ts`
- `backend/app/billing/service.py`
- `backend/alembic/versions/0012_billing_foundation.py`
- Stripe Standard Plan configuration

Risks:
- Changing price without Stripe alignment can break checkout.
- Removing overclaims may reduce surface-level excitement, but increases trust.

QA checklist:
- Visit landing logged out on desktop and mobile.
- Visit signup/login and confirm no distracting update prompt.
- Start checkout from expired trial state in staging/sandbox.
- Verify price in landing, dashboard checklist, billing banner, billing page, and Stripe checkout.
- Run i18n smoke for all audited strings.

### Sprint 2: Onboarding and First Value Moment

Objective: Help a cafe owner reach value quickly.

User/business outcome: A new cafe tenant can configure the business, add a first sellable product,
open a shift, create a sale, and see the first report without support.

Tasks:
- [x] Added from Kova Product/UX Audit: Add cafe-specific setup checklist copy and remove English
  checklist labels.
- [x] Added from Kova Product/UX Audit: Add a cafe preset or guided first-product path with examples
  such as Americano, Latte, Cold Brew, pastry, milk modifier, and cup/bean inventory.
- [x] Added from Kova Product/UX Audit: Make empty register state offer "Crear primer producto" and
  "Cargar preset de cafeteria" actions.
- [x] Added from Kova Product/UX Audit: Make Inventory empty state guide the user to activate stock
  tracking on a specific product.
- [x] Added from Kova Product/UX Audit: Add first-use success states after first product, first shift,
  first sale, and first report.
- [x] Added from Kova Product/UX Audit: Define demo/sample catalog safety copy so presets are not
  mistaken for fake production data.
- [x] Added from Kova Product/UX Audit: Make dashboard checklist links open direct setup actions
  (`/catalog?new=product`, `/catalog?inventory=activate`) instead of only module landing pages.

Acceptance criteria:
- Fresh tenant sees a cafe-relevant checklist above dashboard KPIs.
- First product creation is reachable from dashboard, catalog, and empty register.
- Preset/sample data requires clear confirmation and is tenant-scoped.
- After first sale, dashboard and reports show a clear next step.
- All empty states explain why the module matters and what to do next.

Suggested files/components to inspect or modify:
- `frontend/src/dashboard/DashboardView.tsx`
- `frontend/src/catalog/CatalogView.tsx`
- `frontend/src/register/RegisterView.tsx`
- `frontend/src/inventory/InventoryView.tsx`
- `frontend/src/onboarding/FirstUseTour.tsx`
- `backend/presets/bakery.json`
- new `backend/presets/cafe.json`
- onboarding specs and BDD files

Risks:
- Sample data can pollute real tenants if not clearly controlled.
- Cafe preset should not expand into deferred restaurant scope.

QA checklist:
- Create a fresh tenant in staging.
- Complete first product, first employee, first inventory item, first shift, first sale, first report.
- Confirm checklist progress updates without manual refresh.
- Confirm no fake/demo data appears unless explicitly loaded.
- Verify the cafeteria preset creates only tenant-scoped records after an explicit click.

### Sprint 3: POS, Products, Employees, and Inventory Usability

Objective: Make daily operations fast and reliable.

User/business outcome: A cafe operator can sell during a busy day, while the owner can maintain
catalog, employees, and inventory without guessing.

Tasks:
- [x] Added from Kova Product/UX Audit: Keep split payment behind advanced options until a cart exists
  and payment context makes it useful.
- [x] Added from Kova Product/UX Audit: Reduce register empty-state clutter by hiding payment controls
  until the cart has items or showing them in a disabled instructional state.
- [x] Added from Kova Product/UX Audit: Localize employee roles and explain permissions in Settings.
- [x] Added from Kova Product/UX Audit: Move employee management into clearer settings tabs or a
  dedicated employee section.
- [x] Added from Kova Product/UX Audit: Replace production raw timezone/language/currency/logo URL
  controls with polished selects/upload if those changes are already complete locally.
- [x] Added from Kova Product/UX Audit: Add search/filter/sort QA for products, orders, and inventory.
- [x] Added from Kova Product/UX Audit: Fix mobile navigation default state and remove duplicated nav
  surfaces during operational tasks.

Acceptance criteria:
- Register starts focused on product search/cart and makes "what next" obvious.
- Payment controls cannot confuse an empty-cart user.
- Employee roles are Spanish, understandable, and mapped to permission meaning.
- Settings controls are validated and do not expose raw technical values unnecessarily.
- Mobile register, catalog, inventory, and settings are usable at 390px width without duplicate nav.

Suggested files/components to inspect or modify:
- `frontend/src/register/RegisterView.tsx`
- `frontend/src/catalog/CatalogView.tsx`
- `frontend/src/orders/OrderListView.tsx`
- `frontend/src/settings/SettingsView.tsx`
- `frontend/src/settings/LogoUploadField.tsx`
- `frontend/src/inventory/InventoryView.tsx`
- `frontend/src/layout/AppShell.tsx`
- `frontend/src/components/ui/select.tsx`
- `frontend/src/i18n/messages.ts`

Risks:
- Moving employee UI may require route and permission QA.
- Mobile nav state can regress desktop sidebar behavior.

QA checklist:
- Complete a cash sale on desktop and mobile/tablet viewport.
- Add/edit/deactivate product.
- Search, filter, and sort products, orders, and inventory at 390px width.
- Invite employee, change role, deactivate access, and verify role display/copy.
- Activate inventory tracking and verify low-stock/search/filter/sort states.
- Keyboard navigate register and settings forms.

### Sprint 4: Reports and Business Storytelling

Objective: Turn raw data into decisions.

User/business outcome: A cafe owner can understand what sold, when it sold, how customers paid, what
needs restocking, who contributed operationally, what changed, and what to do next.

Tasks:
- [ ] Added from Kova Product/UX Audit: Normalize all report endpoints to tenant timezone for date
  bounds, daypart grouping, and hour grouping.
- [ ] Added from Kova Product/UX Audit: Make report date filters reliable, tested, and easy to use
  with Today, Week, Month, and custom range presets.
- [x] Added from Kova Product/UX Audit: Add a compact owner decision brief with previous-period
  comparison, restock guidance, and no more than three recommended actions.
- [x] Added from Kova Product/UX Audit: Add previous-period comparison as a first-class story in
  the owner-facing report brief.
- [x] Added from Kova Product/UX Audit: Collapse detailed KPI/chart/payment/employee sections behind
  one `Ver análisis detallado` control so the first report screen stays digestible.
- [x] Added from Kova Product/UX Audit: Replace duplicate KPI-card detail with decision-oriented
  analysis sections: timing, product inventory, payment operations, and meaningful employee
  comparison.
- [ ] Added from Kova Product/UX Audit: Add cafe-useful top/bottom product analysis, growth/decline,
  and slow-mover logic.
- [ ] Added from Kova Product/UX Audit: Add backend-backed inventory restock recommendations that join
  sales velocity with low-stock thresholds.
- [ ] Added from Kova Product/UX Audit: Add payment method split story and cash reconciliation prompts.
- [ ] Added from Kova Product/UX Audit: Add employee contribution story: orders, net sales, refund/void
  risk, and shift coverage cues.
- [ ] Added from Kova Product/UX Audit: Collapse no-data reports into one guided empty state instead
  of many empty chart sections.
- [ ] Added from Kova Product/UX Audit: Remove "who buys" and "when money arrives" messaging until
  customer/settlement data exists.

Acceptance criteria:
- Reports answer: best products today/week/month, best time window, payment split, restock risks,
  employee contribution, and changed-vs-previous-period.
- Report empty state has one primary CTA and one secondary CTA.
- All report dates and time buckets use tenant timezone.
- Every reporting endpoint is tenant-scoped and covered by timezone/money tests.
- Recommended actions are threshold-based, explain the business reason, and are capped so the first
  report screen does not overwhelm the owner.
- Detailed charts and secondary operational analysis stay available without dominating the initial
  report view.
- Detailed analysis uses charts and tables only when they answer an admin decision: when to prepare,
  what to restock, how payments affect operations, and whether staff comparison has enough data.

Suggested files/components to inspect or modify:
- `frontend/src/reports/ReportsView.tsx`
- `frontend/src/reports/InteractiveCharts.tsx`
- `frontend/src/reports/api.ts`
- `frontend/src/reports/types.ts`
- `backend/app/reports/service.py`
- `backend/app/reports/router.py`
- `backend/app/reports/schemas.py`
- `docs/test-matrixes/reports.md`
- `specs/reports/*`

Risks:
- Business storytelling can become noisy if every metric generates an action.
- Inventory recommendations need careful handling when stock tracking is incomplete.

QA checklist:
- Seed controlled staging data across morning/afternoon/evening and previous/current periods.
- Verify period comparisons and time buckets in America/Mexico_City.
- Verify refunds/voids and split payments affect net sales and payment mix correctly.
- Verify no mock/demo numbers appear in authenticated reports.

### Sprint 5: Productization Hardening

Objective: Prepare Kova to be sold confidently.

User/business outcome: The product feels stable, accessible, measurable, secure, and production-ready
for paid beta tenants.

Tasks:
- [ ] Added from Kova Product/UX Audit: Add production smoke checks that verify current sprint
  acceptance criteria against deployed production/staging.
- [ ] Added from Kova Product/UX Audit: Add activation/conversion telemetry dashboard for landing CTA,
  signup start/success, first product, first sale, first report, checkout start, and checkout success.
- [ ] Added from Kova Product/UX Audit: Add accessibility pass for landing, signup, billing, register,
  dashboard, reports, settings, and mobile nav.
- [ ] Added from Kova Product/UX Audit: Measure frontend/API p95 for dashboard, register, catalog,
  reports, and billing.
- [ ] Added from Kova Product/UX Audit: Define test/audit tenant data policy and cleanup process.
- [ ] Added from Kova Product/UX Audit: Review reusable components/tokens and reduce one-off visual
  implementations in marketing and app surfaces.
- [ ] Added from Kova Product/UX Audit: Add no-placeholder-link and no-unsupported-claim checks to
  pre-release QA.
- [ ] Added from Kova Product/UX Audit: Complete tenant isolation tests for every tenant-scoped route
  before paid beta expansion.

Acceptance criteria:
- Deployed app matches current sprint acceptance criteria.
- Zero critical/serious accessibility issues on audited flows.
- No placeholder links or unsupported marketing claims in production.
- Key activation/conversion events are tracked and queryable.
- Dashboard/register/reports p95 targets are documented and monitored.
- Tenant isolation route coverage is complete for beta-critical endpoints.

Suggested files/components to inspect or modify:
- `frontend/src/telemetry/funnel.ts`
- `backend/app/telemetry/router.py`
- `docs/current-sprint.md`
- `docs/risk-register.md`
- `frontend/src/styles.css`
- `frontend/src/components/ui/*`
- `backend/app/tests/test_tenant_isolation.py`
- Playwright/E2E production smoke tests

Risks:
- Telemetry can collect sensitive data if event payloads are not controlled.
- Accessibility fixes may expose deeper component API gaps.

QA checklist:
- Run production smoke after each deploy.
- Run no-secrets and dependency audit.
- Run tenant isolation tests.
- Run accessibility scan and keyboard navigation pass.
- Review Sentry/logs for billing, auth, reports, and order creation errors.

## North Star Flow

tenant signup → business setup → catalog setup → open shift → create sale → accept payment → issue receipt → offline sync if needed → close shift → review daily sales → maintain active subscription

## Phase Plan

| Phase | Sprints | Status | Outcome |
|---|---|---|---|
| Foundation | 0A–0C | ✅ Done | Repo, app skeleton, auth, tenant isolation, BDD harness |
| Operations | 5–8 | ✅ Done | Refunds, voids, receipts, shifts, inventory, reporting |
| Billing + App Shell | 9–10 | ✅ Done | $299 MXN plan, Stripe Billing, auth-protected routing, register shell |
| Core POS | 11–13 | ✅ Done | Catalog, register, cash/manual sale, order creation, offline sync |
| Beta Hardening | 14 | ✅ Code done — ops pending | Security, monitoring, backup drill, beta support |
| Modifiers | 15 | ✅ Done | Modifier groups, options, pricing, register modal, receipts |
| UX Polish + Onboarding | 16 | ✅ Done | Mobile sidebar, category names, payment picker, onboarding checklist, orders filter, stock badges, i18n audit |
| Kova Audit Sprints 1-6 | Audit 1-6 | Done / ops gates active | Trust, onboarding, first value, reports storytelling, QA bug fixes, trust lock, day-1 operations |
| Commercial Readiness Ops | Paid beta gates | Active now | Live Stripe, email deliverability, restore drill, support/domain trust, production smoke |
| Tax Engine | 17 | 📋 Planned | Tax rates, tax-inclusive/exclusive, receipt line tax |
| Discounts | 18 | 📋 Planned | Per-line and per-order discounts, reason tracking |
| Retail Preset + Adv. Inventory | 19 | 📋 Planned | Retail preset, barcode/SKU input, CSV import, stock history |
| Restaurant Preset | 20 | 📋 Planned | Restaurant catalog preset, table notes, modifier-heavy menus |
| GA Hardening | 21 | 📋 Planned | Legal, marketing site, help center, security + load review, accessibility |
| Closed Paid Beta | — | 🔜 After Sprint 6 + live ops gates | 10-20 cafe/small food retail tenants, $299 MXN/month |

### Core POS Sprint Breakdown

| Sprint | Focus | Status |
|---|---|---|
| 11 | Catalog Management — categories + products CRUD, BDD, RLS | ✅ Done |
| 12 | Register Core — product grid, cart, cash/manual/split payment, order creation | ✅ Done |
| 13 | Offline Sync + Dead Letter | ✅ Done |

### Sprint 15 Update

- Modifiers are implemented, tested, production-deployed, and documented as of 2026-05-13.
- Production mismatch found during validation was repaired in Supabase and redeployed through Vercel.
- The immediate remaining execution path is the pre-beta ops checklist in `docs/current-sprint.md`, not more modifier feature work.

## BDD Coverage Matrix

| Domain | Happy Path | Permission Denied | Tenant Isolation | Idempotency | Offline / Sync | Money Rounding | Concurrency | Audit Log | i18n / Locale |
|---|---|---|---|---|---|---|---|---|---|
| Auth & Sessions | Beta | Beta | Beta | n/a | n/a | n/a | GA | Beta | GA |
| Catalog | Beta | Beta | Beta | Beta | n/a | n/a | GA | Beta | GA |
| Register / Cart | Beta | Beta | Beta | n/a | Beta | Beta | n/a | n/a | Beta |
| Order Creation | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta |
| Cash Payment | Beta | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta |
| Manual Transfer/Card | Beta | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta |
| Split Payment | Beta if included | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta |
| Refund / Void | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta |
| Inventory | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta | n/a |
| Shifts | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta |
| Receipts | Beta | n/a | Beta | n/a | Beta | Beta | n/a | n/a | Beta |
| Reporting | Beta | Beta | Beta | n/a | n/a | Beta | n/a | n/a | Beta |
| Billing | Beta | Beta | Beta | Beta | n/a | Beta | n/a | Beta | Beta |
| Modifiers | GA | GA | GA | GA | GA | GA | GA | GA | GA |
| Tax Engine | GA | GA | GA | n/a | n/a | GA | n/a | GA | GA |
| Discounts | GA | GA | GA | n/a | GA | GA | n/a | GA | GA |

## Test Matrix Template

Each feature spec should include this table:

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| ORDER-001 | specs/orders/cash_sale.feature | Cashier completes a cash sale | E2E | frontend/tests/features/cash_sale.feature | @p0 @money | Beta | Required | |
| ORDER-002 | specs/orders/cash_sale.feature | Change is computed correctly | Unit | backend/tests/unit/test_pricing.py | @money | Beta | Required | |
| ORDER-003 | specs/shared/idempotency.feature | Same key returns same response | Backend BDD | backend/tests/features/idempotency.feature | @idempotency | Beta | Required | |

## Sprint 0A — Platform Skeleton

### Goal

Create the minimum deployable application skeleton.

### Product Outcome

A user can open the app shell and see a basic landing/login placeholder.

### Technical Outcome

Local dev, backend skeleton, frontend skeleton, database, migrations, basic CI, and staging path exist.

### Required Specs

- `specs/shared/project_skeleton.md`
- `specs/shared/local_dev.md`

### Required Scenarios

- App health check responds successfully.
- Frontend loads app shell.
- Backend connects to database.
- Alembic migration applies cleanly.
- CI runs backend tests.
- CI runs frontend checks.

### Tasks

- [ ] Create monorepo structure.
- [ ] Add backend FastAPI skeleton.
- [ ] Add frontend React/TypeScript skeleton.
- [ ] Add PostgreSQL local dev setup.
- [ ] Add Docker Compose.
- [ ] Add Alembic.
- [ ] Add initial migration.
- [ ] Add `/health` endpoint.
- [ ] Add backend test framework.
- [ ] Add frontend test framework.
- [ ] Add GitHub Actions CI.
- [ ] Add lint/typecheck/test commands.
- [ ] Add `.env.example`.
- [ ] Ensure `.env` is ignored.
- [ ] Add documented staging deployment path.
- [ ] Add README local dev instructions.

### Data Model

- Initial Alembic setup only.

### API

- `GET /health`
- Optional `GET /api/v1/version`

### UI

- App shell.
- Basic error boundary placeholder.

### Tests

- Backend health test.
- Frontend smoke test.
- Migration apply test.

### Definition of Done

- App runs locally.
- Backend tests pass.
- Frontend checks pass.
- Migration applies.
- CI runs on PR.
- No secrets are committed.

## Sprint 0B — Security + Multi-Tenant Foundation

### Goal

Establish tenant isolation, auth foundation, sessions, RBAC skeleton, audit logs, and idempotency infrastructure.

### Product Outcome

A tenant owner can sign up, verify email, log in, refresh session, log out, and see tenant-specific shell data.

### Required Specs

- `specs/auth/sessions.md`
- `specs/shared/tenant_isolation.md`
- `specs/shared/authz.md`
- `specs/shared/audit_log.md`
- `specs/shared/idempotency.md`

### Tasks

- [ ] Create `tenants` table.
- [ ] Create `users` table.
- [ ] Create `memberships` table.
- [ ] Create `roles` table.
- [ ] Create `permissions` table.
- [ ] Create `role_permissions` table.
- [ ] Create `sessions` table.
- [ ] Create `audit_logs` table.
- [ ] Create `idempotency_keys` table.
- [ ] Add RLS policies where applicable.
- [ ] Add tenant context middleware.
- [ ] Add signup endpoint.
- [ ] Add email verification endpoint.
- [ ] Add login endpoint.
- [ ] Add refresh endpoint.
- [ ] Add logout endpoint.
- [ ] Add logout-all endpoint.
- [ ] Add password reset endpoints.
- [ ] Add password hashing.
- [ ] Add refresh token/session rotation.
- [ ] Add session revocation.
- [ ] Add RBAC skeleton.
- [ ] Add permission dependency.
- [ ] Add write invariant helper/decorator.
- [ ] Add audit log helper.
- [ ] Add idempotency helper.
- [ ] Add tenant isolation tests.
- [ ] Add permission denied tests.
- [ ] Add auth/session tests.

### API

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/verify`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `POST /api/v1/auth/password-reset/request`
- `POST /api/v1/auth/password-reset/confirm`
- `GET /api/v1/me`

### Definition of Done

- Auth flows work.
- Tenant isolation tests pass.
- Session revocation works.
- Demo write endpoint proves idempotency/audit/permission/tenant invariants.

## Sprint 0C — Quality + BDD Foundation

### Goal

Create the spec-driven delivery system before implementing core POS features.

### Tasks

- [ ] Add `/specs` structure.
- [ ] Add `/docs/test-matrixes` structure.
- [ ] Add BDD test tooling.
- [ ] Add backend BDD runner.
- [ ] Add frontend E2E runner.
- [ ] Add shared scenario convention.
- [ ] Add PR template.
- [ ] Add test matrix template.
- [ ] Add structured JSON logging.
- [ ] Add request_id middleware.
- [ ] Add Sentry frontend/backend.
- [ ] Add OpenAPI generation.
- [ ] Add pre-commit hooks.
- [ ] Add no-secrets check.
- [ ] Add no raw `print`/`console.log` rule where feasible.
- [ ] Add no-floats-in-money rule placeholder.

### Definition of Done

- Backend BDD works.
- Frontend E2E works.
- PR template exists.
- Test matrix template exists.
- CI runs quality gates.
- Logs include request_id.
- Sentry receives test error if configured.

## Sprint 1 — Catalog Foundation

### Goal

Allow a tenant owner to create the basic catalog needed to sell.

### Required Specs

- `specs/catalog/categories.md`
- `specs/catalog/products.md`
- `specs/catalog/variants.md`

### Tasks

- [ ] Create categories table.
- [ ] Create products table.
- [ ] Create product_variants table if needed.
- [ ] Create product_images table or image URL fields.
- [ ] Add RLS policies.
- [ ] Add catalog service.
- [ ] Add catalog repository.
- [ ] Add catalog router.
- [ ] Add catalog schemas.
- [ ] Add catalog policies.
- [ ] Add category CRUD.
- [ ] Add product CRUD.
- [ ] Add product soft-delete.
- [ ] Add variant support if needed.
- [ ] Add image upload flow if included.
- [ ] Add catalog page.
- [ ] Add category management UI.
- [ ] Add product list UI.
- [ ] Add product create/edit drawer.
- [ ] Add audit logging.
- [ ] Add idempotency for writes.
- [ ] Add tenant isolation tests.
- [ ] Add permission tests.
- [ ] Add E2E create/edit/deactivate product.

## Sprint 2 — Register + Online Sale

### Goal

A cashier can complete an online sale with cash/manual payment.

### Required Specs

- `specs/orders/cash_sale.md`
- `specs/orders/manual_payment.md`
- `specs/inventory/decrement.md`
- `specs/pricing/money_rules.md`

### Tasks

- [ ] Create orders table.
- [ ] Create order_items table.
- [ ] Create payments table.
- [ ] Create inventory_movements table.
- [ ] Add order service.
- [ ] Add payment service.
- [ ] Add pricing calculator.
- [ ] Use Decimal for all money.
- [ ] Add no-floats protection in money path.
- [ ] Add stock decrement with row-level locking.
- [ ] Add idempotency for order creation.
- [ ] Add audit logs.
- [ ] Add register UI.
- [ ] Add product grid.
- [ ] Add cart state.
- [ ] Add cash payment modal.
- [ ] Add manual transfer/card payment flow.
- [ ] Add success screen.
- [ ] Add basic receipt stub.
- [ ] Add money golden tests.
- [ ] Add order creation BDD.
- [ ] Add concurrent inventory decrement test.
- [ ] Add E2E cash sale.

## Sprint 3 — Split Payment + Receipt Stub Polish

### Goal

Complete core payment recording for beta.

### Required Specs

- `specs/orders/split_payment.md`
- `specs/orders/receipt_stub.md`

### Tasks

- [ ] Extend payment service.
- [ ] Extend order create payload.
- [ ] Add split payment validation.
- [ ] Add cash + transfer split.
- [ ] Add cash + manual card split.
- [ ] Add sum mismatch validation.
- [ ] Add payment breakdown UI.
- [ ] Add receipt payment breakdown.
- [ ] Add payment method totals.
- [ ] Add BDD split payment scenarios.
- [ ] Add E2E split payment.

## Sprint 4 — Offline Sync + Dead Letter

### Goal

The register works offline and safely syncs when back online.

### Required Specs

- `specs/orders/offline_sync.md`
- `specs/orders/dead_letter.md`

### Tasks

- [ ] Add Dexie schema.
- [ ] Add local sale queue.
- [ ] Add statuses: pending, syncing, synced, failed.
- [ ] Add sync worker.
- [ ] Add exponential backoff.
- [ ] Add dead-letter UI.
- [ ] Add conflict response handling.
- [ ] Add server sync endpoint.
- [ ] Add idempotency based on client_uuid.
- [ ] Add offline indicator.
- [ ] Add pending sync count.
- [ ] Add manual sync button.
- [ ] Add service worker/app shell caching.
- [ ] Add Playwright offline tests.
- [ ] Add duplicate sync tests.
- [ ] Add dead-letter recovery tests.

## Sprint 5 — Refunds, Voids, and Receipts

### Goal

Support real operational corrections after a sale.

### Required Specs

- `specs/orders/refund.md`
- `specs/orders/void.md`
- `specs/orders/receipt.md`

### Tasks

- [ ] Create refunds table.
- [ ] Create refund_items table.
- [ ] Add refund service.
- [ ] Add void service.
- [ ] Add receipt renderer.
- [ ] Add PDF generation if feasible.
- [ ] Add email receipt flow.
- [ ] Add receipt preview UI.
- [ ] Add refund modal.
- [ ] Add permission gates.
- [ ] Add audit logs.
- [ ] Add idempotency.
- [ ] Add refund golden tests.
- [ ] Add receipt snapshot/visual tests.

## Sprint 6 — Shifts + Cash Movements

### Goal

Reproduce and generalize the MVP’s shift reconciliation.

### Required Specs

- `specs/shifts/open.md`
- `specs/shifts/close.md`
- `specs/shifts/cash_movements.md`

### Tasks

- [ ] Create shifts table.
- [ ] Create cash_movements table.
- [ ] Add shift service.
- [ ] Add shift calculator.
- [ ] Add shift policy.
- [ ] Add open shift UI.
- [ ] Add active shift card.
- [ ] Add cash in/out UI.
- [ ] Add close shift wizard.
- [ ] Add shift history.
- [ ] Add expected cash golden tests.
- [ ] Add double-open concurrency test.
- [ ] Add offline close scenario if needed.

## Sprint 7 — Inventory Basics

### Goal

Allow owners to see and adjust stock beyond automatic sale decrement.

### Required Specs

- `specs/inventory/stock_take.md`
- `specs/inventory/adjustment.md`
- `specs/inventory/low_stock.md`

### Tasks

- [ ] Add inventory page.
- [ ] Add stock view.
- [ ] Add stock take endpoint.
- [ ] Add manual adjustment endpoint.
- [ ] Add low-stock threshold.
- [ ] Add low-stock dashboard widget.
- [ ] Add stock adjustment modal.
- [ ] Add stock take wizard.
- [ ] Add inventory audit logging.
- [ ] Add inventory BDD tests.

## Sprint 8 — Reporting v1

### Goal

Owner can understand basic sales performance.

### Required Specs

- `specs/reports/range.md`
- `specs/reports/payment_breakdown.md`
- `specs/reports/top_products.md`

### Tasks

- [ ] Add report service.
- [ ] Add date range aggregation.
- [ ] Add payment breakdown query.
- [ ] Add top products query.
- [ ] Add timezone handling.
- [ ] Add reporting indexes.
- [ ] Add reports UI.
- [ ] Add charts.
- [ ] Add CSV export if feasible.
- [ ] Add oracle aggregation tests.
- [ ] Add employee-scope permission tests.

## Sprint 9 — Billing: Standard Plan

### Goal

Make the product sellable through a single $299 MXN/month subscription plan.

### Required Specs

- `specs/billing/standard_plan.md`
- `specs/billing/checkout.md`
- `specs/billing/webhooks.md`
- `specs/billing/past_due.md`
- `specs/billing/cancellation.md`

### Tasks

- [ ] Create subscriptions table.
- [ ] Create webhook_events table.
- [ ] Add Stripe Checkout integration.
- [ ] Add Stripe Billing integration.
- [ ] Add webhook signature verification.
- [ ] Add webhook idempotency.
- [ ] Add subscription status model.
- [ ] Add billing settings page.
- [ ] Add past_due banner.
- [ ] Add grace period logic.
- [ ] Add cancellation flow.
- [ ] Add internal/admin subscription visibility.
- [ ] Ensure Standard Plan price is $299 MXN/month.
- [ ] Remove/defer plan-based feature gates.
- [ ] Add billing BDD tests.

## Sprint 10 — Bakery Preset + Tenant Settings + Onboarding

### Goal

A bakery/small food retail tenant can self-onboard and start selling faster.

### Required Specs

- `specs/onboarding/bakery_preset.md`
- `specs/settings/tenant_settings.md`
- `specs/onboarding/first_sale.md`

### Tasks

- [ ] Create tenant_settings table.
- [ ] Create location_settings table if needed.
- [ ] Add preset loader.
- [ ] Add `presets/bakery.json`.
- [ ] Add onboarding flow.
- [ ] Add settings page.
- [ ] Add business profile form.
- [ ] Add locale/currency/timezone wiring.
- [ ] Add first-sale checklist.
- [ ] Add preset BDD tests.
- [ ] Add settings audit tests.

## Sprint 14 — Beta Hardening

### Goal

Prepare the product for 3 friendly beta tenants.

### Required Specs

- `specs/security/rate_limit.md`
- `specs/security/headers.md`
- `specs/ops/backups.md`
- `specs/ops/monitoring.md`
- `specs/support/beta_support.md`

### Tasks

- [ ] Add rate limiting.
- [ ] Add CSP.
- [ ] Add HSTS.
- [ ] Verify secure cookies.
- [ ] Lock down CORS.
- [ ] Configure backups.
- [ ] Execute restore drill.
- [ ] Add status page or status process.
- [ ] Add uptime monitor.
- [ ] Configure Sentry alerts.
- [ ] Add support email/process.
- [ ] Add feedback widget.
- [ ] Add help center starter docs.
- [ ] Add beta agreement.
- [ ] Run dependency audit.
- [ ] Run basic load test.
- [ ] Complete beta checklist.

## Closed Beta

### Goal

Run the product with 3 friendly tenants.

### Commercial Beta Model

- 3 friendly tenants.
- Standard Plan at $299 MXN/month.
- Optional temporary beta discount, but official price remains visible.
- Founder-assisted onboarding is acceptable.
- Written feedback agreement.
- Weekly feedback session.
- Manual support channel.
- Clear beta disclaimer.
- No long-term contract.

### Success Criteria

- Tenant completes first sale without engineering intervention.
- Tenant uses the POS for at least 5 business days.
- No data-loss incidents.
- Offline sync works in at least one real or simulated outage.
- Owner checks reports at least once.
- Tenant is willing to continue paying after beta.
- Support can diagnose incidents using logs/Sentry.
- No P0 bugs remain open.

---

## Remaining Backlog

Sprints 16 through 22 are defined below in execution order.

Sprint 15 (Modifiers) is done and documented in `docs/current-sprint.md`.

Production review on 2026-05-17 created a pre-beta repair backlog (PB-1..PB-7). PB-1..PB-5 and
PB-7 are closed; PB-6 (analytics credibility) is the only remaining piece. Carry-over items
are listed in `docs/current-sprint.md`. A second UX review on 2026-05-19
(`docs/ux-review-2026-05-19.md`) defined the next visual-trust sprint.

Pre-beta ops tasks (Sentry DSN, backup drill, uptime monitor, support channel) must be completed
before the first beta tenant is onboarded. They are tracked in `docs/current-sprint.md` and are
not a numbered sprint — they are operational work that can run in parallel with Sprint 16.

---

## Sprint 16 — UX Polish + Onboarding + Mobile Hardening

### Goal

Make the product feel premium, mobile-ready, and immediately understandable for a new beta tenant.
A first-time user should be able to sign up, understand what to do next, and complete a first sale
without engineering assistance. The register must work correctly on a tablet browser.

### Product Outcome

- New tenants see a guided onboarding checklist on first login.
- The register works naturally on iPad/tablet and mobile browser.
- Category filter pills show readable names.
- Payment method selection uses a touch-friendly button group.
- Cashiers see a "Smart card pick" teaser when selecting card payment.
- The dashboard communicates daily performance clearly with differentiated visual cues.
- All hardcoded English strings are removed from JSX and live in `i18n/messages.ts`.

### Status

Closed 2026-05-14 for the items below. Remaining open items (onboarding spec, dashboard trend
comparison, orders search/filter, i18n audit, mobile QA at 375 px) were rolled into the PB-1..PB-7
backlog and the UX trust backlog. Do not plan from the "Remaining Tasks" list below — it is kept
for history; pull current state from `docs/current-sprint.md`.

Items shipped on 2026-05-14:

- [x] Mobile responsive sidebar with hamburger toggle and backdrop overlay
- [x] Mobile sticky top bar (logo + business name + hamburger)
- [x] Fix category pills — now load real category names in sort order
- [x] Replace payment `<select>` with touch-friendly 3-button picker (Cash / Transfer / Card)
- [x] Card recommendation stub (amber callout when Card is selected)
- [x] Dashboard KPI cards — distinct icon colors per metric (emerald / blue / violet / rose)
- [x] Dashboard — all hardcoded strings moved to `copy.dashboard.*`
- [x] Dashboard — locale uses `navigator.language` instead of hardcoded `"en"`
- [x] AppShell — fixed broken ChevronRight hover (was missing `group` class on NavLink)
- [x] Color token upgrade in `styles.css` (richer primary, deeper sidebar, cleaner background)

### Remaining Tasks

#### Onboarding

- [ ] Write Feature Spec: `specs/onboarding/first_sale.md`
- [ ] Write BDD scenarios: `specs/onboarding/first_sale.feature`
  - Given a new tenant signs up and has no products, When they reach the dashboard, Then a setup checklist is shown (Create catalog → Open shift → Make first sale).
  - Given a tenant has completed all checklist items, When they visit the dashboard, Then the checklist is hidden.
- [ ] Create `tenant_onboarding_state` table with completed step flags (tenant-scoped, RLS).
- [ ] Add `PATCH /api/v1/onboarding/steps/{step}` to mark steps complete.
- [ ] Add `GET /api/v1/onboarding/state` to fetch current checklist state.
- [ ] Add onboarding checklist component to `DashboardView`.
  - Steps: Add first product → Open first shift → Complete first sale.
  - Each step links to the relevant page.
  - Progress bar or step-completion badges.
  - Auto-dismiss when all steps are done.
- [ ] Write E2E test: new tenant flow — signup → dashboard shows checklist → first sale → checklist hidden.
- [ ] Add audit log event `onboarding.step.completed`.

#### Register — Stock Indicators

- [ ] Write Feature Spec: `specs/register/stock_indicators.md`
- [ ] Extend register load: call `listInventory()` in parallel with products and categories.
- [ ] Build `stockMap: Map<string, number>` (product_id → quantity_on_hand).
- [ ] Show "Low" badge on product card when `quantity_on_hand <= low_stock_threshold` and `track_inventory === true`.
- [ ] Show product card as visually muted (not disabled) when stock is 0 and `track_inventory === true`.
- [ ] Confirm: adding an out-of-stock item still enqueues the sale (backend validates on order creation).
- [ ] Add unit test for stock badge rendering logic.

#### Dashboard — Trend Comparison

- [ ] Write Feature Spec: `specs/dashboard/trend_comparison.md`
- [ ] Extend `getSalesSummary` to accept two date ranges (today + yesterday).
- [ ] Add `GET /api/v1/reports/summary?start=&end=` already exists — call it twice in parallel.
- [ ] Compute delta: `(today - yesterday) / yesterday * 100`.
- [ ] Add delta badge to each KPI card: green arrow up / red arrow down / grey flat.
- [ ] Handle zero-yesterday gracefully (show "—" instead of ∞%).
- [ ] Add unit test for delta computation logic.

#### Orders — Search and Filter

- [ ] Write Feature Spec: `specs/orders/order_list_filter.md`
- [ ] Add `start_date`, `end_date`, `status`, and `search` (order ID prefix) query params to `GET /api/v1/orders`.
- [ ] Add filter bar to `OrderListView`:
  - Date range picker (start / end).
  - Status dropdown (All / Completed / Voided).
  - Search input (order ID or amount).
- [ ] Add debounced search (300 ms).
- [ ] Add filter reset button.
- [ ] Add unit tests for filter query construction.
- [ ] Add E2E test: filter by date range returns expected results.

#### i18n Audit

- [ ] Audit all remaining views (`InventoryView`, `ShiftView`, `ReportsView`, `OrderDetail`, `BillingView`, `OrderListView`, `SyncQueueView`, `CatalogView`) for hardcoded English strings.
- [ ] Move any found strings into `copy.*` sections in `messages.ts`.
- [ ] Confirm `OrderListView` date uses `navigator.language` (currently hardcodes `"es-MX"`).
- [ ] Confirm all error/empty/loading strings are in the copy object.

#### Mobile Layout QA

- [ ] Test register on 375 px (iPhone SE), 768 px (iPad portrait), and 1024 px (iPad landscape).
- [ ] Ensure product grid is scrollable without horizontal overflow on mobile.
- [ ] Ensure cart and payment panel stack below product grid on single-column layout.
- [ ] Ensure touch targets ≥ 44 px on all interactive elements (product cards, quantity buttons, payment method buttons).
- [ ] Fix any z-index conflicts between the mobile top bar and Card components.
- [ ] Add Playwright viewport test for register flow at 375 px.

### Definition of Done

- Onboarding checklist renders for new tenants and clears on completion.
- Register works on iPad and mobile — no horizontal scroll, no overlapping elements.
- Category pills show readable names in all cases.
- Dashboard shows vs-yesterday delta on all KPIs.
- Orders list has functional date + status filter.
- Zero hardcoded English strings remain in JSX across all views.
- All new paths covered by unit or E2E tests.
- `npx tsc --noEmit` passes clean.

---

## Sprint 17 — Tax Engine

### Goal

Tenant owners can configure tax rates. The pricing calculator applies them correctly to every sale,
receipt, and report. Tax behavior is explicit, auditable, and passes money golden tests.

### Product Outcome

- Owner configures one or more tax rates (e.g. IVA 16%, reduced 8%).
- Tax can be tax-inclusive (price includes tax) or tax-exclusive (tax added on top).
- Each product or category can be assigned a tax rate.
- Receipts show line-item tax breakdown.
- Reports include a net vs. gross vs. tax breakdown.
- Tax round-half-up on each line, no float arithmetic anywhere.

### Required Specs

- `specs/tax/tax_rates.md`
- `specs/tax/tax_calculation.md`
- `specs/tax/receipt_tax.md`

### Data Model

- [ ] Create `tax_rates` table: `id`, `tenant_id`, `name`, `rate` (Decimal), `is_inclusive`, `is_active`.
- [ ] Create `product_tax_rates` join table: `product_id`, `tax_rate_id`.
- [ ] Create `category_tax_rates` join table: `category_id`, `tax_rate_id` (fallback if product has no rate).
- [ ] Add RLS policies on all tax tables.
- [ ] Write Alembic migration; document rollback.
- [ ] Extend `order_items` with `tax_rate_id`, `tax_amount` (Decimal string).
- [ ] Extend `payments` with `tax_total` (Decimal string) on the order level.

### Backend

- [ ] Add tax rate CRUD: `POST`, `GET`, `PATCH`, `DELETE /api/v1/tax-rates`.
- [ ] Add product tax assignment endpoint: `PUT /api/v1/catalog/products/{id}/tax-rate`.
- [ ] Add category tax assignment endpoint: `PUT /api/v1/catalog/categories/{id}/tax-rate`.
- [ ] Extend pricing calculator to resolve effective tax rate per line item (product rate → category rate → no tax).
- [ ] Implement tax-inclusive: `tax = price * rate / (1 + rate)`, `base = price - tax`.
- [ ] Implement tax-exclusive: `tax = base * rate`, `line_total = base + tax`.
- [ ] Round each line tax with `round_half_up` (Decimal, 2 places).
- [ ] Extend order creation payload to accept and persist tax breakdown.
- [ ] Extend reports aggregation to include `tax_total` column.
- [ ] Add `tax.configure` and `tax.assign` RBAC permissions (owner only).
- [ ] Add audit log for `tax.rate.create`, `tax.rate.update`, `tax.rate.deactivate`.
- [ ] Extend idempotency key coverage to order creation with tax.

### Frontend

- [ ] Add Tax Rates section to settings (new `SettingsView` or extend catalog area).
  - List tax rates with name, rate %, inclusive/exclusive badge.
  - Create / edit modal with name, rate, inclusive toggle.
  - Deactivate with confirmation.
- [ ] Add tax rate selector to product create/edit form in `CatalogView`.
- [ ] Add tax rate selector to category create/edit form.
- [ ] Show tax breakdown on receipt in `OrderDetail`:
  - Sub-total (before tax).
  - Tax name + amount.
  - Total (after tax).
- [ ] Show tax breakdown in `ReportsView` (tax collected column).
- [ ] Add i18n strings for all tax copy.

### Tests

- [ ] BDD: `specs/tax/tax_calculation.feature`
  - Tax-exclusive: $100 + 16% IVA = $116 total, $16 tax.
  - Tax-inclusive: $116 price at 16% → base $100, tax $16.
  - Zero tax rate: no tax line on receipt.
  - Mixed: two lines, one taxed, one not.
- [ ] Golden tests: `test_tax_money.py` — exact Decimal assertions for each scenario.
- [ ] Tenant isolation: tenant A cannot read tenant B's tax rates.
- [ ] Permission test: cashier cannot create or modify tax rates.
- [ ] E2E: complete sale with tax → receipt shows correct tax breakdown.

### Definition of Done

- Tax rates configurable per tenant.
- Pricing calculator applies correct rate per line with no float arithmetic.
- Receipts show sub-total, tax, total breakdown.
- Reports include tax column.
- All golden tests pass.
- Rollback migration documented.

---

## Sprint 18 — Discounts

### Goal

Cashiers can apply a discount to individual line items or the entire order. Every discount requires
a reason and is recorded in the audit log. Managers can restrict discount depth with a permission gate.

### Product Outcome

- Cashier selects a cart item and applies a flat or percentage discount.
- Cashier applies an order-level discount (applied after line totals).
- Manager can configure maximum discount percentage per role.
- Discount appears as a separate line on receipts and in reports.
- Discounts are audited with user, reason, and amount.

### Required Specs

- `specs/discounts/line_discount.md`
- `specs/discounts/order_discount.md`
- `specs/discounts/discount_limits.md`

### Data Model

- [ ] Add `discount_type` (`flat` | `pct`), `discount_value` (Decimal), `discount_reason` columns to `order_items`.
- [ ] Add `order_discount_type`, `order_discount_value`, `order_discount_reason` columns to `orders`.
- [ ] Write Alembic migration; document rollback.
- [ ] Extend pricing calculator to apply line discount before tax, order discount after line subtotals.

### Backend

- [ ] Add `DISCOUNT_APPLY` RBAC permission (cashier and above by default).
- [ ] Add `DISCOUNT_ABOVE_X_PCT` configurable permission or setting (deferred for v1 — hardcode to 50% max).
- [ ] Extend order creation endpoint to accept `discount_type` + `discount_value` + `discount_reason` per line and at order level.
- [ ] Add validation: discount cannot reduce line total below $0.
- [ ] Add validation: percentage discount max 100%.
- [ ] Extend pricing calculator: apply line discount first, then apply order discount to adjusted subtotal, then tax.
- [ ] Add audit log event `order.discount.applied` with amount, reason, user.
- [ ] Extend receipt serializer to show discount lines.
- [ ] Extend reports to include `discount_total` column in summary.

### Frontend

- [ ] Add discount control to each cart item in `RegisterView`:
  - Small "%" icon button opens a discount popover.
  - Input: type (flat / %) + amount + reason (required).
  - Show applied discount as a struck-through original price + discount badge.
- [ ] Add order-level discount section at the bottom of the cart (above total):
  - Same type / amount / reason inputs.
  - Show calculated discount line in the total breakdown.
- [ ] Update total breakdown to show: subtotal → line discounts → order discount → tax → total.
- [ ] Show discount lines on receipt in `OrderDetail`.
- [ ] Show discount total in `ReportsView` summary cards.
- [ ] Add i18n strings for all discount copy.

### Tests

- [ ] BDD: `specs/discounts/line_discount.feature`
  - Flat $10 off $50 item → line total $40.
  - 20% off $50 item → line total $40.
  - Line discount + tax: tax applies to post-discount price.
- [ ] BDD: `specs/discounts/order_discount.feature`
  - 10% order discount on $100 subtotal → $90 total.
  - Order discount + tax.
- [ ] Golden tests: `test_discount_money.py`.
- [ ] Permission test: unauthenticated user cannot apply discount.
- [ ] Audit log test: discount event recorded with correct fields.
- [ ] E2E: apply line discount → receipt shows discount line.

### Definition of Done

- Line and order discounts work with flat and percentage modes.
- Reason is required and audited.
- Discounts never produce negative line totals.
- Receipts and reports reflect discounts correctly.
- All golden tests pass.

---

## Sprint 19 — Retail Preset + Advanced Inventory

### Goal

Retail tenants (general merchandise, small stores) can self-onboard using a preset that reflects
their workflow. Barcode/SKU input speeds up checkout. Stock history is auditable.

### Product Outcome

- A new "Retail" preset appears during onboarding with a sample catalog (electronics accessories, clothing sizes, snacks).
- Cashier can scan or type a SKU/barcode to add a product directly to the cart.
- Inventory view shows a full movement history per product.
- Low-stock report is available as a dedicated view.

### Required Specs

- `specs/onboarding/retail_preset.md`
- `specs/register/barcode_input.md`
- `specs/inventory/movement_history.md`
- `specs/inventory/low_stock_report.md`

### Tasks

#### Retail Preset

- [ ] Create `presets/retail.json` with sample categories: Electronics Accessories, Clothing, Food & Snacks.
- [ ] Create `presets/retail_products.json` with 10–15 sample products including SKUs.
- [ ] Add preset selection step to onboarding flow (Bakery / Retail / Blank).
- [ ] Add preset loader endpoint `POST /api/v1/onboarding/apply-preset`.
- [ ] Preset loader is idempotent (safe to call multiple times; skips if catalog already has products).
- [ ] Add BDD: preset applies correctly, all products are tenant-scoped, SKUs are set.
- [ ] Verify no hardcoded vertical assumptions remain in the pricing or register code.

#### Barcode / SKU Input

- [ ] Add a SKU/barcode search input to the top of the product grid in `RegisterView`.
- [ ] On input change (debounced 150 ms), filter products by exact SKU match first, then name prefix.
- [ ] If exactly one product matches the SKU, auto-add it to cart and clear the input.
- [ ] If multiple matches, show a dropdown with matches; user selects one.
- [ ] If no match, show "No product found for SKU: X" inline message.
- [ ] Support keyboard-only entry (barcode scanner emulates keyboard; Enter adds to cart).
- [ ] Add unit test for SKU match logic.
- [ ] Add E2E test: type SKU → product auto-added to cart.

#### Stock Movement History

- [ ] Add `movement_type` column to `inventory_movements` if not present: `sale` | `refund` | `void` | `manual_adjustment` | `stock_take`.
- [ ] Add `GET /api/v1/inventory/{product_id}/movements` paginated endpoint.
- [ ] Add movement history panel to `InventoryView` (expandable per product row).
- [ ] Show: date, movement type, delta, new quantity, performed by, reason.
- [ ] Add unit test for movement history query.

#### Low-Stock Report

- [ ] Add `GET /api/v1/inventory/low-stock` endpoint: returns products where `quantity_on_hand <= low_stock_threshold AND track_inventory = true`, ordered by urgency (quantity / threshold ratio asc).
- [ ] Add Low Stock tab or section to `InventoryView` and `ReportsView`.
- [ ] Show product name, current stock, threshold, suggested reorder quantity.
- [ ] Add "Export to CSV" button for the low-stock list.
- [ ] Add unit test for low-stock query.

### Definition of Done

- Retail preset applies without errors and creates a usable sample catalog.
- SKU input correctly finds and adds products.
- Movement history is visible per product.
- Low-stock report shows the correct filtered list.
- All new endpoints are tenant-scoped with permission checks and audit logs.

---

## Sprint 20 — Restaurant Preset

### Goal

Restaurant tenants can self-onboard with a preset and use the POS for a modifier-heavy table-service
workflow, including item notes per line and a kitchen view placeholder.

### Product Outcome

- "Restaurant" preset available during onboarding (Pizza, Burgers, Drinks categories with modifier groups).
- Cashiers can attach a free-text note to any cart item (e.g. "no onion", "extra sauce").
- Receipt and order detail show item notes.
- Foundation for KDS (Kitchen Display System) is in place — not a screen, just the data hook.

### Required Specs

- `specs/onboarding/restaurant_preset.md`
- `specs/register/item_notes.md`
- `specs/kds/kds_data_hook.md`

### Tasks

#### Restaurant Preset

- [ ] Create `presets/restaurant.json`: categories (Starters, Mains, Drinks, Desserts), sample products with modifier groups (size, extras).
- [ ] Add "Restaurant" option to preset selection step in onboarding.
- [ ] Preset loader creates modifier groups and assigns them to products.
- [ ] Add BDD: restaurant preset applies, modifier groups are accessible in register.
- [ ] Verify modifier modal works correctly with the preset-created groups.

#### Item Notes

- [ ] Add `note` (text, nullable) column to `order_items`. Alembic migration.
- [ ] Add note input to cart item in `RegisterView` (small "📝 Add note" link → inline text input).
- [ ] Note is included in order creation payload.
- [ ] Receipt / `OrderDetail` shows note beneath the product name (indented, muted).
- [ ] Note max length: 200 characters.
- [ ] Add unit test for note persistence on order creation.
- [ ] Add E2E test: add note → order created → note visible in order detail.

#### KDS Data Hook

- [ ] Add `kitchen_status` column to `orders`: `none` | `pending` | `in_progress` | `ready`. Default `none`.
- [ ] Add `PATCH /api/v1/orders/{id}/kitchen-status` endpoint (manager / owner only).
- [ ] Do not build a KDS screen in this sprint — data layer only.
- [ ] Document KDS screen as a deferred Sprint 23+ item in `docs/deferred-scope.md`.

### Definition of Done

- Restaurant preset creates a usable menu with modifier groups.
- Item notes are stored and displayed correctly.
- `kitchen_status` column exists and is patchable.
- No KDS UI introduced in this sprint.

---

## Sprint 21 — GA Hardening

### Goal

The product is ready for public launch. Legal documents are live, the marketing site is live,
the help center has enough articles for self-service, and the product passes a security review
and load test.

### Product Outcome

- Public signup available from the marketing site.
- Terms of Service, Privacy Policy, and DPA are linked at signup and in the app footer.
- Help center covers all north star flow steps with at least 30 articles.
- Product survives a 100 concurrent user load test without errors.
- WCAG AA accessibility pass on the register and dashboard.
- Status page is public and tied to uptime monitors.

### Required Specs

- `specs/legal/tos.md`
- `specs/legal/privacy_policy.md`
- `specs/marketing/marketing_site.md`
- `specs/ops/slos.md`
- `specs/ops/ga_checklist.md`

### Tasks

#### Legal

- [ ] Draft Terms of Service (MX jurisdiction, Spanish + English).
- [ ] Draft Privacy Policy (LFPDPPP compliant for MX; GDPR-ready for future).
- [ ] Draft DPA template for enterprise use (can be a stub at GA).
- [ ] Add ToS + Privacy Policy links to signup form (`AuthView`).
- [ ] Add ToS + Privacy Policy links to app footer.
- [ ] Add cookie banner if analytics or tracking cookies are used.
- [ ] Add "delete my account" flow or document data deletion process.

#### Marketing Site

- [ ] Build or deploy marketing site at root domain (separate repo or sub-path).
- [ ] Pages: Home, Features, Pricing ($299 MXN/month — Standard Plan), FAQ, Contact.
- [ ] Public Stripe Checkout link / embedded button on pricing page.
- [ ] SEO meta tags and OpenGraph images.
- [ ] Mobile-responsive.

#### Help Center

- [ ] Set up help center tool (Notion public page, HelpScout Docs, or Crisp).
- [ ] Write 30 articles covering:
  - Getting started (signup, business setup, first product, first sale).
  - Register (products, cart, payment methods, split payment, offline mode).
  - Catalog (categories, products, modifiers, images).
  - Inventory (stock tracking, adjustments, low-stock alerts).
  - Shifts (open, cash movements, close, reconciliation).
  - Reports (date ranges, payment breakdown, top products, export).
  - Billing (how to subscribe, past due, cancel, resume).
  - Cards (add card, benefit rules, checkout recommendation).
  - Security (passwords, sessions, logout all).
  - Troubleshooting (offline sync, receipt not showing, billing issues).
- [ ] Link help center from app (? icon or "Help" nav item).

#### Accessibility

- [ ] Run axe / Lighthouse accessibility audit on Register and Dashboard.
- [ ] Fix all WCAG AA failures (target: 0 critical, 0 serious violations).
- [ ] Verify color contrast ≥ 4.5:1 on all body text using updated color tokens.
- [ ] Verify all form inputs have visible labels (no placeholder-only labels).
- [ ] Verify keyboard navigation works across register, cart, and payment flows.
- [ ] Verify screen reader announces toast messages via `aria-live`.
- [ ] Verify modal focus management (focus traps, restore on close).

#### Security Review

- [ ] Run `npm audit` — zero high/critical in production deps.
- [ ] Run `uv pip audit` (or `safety check`) — zero high/critical.
- [ ] Review OWASP Top 10 checklist for each API layer.
- [ ] Verify CSP headers block inline scripts.
- [ ] Verify HSTS is enforced in production.
- [ ] Verify all cookies are `Secure; HttpOnly; SameSite=Lax`.
- [ ] Verify no tenant data leaks in error responses.
- [ ] Pen test: attempt cross-tenant data access via API — confirm 403/404.
- [ ] Review Sentry for any data leakage in error payloads.
- [ ] Rotate all secrets; verify no secrets in git history.

#### Load Testing

- [ ] Write k6 or Locust load test scripts covering:
  - 100 concurrent users: `POST /api/v1/orders` (cash sale).
  - 50 concurrent users: `GET /api/v1/catalog/products`.
  - 20 concurrent users: `GET /api/v1/reports/summary`.
- [ ] Target: p95 < 500 ms, p99 < 1 s, 0 errors at 100 concurrent.
- [ ] Fix any bottlenecks found (missing indexes, N+1 queries).
- [ ] Document load test results in `docs/risk-register.md`.

#### SLOs + Status Page

- [ ] Define SLOs: uptime 99.5%, p95 API latency < 500 ms, error rate < 0.1%.
- [ ] Wire UptimeRobot (or equivalent) to public status page.
- [ ] Status page shows: API, Frontend, Database, Billing (Stripe).
- [ ] Configure PagerDuty or email alerting for SLO breaches.

#### GA Checklist

- [ ] All beta tenant issues closed or documented.
- [ ] Zero open P0 bugs.
- [ ] Migration rollback plan documented for all migrations since beta.
- [ ] Data export process documented (tenant off-boarding).
- [ ] Run full BDD suite: all scenarios pass.
- [ ] Run full E2E suite: all scenarios pass.
- [ ] Production smoke test: complete a sale end-to-end on production.

### Definition of Done

- ToS and Privacy Policy live and linked.
- Marketing site live with public checkout.
- Help center has ≥ 30 articles.
- Accessibility: 0 WCAG AA critical/serious violations on register + dashboard.
- Load test: p95 < 500 ms at 100 concurrent users.
- Security review: 0 high/critical vulnerabilities.
- Status page live and tied to monitors.
- GA checklist 100% checked.

## Beta-Ready Checklist

### Product

- [ ] Tenant can sign up.
- [ ] Tenant can subscribe or start trial.
- [ ] Tenant can configure business settings.
- [ ] Tenant can create catalog.
- [ ] Cashier can open shift.
- [ ] Cashier can complete sale.
- [ ] Cash/manual payment flows work.
- [ ] Receipt is available.
- [ ] Offline sales are not lost.
- [ ] Failed offline sales are recoverable.
- [ ] Refunds/voids are available.
- [ ] Cash refunds affect active shift reconciliation through a `cash_movement`.
- [ ] Inventory decrement works.
- [ ] Shifts can be closed.
- [ ] Owner can see daily/range sales.
- [ ] Reports use tenant-local dates for "today" and related presets.
- [ ] Order detail can reprint a real receipt.
- [ ] Trial tenants see a concrete value recap before conversion.
- [ ] No known P0 bugs open.

### Technical

- [ ] Alembic migrations only.
- [ ] Tenant isolation tests pass.
- [ ] RLS policies applied where needed.
- [ ] Auth/session tests pass.
- [ ] Write endpoint invariants pass.
- [ ] Money golden tests pass.
- [ ] Offline sync tests pass.
- [ ] Reports timezone regression tests pass for Mexico City after business close.
- [ ] Shift localization regression covers enum labels and es-MX date/time display.
- [ ] No committed secrets.
- [ ] No critical/high vulnerabilities.
- [ ] Structured logs exist.
- [ ] Sentry exists.
- [ ] Backend full test gate passes on the release commit with a reachable Postgres.
- [ ] Backend local test/run instructions are verified for Windows using `.venv-win`.
- [ ] Cookie-auth CSRF posture is documented; missing/invalid CSRF tests cover state-changing
      endpoints or the controlled-beta risk is explicitly accepted.
- [ ] Rate limiting covers auth, password reset, sync, uploads, and billing abuse paths with a
      production-safe strategy or an explicitly accepted controlled-beta limitation.
- [x] Onboarding billing checklist state correctly reflects active/trialing/paid-grace access.

### Billing

- [ ] Standard Plan exists in Stripe.
- [ ] Standard Plan price is $299 MXN/month.
- [ ] Checkout works.
- [ ] Webhooks are idempotent.
- [ ] Active subscription unlocks normal access.
- [ ] past_due behavior works.
- [ ] Grace period works.
- [ ] Cancellation works.
- [ ] Stripe live checkout is verified end-to-end before broad selling.
- [ ] Trial-ending reminder email is verified.
- [ ] Post-checkout welcome/billing email is verified against Gmail, Outlook, and Hotmail.
- [ ] Production email configuration cannot silently skip required billing/auth lifecycle emails.
- [ ] Email provider failures are logged/alerted without leaking PII.

### Data

- [ ] Backups configured.
- [ ] Restore drill completed.
- [ ] Production hygiene scripts for negative stock, category accents, and missing SKUs have been run and documented.
- [ ] Audit logs are append-only or protected.
- [ ] Tenant data export plan documented.
- [ ] Data retention after cancellation is documented.

### Support

- [ ] Support email/channel ready.
- [ ] In-app Help path exists or the interim support path is visible from authenticated screens.
- [ ] Domain-support path is planned or active (`soporte@kova.mx` preferred over generic Gmail).
- [ ] `/seguridad` page or equivalent public trust page is live and linked from public trust
      surfaces.
- [ ] Support intake process captures tenant, user, request_id, severity, screenshot/context, and
      expected response time.
- [ ] Basic runbooks exist.
- [ ] Feedback process exists.
- [ ] Beta agreement ready.

### UX

- [ ] Register usable on tablet.
- [ ] Loading states exist.
- [ ] Empty states exist.
- [ ] Error states exist.
- [ ] Offline states exist.
- [ ] Locale formatting verified for es-MX.
- [ ] `/shifts` has no raw English backend enum labels in visible UI.
- [ ] Landing/footer trust links do not point to placeholders.
- [ ] Production bundle size/performance warning is reviewed and either remediated or accepted with
      a target follow-up sprint.

## GA-Ready Checklist

Adds to beta:

- [ ] Modifiers complete if restaurant support is included.
- [ ] Tax engine complete if needed for target market.
- [ ] Discounts complete.
- [ ] Retail preset complete.
- [ ] Restaurant preset complete only if modifiers are stable.
- [ ] Help center has 30+ articles.
- [ ] Marketing site live.
- [ ] Terms of Service complete.
- [ ] Privacy Policy complete.
- [ ] Cookie banner if needed.
- [ ] Security review complete.
- [ ] Load test complete.
- [ ] Accessibility pass complete.
- [ ] Status page tied to monitors.
- [ ] Public Stripe checkout from marketing site.
- [ ] CSRF protection is implemented and tested for cookie-auth state-changing endpoints.
- [ ] Rate limiting uses a production-safe strategy across multiple app instances.
- [ ] Email deliverability and provider monitoring are proven in production-like conditions.
- [ ] Frontend route/code splitting is implemented where needed to meet mobile first-load targets.
- [ ] Beta tenants migrated without data migration.
