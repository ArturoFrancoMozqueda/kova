# KOVA — Functionality & UX / Customer-Experience Audit

**Date:** 2026-07-07
**Branch:** `feature/full-audit-plan` (frontend == reports redesign; backend == `main`)
**Companion:** `KOVA-COMPLETE-AUDIT.md` (engineering/security/data-integrity). This document is the dedicated **functionality + customer-experience** pass; it preserves and cross-references that audit's findings and does not repeat its billing/RLS/offline-correctness detail.

## 1. Executive assessment

Kova is not a prototype. Traced UI → API → service and driven live end-to-end on the local stack (real signup → verify → login → catalog → inventory → shift → cash sale → split sale → partial refund → reports/dashboard with data), it behaves like a polished, shippable paid SaaS. **Every feature exposed in the navigation is backed end-to-end** — there are no dead ends, no UI-only stubs, no nav item that opens an empty screen, and dev-only routes are correctly gated. Empty states are excellent and action-oriented, onboarding is a real 7-step guided path, the reports engine produces genuinely useful plain-language insights from real data ("Latte necesita reabasto pronto ≈14 días"; net sales correctly refund-adjusted to $180 after a $45 refund on $225 of sales), and the responsive strategy is deliberate (dual card/table layouts, bottom-sheet POS, off-canvas + bottom-tab mobile nav). This materially **upgrades** the original audit's UX "skim": inventory UX and reports-with-data, which were previously Not/Partially analyzed, are in fact among the product's strengths.

The gaps are narrower and more specific than "it's rough." They cluster in four areas:

1. **Daily-operations completion (P1):** there is **no corte-de-caja printout** on shift close and **no one-tap receipt at the register** after a sale (the cashier must navigate to the order detail to print), and **customer email capture + emailed receipts are entirely absent** (both UI and backend). These are the everyday moments a cashier and owner touch dozens of times a day.
2. **Accessibility & destructive-action safety (P1):** the shared modal (`components/ui/dialog.tsx`) has **no focus trap, no initial focus, no focus restore, no `aria-labelledby`** — affecting every money-critical modal (Refund, Void, Close-shift, Cancel-subscription). Several destructive actions (deactivate product/category/modifier/employee, **change employee role**) fire immediately with **no confirmation**. VoidModal shows **raw English enum reasons** ("operator error"), breaking es-MX.
3. **Top-of-funnel blindness (P1 commercial):** the landing page fires **zero** analytics and the telemetry sink requires an authenticated session, so visit → CTA → signup is unmeasurable — activation and conversion cannot be optimized. One landing **overclaim** ("qué productos te dejan mejor margen") is not deliverable (no cost/margin data exists), and the pricing card name ("Plan Kova") doesn't match the product ("Plan Standard").
4. **State & responsive polish (P2):** no distinct 404/409 states; data views lack a local subscription-inactive state; two report/shift tables lack a mobile card fallback; the offline indicator is hidden on phones.

**Verdict:** Kova is functionally sellable today for its intended beta scope. The above are the highest-leverage improvements to activation, daily usability, trust, and accessibility — none require a redesign. (Note: the revenue-integrity blocker for *paid* onboarding lives in the companion audit — billing lifecycle, `PLAN-01` — and is out of scope here.)

## 2. Methodology and limitations

- **Code tracing:** every finding is traced from the rendered component through its `api.ts` caller to the backend `router.py`/service. `file:line` cited from `frontend/src` and `backend/app`.
- **Live walkthrough:** local `docker compose` stack (frontend 5173, backend 8000). Two Playwright passes: (a) empty-account flow at desktop + iPhone-13; (b) **data-populated** flow (3 products incl. tracked low-stock, opened shift, cash sale, split sale, partial refund) captured at **1440 / 1024 / 768 / 390 / 360 px**. Screenshots in the session scratchpad (`shots/`, `shots2/`).
- **Limitations / Not verifiable from here:** the PWA service worker is disabled in `npm run dev`, so the cold-offline reload could only be confirmed at the code level (catalog is `NetworkOnly`, never cached) plus a blank-page dev reproduction; real Stripe checkout UX (hosted redirect) was not driven (test-mode, deferred); screen-reader behavior was assessed from ARIA attributes in code, not with an actual AT; color-contrast is flagged by inspection, not a measured audit; email deliverability not tested.
- **Personas:** **Owner** (Propietario — sets up, reads reports, pays) and **Cashier** (Cajero — rings sales all day). Findings tag the affected persona.

## 3. Functional inventory

Status legend: Fully functional / With limitations / Partial / UI-only / Backend-only / Broken / Not-exposed / Absent.

| Feature | Status | Evidence |
|---|---|---|
| Registration / email verification / login / logout | Fully functional | `auth/AuthView.tsx`, `auth/router.py:102`; live 201/200 |
| Password reset (full loop) | Fully functional | `ForgotPasswordView.tsx`, `ResetPasswordView.tsx`, `auth/router.py:173,190` |
| Session renewal / expiry | Fully functional | `auth/AuthContext.tsx:82-113` (silent refresh) |
| "Sign out everywhere" | Backend-only | `POST /auth/logout-all` exists, no UI caller |
| Account/tenant deletion, data export | Absent | no endpoint (compliance gap; companion S10) |
| Onboarding (checklist + presets + tours) | Fully functional | `dashboard` 0/7 checklist, `onboarding/router.py`, `FirstUseTour.tsx` |
| Product CRUD + image + reposition | Fully functional | `catalog/api.ts:90-138`, `image_router.py:128` |
| Modifiers CRUD + assign | Fully functional | `modifiers/router.py:34-184`, `ModifierSelectionModal.tsx` |
| Category CRUD | Fully functional | `catalog/router.py:32-88` |
| Inventory: stock, low-stock, velocity, adjust, stock-take, movements | Fully functional | `inventory/router.py:33-149`; live low-stock panel |
| Sale (cart, split payment, change, modifiers) | With limitations | works (`orders/router.py:55`); **no inline receipt at register** |
| Receipt view + print | With limitations | `OrderDetail.tsx:229` `window.print()`; **print only from order detail**, no email |
| Customer email capture + emailed receipt | Absent | no field in `RegisterView`, no backend endpoint |
| Refund (partial/full) / Void | Fully functional | `orders/router.py:101,145`, `RefundModal.tsx`, `VoidModal.tsx` |
| Shift open/close + cash in/out | Fully functional | `shifts/router.py:24-119`; live 201 |
| Corte de caja printout | Not-exposed | reconciliation on-screen only; no print |
| Employee invite → accept → role → deactivate | Fully functional | `employees/router.py:45-107`, `AcceptInviteView.tsx` |
| Reports (summary, story, payment mix, top products, by hour, by employee, refunds) | Fully functional | `reports/router.py:24-135`; live data |
| Dashboard (KPIs, next actions, recommendations) | Fully functional | `dashboard/DashboardView.tsx`; live insights |
| Billing (trial, checkout, cancel, subscription state) | Fully functional (UX); see companion for lifecycle correctness | `billing/*`, `PLAN-01` |
| Offline sale queue + sync-queue view | Fully functional (online-loaded); cold-offline broken | `offline/*`; companion D2 |
| Customers / Multi-location / Discounts / Taxes / Loyalty | Absent (intentionally deferred) | `docs/deferred-scope.md`; **not claimed on landing** |

## 4. End-to-end workflow results (traced + driven live)

All verdicts below were reproduced on the local stack unless noted.

- **Signup → verify → login → dashboard:** Fully functional. Owner lands on a dashboard with a 7-step onboarding checklist.
- **Create product → open shift → cash sale → split sale → partial refund:** Fully functional. Split payment (cash 50 + transfer 40 = 90) validated server-side; change computed for cash; refund restored stock and posted a cash `refund_payout`.
- **Reports/dashboard with data:** Fully functional. Net sales refund-adjusted ($180), ticket promedio $60, plain-language summary, prioritized recommendations, inventory velocity ("~63 días").
- **Employee invite:** Fully functional end-to-end in the UI (role cards, invite form, pending + active lists).
- **Sale → receipt:** With limitations — after a sale the register shows a success card + "ver orden" link; printing requires navigating to the order detail (no one-tap print, no email).
- **Shift close → corte:** With limitations — reconciliation shown on screen; no printable/emailable corte.
- **Cold-offline open:** Broken (companion D2) — catalog is `NetworkOnly`, never cached to IndexedDB; a cold offline load cannot show products or ring a sale.

## 5. Onboarding analysis

**Strength.** First login lands on the dashboard with a **"Deja tu cafetería lista para vender" 0/7 checklist**, each step deep-linking to the right screen: confirm business data → prepare receipt → create first product → activate stock → open shift → first sale (`03-after-login.png`). Catalog offers **industry presets** (Cafetería / Panadería / Comercio / Empezar vacío) plus a first-use tour; the register and reports have their own first-use tours. Empty states everywhere point to the next action.

**Time-to-first-sale (estimated):** signup (4 fields + terms) → verify (dev token locally; email in prod) → login → create product (or load a preset — one click) → open shift (opening cash) → ring sale. Roughly **6–8 deliberate steps**, all guided, no dead ends. **A non-technical owner can reach the first sale without help.** (F-ON-1)

**Gaps:**
- **F-ON-1 (P2, Likely):** email verification is a hard gate before first login (`auth/service.py:252`); in production a delayed/undelivered verification email blocks the entire onboarding. Companion flags email delivery as an ungated production risk. Mitigation: resend + clear "check spam" guidance + delivery monitoring.
- **F-ON-2 (P3, Confirmed):** the first-use tours re-appear per tenant on a fresh device (localStorage-keyed) — expected, minor.

## 6. POS usability analysis

**Strengths (Confirmed live + code):** offline-first submit (queues to IndexedDB then syncs), split payments with change calc, modifier modal, **keyboard shortcuts** (`/` search, `F2` cash, `Alt+1/2/3` payment method, `Ctrl/⌘+Enter` submit — `RegisterView.tsx:332-360`), 44px cart steppers, and a clear **"No hay turno abierto — los cobros en efectivo están bloqueados"** banner (`08-register.png`). Mobile POS is a fixed bottom-sheet cart with a product grid; renders cleanly at 360px.

**Findings:**
- **F-POS-1 (P1, Confirmed) — no receipt at the register.** After a completed sale the register shows only a success card + link to `/orders/:id` (`RegisterView.tsx:1272-1361`); to print the customer's ticket the cashier must leave the register. On a busy line this is friction on every sale. Persona: Cashier. Workflow: checkout. → PLAN-UX-02.
- **F-POS-2 (P2, Confirmed) — split-payment rows cramped at 360px** inside the bottom sheet (`RegisterView.tsx:964-1085`); usable (sheet scrolls) but tight. → PLAN-UX-04.
- **F-POS-3 (P3, Confirmed) — payment-method radiogroup lacks arrow-key roving** (`RegisterView.tsx:1091-1124`); Tab works, arrows don't. → PLAN-UX-01.

## 7. Inventory usability analysis

**Strength (updates the original audit).** Driven live with a tracked low-stock product: the header shows a **"1 Stock bajo"** badge, an **"Productos que necesitan atención"** panel distinguishes "Stock bajo" (Latte: 2 disponible, umbral 8) from "Riesgo de agotarse" (Café Americano: ~63 días al ritmo actual) with a "preparar reabasto" suggestion, and per-product cards show on-hand, threshold, and Ajustar / Historial / stock-take actions (`1440-inventory.png`). Movements are auditable via Historial.

**Findings:**
- **F-INV-1 (P1, Confirmed — data integrity, cross-ref companion D5/PLAN-04):** manual adjustments have no negative-stock floor; from the UX side, `InventoryModal` gives **disable-only validation** (no specific "would go negative" or range feedback — `InventoryView.tsx:478-481`). → PLAN-UX-05 (validation) + PLAN-04 (floor).
- **F-INV-2 (P3, Possible):** velocity/"days left" is shown but its basis (window, method) isn't explained on hover — minor trust/traceability nit.

## 8. Reports and analytics analysis

**Strength (updates the original audit).** With data, reports lead with a plain-language summary ("Hoy llevas $180.00 con 3 órdenes. Lo que más pesó: Café Americano 50% · la tarde 100%"), KPI tiles (Ventas netas / Órdenes / Ticket promedio), a **"Qué hacer ahora"** prioritized recommendation engine, and a timezone banner ("Ciudad de México UTC-6"). **Net sales are refund-adjusted** ($180 = $225 − $45). Charts carry `sr-only` text summaries (`ChartCard.tsx:38`) — a real accessibility strength.

**Findings:**
- **F-REP-1 (P2, Confirmed — cross-ref companion D6):** `payment_breakdown` / `payment_mix` are **not** refund-adjusted while `net_sales` is, so on refund days the method totals don't reconcile to net. A financially literate owner will notice the mismatch and distrust the numbers. → PLAN-04 (backend), surfaced here as a trust risk.
- **F-REP-2 (P2, Confirmed) — RefundsAndCancellations table has no mobile card fallback** (`RefundsAndCancellations.tsx:158`, `overflow-x-auto` only), unlike the ProductInventory table which does. Horizontal scroll on phones. → PLAN-UX-04.
- **F-REP-3 (P3, Confirmed) — heading-level skips** in report cards (`ChartCard.tsx:28` `<h3>` under `<h1>`), minor SR structure noise. → PLAN-UX-01.
- **F-REP-4 (P3, Possible) — margin claim vs reality:** reports rank products by sales/units, never margin (no cost field) — see the landing overclaim F-LAND-1.

## 9. Employee and permissions analysis

**Strength.** The Empleados tab (under Configuración) presents **role cards** (Propietario / Gerente / Cajero) with plain-language capability descriptions, an invite form (email + role), and a member list with role-change dropdown + Desactivar (`11-employees.png`). Backend RBAC is robust (companion §7): owner-only role management, last-owner guard, roles re-read per request (no stale-permission window).

**Findings:**
- **F-EMP-1 (P1, Confirmed) — destructive actions with no confirmation:** **Deactivate employee** (`SettingsView.tsx:342`) and **change employee role** (`SettingsView.tsx:337`, fires on select-change) execute immediately. A role downgrade/deactivation is security-relevant and easy to trigger by mistake. Persona: Owner. → PLAN-UX-01.
- **F-EMP-2 (P3, Confirmed — cross-ref companion D8):** a user in multiple tenants lands in an arbitrary tenant at login (`.first()`); no tenant picker. → companion PLAN-05.
- **F-EMP-3 (P3, Confirmed):** employees management is a Settings tab, not a top-level nav item — discoverable but a known open decision in `docs/current-sprint.md`.

## 10. Customer-management analysis

**Absent — and correctly not claimed.** There is no customers/clientes module (no route, no `api.ts`, no backend router); the only "customer" references are the Stripe customer and the refund reason `customer_return`. This is intentionally deferred (`docs/deferred-scope.md`) and the landing makes **no** customer-CRM claim. **F-CUST-1 (Info):** because no customer identity is captured at sale, emailed/SMS receipts and any future loyalty are blocked on this gap — noted as a dependency for PLAN-UX-02's emailed-receipt option (which would capture an ad-hoc email without a full CRM).

## 11. Multi-location analysis

**Absent — and correctly not claimed.** No branch/sucursal concept exists (deferred 3× in `docs/deferred-scope.md`); the landing does not promise it. There is therefore **no** current cross-branch confusion risk. The header always shows the single tenant name ("Cafe UX"), so "which business am I in" is unambiguous. **Not applicable** for this beta scope; revisit if/when multi-location ships.

## 12. Subscription and trial analysis

**Strength.** Trial state is transparent and consistent across surfaces: a header chip ("PRUEBA GRATIS · quedan 7 días"), a dismissible banner ("Prueba activa por 7 días. Activa el Plan Standard para conservar la operación al terminar"), and a Facturación page with Plan / Estado / "La prueba termina 14 jul 2026" tiles, a "Lo que conservas al activar" value list, "Activar por $299 MXN/mes", and a secondary "Cancelar suscripción" (`09-billing.png`). Access-state copy is centralized (`BillingBanner.tsx`) and covers all backend reasons; cancel is at-period-end with matching copy and a confirmation dialog.

**Findings (UX; lifecycle-correctness is companion §10 / PLAN-01):**
- **F-SUB-1 (P2, Confirmed) — data views lack a local subscription-inactive state.** Only Catalog handles a 402 inline (`CatalogView.tsx:150-160`); inventory/orders/reports rely on the global banner + backend 402. If access lapses mid-session, those screens can show a generic error rather than a clear "tu prueba terminó — activa para continuar" with a direct CTA. → PLAN-UX-05.
- **F-SUB-2 (P2, Confirmed) — plan-name mismatch:** landing pricing card says **"Plan Kova"** (`messages.ts:216`) but the product/billing/onboarding all say **"Plan Standard"**; the buyer sees the name change after signup. → PLAN-UX-03 (quick win).
- **F-SUB-3 (P3, Confirmed):** reads are blocked for canceled/expired tenants (companion §10) — a churned owner can't view history; confirm this is the intended stance (reactivation friction).

## 13. Offline experience analysis

Cross-references companion §11 / `PLAN-03` for correctness (timestamp loss, cold-offline catalog, batch resilience). **UX-specific findings:**
- **F-OFF-1 (P2, Confirmed) — offline indicator hidden on mobile / collapsed sidebar.** `OfflineIndicator` lives only in the sidebar footer (`AppShell.tsx:182`); on phones it's behind the hamburger, and it disappears when the sidebar is collapsed. There's no always-visible offline chip; the register compensates with queued-sale toasts, but a cashier can't glance-confirm connection/queue state. → PLAN-UX-04.
- **F-OFF-2 (P2, Confirmed) — no honest "safely stored" affordance for cold-offline.** Because a cold offline start shows an error (D2), the UI does not (and must not) imply a sale is stored when it can't be rung. The fix is enabling cold-offline (PLAN-03), after which the queued-state messaging (already good — `/sync-queue`, dead-letter retry) applies.
- **Strength:** the sync-queue view, dead-letter retry, and "las ventas offline se guardan en cola y se sincronizan al volver internet" tour copy are clear and honest for the online-loaded path.

## 14. Navigation and information architecture

**Strength.** Two deliberate nav mechanisms: a desktop collapsible sidebar and a mobile off-canvas drawer + persistent **bottom tab bar** (Caja / Órdenes / Panel / Más — `AppShell.tsx:267-299`). Role-aware: cashiers don't see Inventario/Reportes/Facturación. Spanish slug aliases redirect (`/caja`, `/reportes`, etc.). Current tenant always shown in the header. **F-NAV-1 (P3, Confirmed):** `/sync-queue` has no nav entry — reachable only via the offline indicator (compounded by F-OFF-1 on mobile). **F-NAV-2 (P3, Confirmed):** Empleados is a Settings tab, not top-level (known open decision).

## 15. Forms and validation

**Strengths:** form state is preserved on error (modals close only after a successful awaited call — `CatalogView.tsx:688-694`); specific inline validation on catalog price ("inválido" vs "negativo"), product name (no-HTML), reset-password (too-short/weak/mismatch with `aria-invalid`+`aria-describedby`), and register cash-shortfall/split-mismatch.
**Findings:**
- **F-FRM-1 (P2, Confirmed) — disable-only modals:** InventoryModal, CashMovementModal, OpenShift/CloseShift give no specific validation feedback — the submit button is simply disabled, leaving the user to guess. → PLAN-UX-05.
- **F-FRM-2 (P2, Confirmed) — missing confirmations on destructive actions:** deactivate product/category/modifier-group/modifier-option, deactivate employee, change employee role (see F-EMP-1). → PLAN-UX-01.
- **F-FRM-3 (P1, Confirmed) — Refund/Void modal selects lack label association** (`RefundModal.tsx:50,61`, `VoidModal.tsx:38` — `<Label>` with no `htmlFor`, `<Select>` with no `id`). SR users hear unlabeled selects on money-critical actions. → PLAN-UX-01.

## 16. Loading, empty, success, and error states

Per-view matrix (✅ present · ⚠️ partial · ❌ missing):

| View | loading | success | empty+CTA | validation | server err | offline | unauth | 404 | 409 | sub-inactive |
|---|---|---|---|---|---|---|---|---|---|---|
| Register | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | — | — | ❌ |
| Catalog | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ✅ |
| Inventory | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | — | — | ❌ |
| Orders list | ✅ | — | ✅ | — | ✅ | ⚠️ | ⚠️ | — | — | ❌ |
| Order detail | ✅ | ✅ | — | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ❌ |
| Shifts | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | — | — | ❌ |
| Reports | ✅ | — | ✅ | — | ✅ | ⚠️ | ✅ | — | — | ❌ |
| Dashboard | ✅ | ✅ | ✅ | — | ✅ | ⚠️ | ⚠️ | — | — | ✅ |
| Billing | ✅ | ✅ | ✅ | — | ✅ | ⚠️ | ✅ | — | ✅ | ✅ |
| Auth/Reset/Invite | ⚠️ | ✅ | — | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | — |

**Findings:** **F-ST-1 (P2, Confirmed)** no distinct 404/409 states (missing/foreign order or a conflict collapses into a generic error — `OrderDetail.tsx:50-52,111-125`). **F-ST-2 (P2, Confirmed)** no local subscription-inactive state on inventory/orders/reports (F-SUB-1). **Strengths (Confirmed):** no premature-success bug (register clears cart only after queue-persist); errors never console-only (all toast + Sentry). → PLAN-UX-05.

## 17. Responsive and mobile analysis

Driven at 1440/1024/768/390/360. **No screen is desktop-only; nothing broke catastrophically.** Intentional patterns: OrderList and ProductInventory render cards on mobile + tables on `sm+`; POS cart is a bottom sheet; Dialog is a bottom sheet on mobile; nav is off-canvas + bottom-tab.

**Findings:** **F-RSP-1 (P2, Confirmed)** ShiftView closed-shifts table (`ShiftView.tsx:350`) and RefundsAndCancellations table (`RefundsAndCancellations.tsx:158`) are `overflow-x-auto` only — no card fallback (inconsistent with the OrderList pattern). **F-RSP-2 (P2, Confirmed)** split-payment rows cramped at 360px (F-POS-2). **F-RSP-3 (P3, Confirmed)** a few icon buttons are 40px (< 44px touch target) on mobile (`CatalogView.tsx:431,585`). **F-RSP-4 (P2, Confirmed)** offline indicator hidden on mobile (F-OFF-1). → PLAN-UX-04.

## 18. Accessibility findings

- **A11Y-1 (P1, Confirmed, systemic) — modal has no focus management.** `components/ui/dialog.tsx` (verified: lines 12-65) handles Escape/overlay/scroll-lock and sets `role="dialog"`/`aria-modal`/close `aria-label`, but does **not** move focus in on open, **not** trap Tab, **not** restore focus on close, and has **no `aria-labelledby`** to the title. Keyboard/SR users can tab into the background. Affects Refund, Void, Close-shift, Cash-movement, Cancel-subscription, Catalog product/category, Inventory, Modifier modals. One fix covers all. → PLAN-UX-01.
- **A11Y-2 (P2, Confirmed) — Refund/Void selects unlabeled** (F-FRM-3). → PLAN-UX-01.
- **A11Y-3 (P2, Confirmed) — VoidModal reasons not localized:** raw enum via `option.replaceAll("_"," ")` renders "operator error" (English) — breaks es-MX and reads wrong to SR (`VoidModal.tsx:41`). RefundModal localizes correctly. → PLAN-UX-01.
- **A11Y-4 (P2, Confirmed) — error toasts are polite, not assertive:** every variant uses `role="status"` (`components/ui/toast.tsx:117`); errors should be `role="alert"` so failures interrupt SR output. → PLAN-UX-01.
- **A11Y-5 (P3, Confirmed) — icon-only modifier delete buttons lack `aria-label`** (`CatalogView.tsx:869-919`). → PLAN-UX-01.
- **A11Y-6 (P3, Confirmed) — radiogroups lack arrow-key roving** (POS payment, dashboard period). → PLAN-UX-01.
- **A11Y-7 (P3, Possible) — contrast:** `text-kova-muted`/micro `text-[10px]/[11px]` labels and `opacity-90` banner body are borderline; needs a measured contrast pass.
- **Strengths (Confirmed):** chart `sr-only` summaries + persistent detail cards; full POS keyboard operability; correct label association elsewhere (Settings `useId`).

## 19. Performance-related UX findings

- **P-1 (P3, Possible) — reports charts are a lazy Recharts chunk**; in the walkthrough the summary/recommendations rendered immediately while the chart area appeared below the fold after a beat. No blocking or layout-shift observed; acceptable. Suspected, not measured.
- **P-2 (P3, Likely) — stock is a `SUM` over movements per read** and reports recompute per request (companion §14). Fine at SMB scale; no client-visible slowness in the walkthrough. No rollup/cache — watch for high-volume tenants.
- **P-3 (Strength):** landing SSR-prerendered and served from Vercel cache (HIT, ~0.9s); no third-party analytics/pixel bloat. Route transitions are lazy-loaded.
- No unbounded tables observed (orders list is server-paginated).

## 20. Landing-page vs product matrix

| Public claim | Where | Actual implementation | Status | Risk | Correction |
|---|---|---|---|---|---|
| "Conecta cada venta con inventario, caja, turnos y reportes" | `messages.ts:30` | All modules exist + dashboard next-actions | Fully supported | — | — |
| "Efectivo, transferencia, tarjeta o pago dividido" | `messages.ts:53` | Register payment methods + split | Fully supported | — | — |
| "Kova te avisa cuando algo está por acabarse" | `messages.ts:59` | Low-stock alerts + velocity (live-confirmed) | Fully supported | — | — |
| **"qué productos te dejan mejor margen"** | `messages.ts:65` | **No cost/margin field anywhere**; reports rank by sales/units | **Not deliverable (overclaim)** | Trust: owner expects margin, gets revenue | Reword to "qué productos venden más / dejan más ingreso" **or** add a cost field |
| "Funciona sin internet · sin hardware obligatorio" | `messages.ts:166` | Offline module (online-loaded); cold-offline broken (D2) | Partially supported | Owner tests offline cold-start, sees error | Fix D2 (PLAN-03), then claim holds |
| "Recibos con tu logo" | `messages.ts:198` | Print receipt w/ logo from order detail | Supported (print); no email | — | Emailed receipt = PLAN-UX-02 (not currently claimed) |
| "Precio fijo, sin comisión por venta" | `messages.ts:165` | Single subscription; Kova doesn't process POS payments | Fully supported | — | — |
| "$299 MXN/mes" / "7 días gratis, sin tarjeta" | `messages.ts:198`, hero, terms | Backend 29900, trial 7d no-card | Fully supported (consistent) | — | — |
| Pricing card name **"Plan Kova"** | `messages.ts:216` | Product/billing say **"Plan Standard"** | Inconsistent | Minor confusion post-signup | Rename to "Plan Standard" |
| Customers / multi-location / discounts / taxes / loyalty | — | Absent (deferred) | **Not claimed** (disciplined) | — | — |
| Legal pages (privacy/terms/seguridad/cookies) | `/privacy` etc. | Real, substantive content | Fully supported | — | — |
| Support: email + "o WhatsApp" | footer/FAQ | Email wired; **WhatsApp not linked** | Partially supported | Minor | Wire WhatsApp or drop the mention |

## 21. Activation and conversion analysis

**Likely activation event:** `first_sale_completed` (`RegisterView.tsx:502`). In-app funnel events exist: `signup_completed → first_product_created → first_sale_completed → checkout_started → trial_to_paid` (`telemetry/funnel.ts`).

**Findings:**
- **F-ACT-1 (P1, Confirmed) — top of funnel is unmeasurable.** The landing (`Home.tsx`) fires **zero** telemetry (no page-view, no CTA-click), and the sink `POST /telemetry/events` **requires an authenticated session** (`telemetry/router.py:18`) — so pre-signup events are impossible even if added. Visit → CTA → signup conversion cannot be computed; the team is optimizing blind at the exact stage that determines growth. → PLAN-UX-03.
- **F-ACT-2 (P2, Confirmed) — missing funnel rungs:** no `login`, no `trial_started`, no `open_shift` events; `signup_completed` is queued and only flushed after auth (effectively an "activated" signal, not a raw signup metric). → PLAN-UX-03.
- **F-ACT-3 (P2, Confirmed) — activation path is well-instrumented once inside** (product/sale/checkout events) — the strength to build on.

## 22. Retention opportunities

- **R-1 (P2) — trial-ending emails never send** (companion B4/PLAN-01: no scheduler). The single highest-leverage retention/conversion touch is implemented but dark. (Cross-ref, fixed in PLAN-01.)
- **R-2 (P2) — no "day-2 return" or re-engagement signal.** No event or nudge distinguishes a one-session trial from an activated one; combined with F-ACT-1, churn causes are invisible.
- **R-3 (P3) — reads blocked for churned tenants** (F-SUB-3) removes a reactivation surface (they can't log in and see their history as a reason to come back).
- **R-4 (Strength) — the recommendation engine** ("qué hacer ahora") is a genuine retention asset: it gives the owner a reason to open Kova daily. Surfacing it in a digest email (future) would compound it.

## 23. Customer-trust risks

- **T-1 (P1) — payment-mix doesn't tie to net on refund days** (F-REP-1). An owner reconciling by hand will see method totals ≠ net sales and lose confidence. Confirmed.
- **T-2 (P1) — margin overclaim** (F-LAND-1/20): promising margin insight the product can't give is a trust and refund risk once a paying owner looks for it. Confirmed.
- **T-3 (P1) — no corte-de-caja printout / no register receipt** (F-POS-1, F-CORTE): a cash business that can't hand a ticket or print the drawer count at close will distrust the tool for its core job. Confirmed.
- **T-4 (P2) — cold-offline shows a blank/error** (D2): the landing sells "funciona sin internet"; an owner who tests it cold sees nothing. Confirmed.
- **T-5 (P2) — destructive actions without confirmation** (F-EMP-1, F-FRM-2): an accidental role downgrade or product deactivation erodes trust. Confirmed.
- **Strengths that build trust:** honest empty states ("con tus números, nunca inventados"), real legal/security pages, transparent trial countdown, "no hay turno abierto" guard.

## 24. Functional defects (Confirmed)

| ID | Defect | Severity | Evidence |
|---|---|---|---|
| F-POS-1 | No one-tap receipt at register post-sale | P1 | `RegisterView.tsx:1272-1361` |
| F-CORTE | No corte-de-caja printout on shift close | P1 | `ShiftView.tsx` (no `window.print`) |
| F-RCPT | Customer email capture + emailed receipt absent (UI + backend) | P1 | no field in `RegisterView`; no endpoint |
| F-REP-1 | payment_mix not refund-adjusted (≠ net) | P2 | `reports/service.py:178-209` |
| F-LAND-1 | "mejor margen" overclaim — no cost/margin data | P2 | `messages.ts:65`; no cost field |
| F-SUB-2 | Plan-name mismatch "Plan Kova" vs "Plan Standard" | P2 | `messages.ts:216` vs `standardPlan.ts` |
| F-ST-1 | No distinct 404/409 states | P2 | `OrderDetail.tsx:50-52` |
| (Cross-ref companion) | D2 cold-offline, D5 negative stock, D6 payment mix, B4 trial emails | P1–P2 | KOVA-COMPLETE-AUDIT |

## 25. UX defects (Confirmed)

| ID | Defect | Severity | Evidence |
|---|---|---|---|
| A11Y-1 | Modal: no focus trap/initial focus/restore/`aria-labelledby` | P1 | `dialog.tsx:12-65` |
| F-EMP-1 | Deactivate employee / change role: no confirmation | P1 | `SettingsView.tsx:337,342` |
| F-FRM-2 | Deactivate product/category/modifier: no confirmation | P1 | `CatalogView.tsx:443,774,869` |
| F-FRM-3 / A11Y-2 | Refund/Void selects unlabeled | P1 | `RefundModal.tsx:50,61`, `VoidModal.tsx:38` |
| A11Y-3 | VoidModal reasons not localized (English) | P2 | `VoidModal.tsx:41` |
| A11Y-4 | Error toasts polite not assertive | P2 | `toast.tsx:117` |
| F-OFF-1 | Offline indicator hidden on mobile/collapsed | P2 | `AppShell.tsx:182` |
| F-RSP-1 | Shift/Refunds tables no mobile card fallback | P2 | `ShiftView.tsx:350`, `RefundsAndCancellations.tsx:158` |
| F-FRM-1 | Disable-only validation on several modals | P2 | `InventoryView.tsx:478` |
| F-SUB-1 | No local subscription-inactive state on data views | P2 | only Catalog handles 402 |
| A11Y-5/6, F-RSP-3, F-REP-3 | icon-label, arrow-key roving, 40px targets, heading skips | P3 | as cited |

## 26. Quick wins (high value / low effort)

1. Rename landing pricing card "Plan Kova" → "Plan Standard" (`messages.ts:216`). (F-SUB-2)
2. Reword the "mejor margen" landing line to "más vendidos / más ingreso" (`messages.ts:65`). (F-LAND-1)
3. Localize VoidModal reasons via `copy` like RefundModal does (`VoidModal.tsx:41`). (A11Y-3)
4. Add `htmlFor`/`id` to Refund/Void selects (`useId`, as Settings already does). (F-FRM-3)
5. Change error-toast `role` to `alert` for the error variant (`toast.tsx:117`). (A11Y-4)
6. Add `aria-label` to the modifier delete icon buttons. (A11Y-5)
7. Add confirmation dialogs to deactivate-employee and change-role (reuse the existing Void/Cancel confirm pattern). (F-EMP-1)
8. Wire the footer WhatsApp mention to a real link, or remove it.

## 27. Production blockers (functionality/UX scope)

None of the functionality/UX findings is an absolute blocker to *using* the product — it works end-to-end. The **paid-onboarding** blocker (billing "access forever" B1) is in the companion audit (`PLAN-01`). Within this audit's scope, the **must-fix-before-scaling-beta** set is: F-POS-1 + F-CORTE (a cash business needs receipts/corte), A11Y-1 + F-EMP-1/F-FRM-2 (money-critical modals + accidental destructive actions), and F-ACT-1 (you cannot improve conversion you cannot measure).

## 28. Prioritized recommendations

| Rank | ID | Finding | Priority | Workflow | Customer impact | Business impact | Effort | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | A11Y-1 | Modal focus management (systemic) | P1 | all modals | Keyboard/SR users lost in money modals | Accessibility/legal + trust | S | `dialog.tsx:12-65` |
| 2 | F-EMP-1/F-FRM-2 | Confirm destructive actions | P1 | employees, catalog | Accidental deactivation/role change | Support + trust | S | `SettingsView.tsx:337` |
| 3 | F-POS-1 | One-tap receipt at register | P1 | checkout | Slower line, no customer ticket | Daily usability + trust | M | `RegisterView.tsx:1272` |
| 4 | F-CORTE | Corte-de-caja printout | P1 | shift close | Owner can't print drawer count | Trust in core job | M | `ShiftView.tsx` |
| 5 | F-ACT-1/F-ACT-2 | Landing + top-of-funnel analytics | P1 | acquisition | — | Conversion optimization unlocked | M | `Home.tsx`, `telemetry/router.py:18` |
| 6 | F-FRM-3/A11Y-2 | Label Refund/Void selects | P1 | refund/void | SR users on money actions | Accessibility | S | `RefundModal.tsx:50` |
| 7 | F-LAND-1 | Fix margin overclaim | P2 | landing | Expectation mismatch | Trust/refund risk | S | `messages.ts:65` |
| 8 | F-REP-1 | Payment-mix reconcile to net | P2 | reports | Totals don't tie | Trust | S | `reports/service.py:178` |
| 9 | F-RCPT | Customer email + emailed receipt | P2 | checkout | No digital receipt | Differentiation | M | absent |
| 10 | F-OFF-1/F-RSP-1 | Mobile offline chip + table cards | P2 | mobile daily use | Cramped/hidden on phones | Mobile usability | M | `AppShell.tsx:182` |
| 11 | F-SUB-1/F-ST-1 | Local sub-inactive + 404/409 states | P2 | data views | Confusing errors | Support | M | `OrderDetail.tsx:50` |
| 12 | F-SUB-2 | Plan-name consistency | P2 | signup→billing | Mild confusion | Trust | XS | `messages.ts:216` |
| 13 | A11Y-3/4, F-FRM-1 | Localize void reasons, alert toasts, specific validation | P2/P3 | multiple | SR/clarity | Polish | S | as cited |
| 14 | A11Y-5/6, F-RSP-3, F-REP-3 | icon labels, arrow-keys, touch targets, headings | P3 | multiple | Minor a11y | Polish | S | as cited |

## 29. Suggested implementation sequence

1. **PLAN-UX-01 — Modal a11y & destructive-action safety** (ranks 1, 2, 6 + quick wins A11Y-3/4/5/6): one `dialog.tsx` change + confirmations + labels. Highest leverage, lowest effort, touches every money-critical flow.
2. **PLAN-UX-02 — Receipts & corte de caja** (ranks 3, 4, 9): register receipt, corte printout, optional customer email + emailed receipt.
3. **PLAN-UX-03 — Activation instrumentation & landing accuracy** (ranks 5, 7, 12): anonymous telemetry + landing events + funnel rungs + margin/plan-name copy fixes.
4. **PLAN-UX-04 — Responsive & offline visibility** (rank 10): table card fallbacks, mobile offline chip, split-payment layout, touch targets.
5. **PLAN-UX-05 — State completeness & validation** (rank 11 + F-FRM-1): 404/409 states, local subscription-inactive states, specific modal validation.

Quick wins (§26) can land immediately alongside PLAN-UX-01. Cross-references: cold-offline (D2) and payment-mix backend (D6/F-REP-1), negative stock (D5), and trial emails (B4) are owned by companion `PLAN-03`/`PLAN-04`/`PLAN-01`; this sequence deliberately does not duplicate them.
