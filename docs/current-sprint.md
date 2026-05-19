# Current Sprint

Last updated: 2026-05-19

## Source-of-truth rules

- This is the single document for what is in flight and what is the next execution target.
- Historical roadmap and completed sprints live in `sprint-planning.md`.
- New issues from the 2026-05-19 UX review are tracked in `docs/ux-review-2026-05-19.md`
  (the Sprint 1/2/3 sections at the bottom of that doc). Items below mirror that backlog
  by priority; do not maintain duplicates — update there and reflect status here.

## Active focus

Sprint 17 (UX trust + premium polish). Goal: a fresh tenant's first 60 seconds inside the
app no longer damages perceived value. Rebrand work (Phases 1–5 of `CLAUDE.md`) is complete
for the screens this sprint touches; only the visual layer is changing.

## Critical (blockers for selling)

These come from `docs/ux-review-2026-05-19.md` §B Critical. Each links to the file the work
lives in.

- [ ] Logo upload replaces the "URL segura" text input in [SettingsView.tsx](../frontend/src/settings/SettingsView.tsx).
      Includes preview, drag-and-drop, size/format validation. Backend coordination required for storage.
- [ ] `DeltaBadge` in [DashboardView.tsx](../frontend/src/dashboard/DashboardView.tsx) must not render red
      "−100% vs ayer" for fresh / zero-history tenants. Render neutral "Aún sin comparación" instead.
- [ ] `BillingBanner` hidden on `/settings/billing`; during active trial it must be info-styled (not
      destructive) and dismissible. Files: [BillingBanner.tsx](../frontend/src/billing/BillingBanner.tsx),
      [AppShell.tsx](../frontend/src/layout/AppShell.tsx).
- [ ] Remove `Dona` / `QA Concha 20260512 / QA-CON-20260512` from the tenant seed so new accounts
      start with an empty catalog. Backend coordination required. Update
      [CatalogView.tsx](../frontend/src/catalog/CatalogView.tsx) empty state if needed.

## High priority

- [ ] Replace free-text `Idioma` / `Moneda` / `Zona horaria` inputs in
      [SettingsView.tsx](../frontend/src/settings/SettingsView.tsx) with `Select` primitives and sane
      defaults. Place under an "Avanzado" disclosure.
- [ ] Promote `OnboardingChecklist` above the KPI grid in
      [DashboardView.tsx](../frontend/src/dashboard/DashboardView.tsx) while not complete.
- [ ] Surface the trial day count during the active trial. `TrialChip` already exists at
      [TrialChip.tsx](../frontend/src/billing/TrialChip.tsx); confirm it is mounted in
      `AppShell` header on desktop + mobile, and that it links to `/settings/billing`.
- [ ] Reports empty state — when `summary.order_count === 0`, collapse the 9 "no data" cards in
      [ReportsView.tsx](../frontend/src/reports/ReportsView.tsx) into one hero card with a primary CTA
      to `/register`.
- [ ] Receipt preview panel in [SettingsView.tsx](../frontend/src/settings/SettingsView.tsx) — live mock
      that updates as the user edits business name / footer / contact text.
- [ ] Apply `formatTenantName` (trim + truncate + sentence-case) to the rendered tenant name in
      [AppShell.tsx](../frontend/src/layout/AppShell.tsx).

## Medium / Low priority

Tracked in `docs/ux-review-2026-05-19.md` §B Medium + §B Low. Pull in once the items above are
shipped and reviewed. Highlights:

- Mezcla de pagos / Productos top empty states collapse into a single explainer.
- Dashboard comparison label becomes dynamic (vs ayer / vs semana / vs mes).
- Hide `Pago dividido` toggle behind an "Opciones avanzadas" disclosure until a payment method is
  chosen.
- Employees role select uses the styled `Select` primitive instead of the native one.
- Time-zone-aware greeting (`getGreeting()`).

## Carried over from the (now-deleted) production-review backlog

These were left open when the PB-1..PB-7 production-trust backlog was closed and removed.
They are not blockers for the UX work above and can be picked up in parallel.

- [ ] Clean up the stray Vercel `frontend` project after confirming it is unused.
- [ ] Add E2E new-tenant onboarding happy path
      (signup → checklist visible → first sale → checklist hidden).
- [ ] Inline product inventory controls (track inventory, current stock, low-stock threshold)
      on the product edit form. Inventory movement history panel for tracked products.
- [ ] Tenant isolation tests for every tenant-scoped route.
- [ ] Analytics credibility — replace fake-looking landing metrics; add real backend-driven
      dashboard trend comparison; add `GET /api/v1/reports/sales-by-hour`,
      `/sales-by-employee`, `/refunds-by-reason`, and `/inventory/velocity`; add report empty
      states with CTAs; add money golden tests for report aggregation after refunds/voids.
      Revisit before Tax/Discounts work.

## Pre-Beta Ops Checklist

Still required before onboarding the first beta tenant. Not blocking Sprint 17 UX work.

- [x] **Sentry:** Backend + frontend DSNs configured, alert rules active.
- [x] **Backups:** GitHub Actions `db-backup.yml` daily `pg_dump` (artifact 30 d).
      Pro plan upgrade + managed backups deferred to pre-GA.
- [ ] **Uptime monitor:** Add UptimeRobot on `https://pos-project-backend.fly.dev/health` with email alert.
- [x] **Support channel:** `posprojectsupport@gmail.com` active.
- [x] **Beta agreement template:** `docs/beta-agreement-template.md`.
- [x] **Production deployment Sprint 14:** Security headers verified in production.
- [x] **Verify secure cookies in production:** `Secure; HttpOnly; SameSite=Lax` confirmed.

## Release gate (do not flip without explicit approval)

Stripe live keys / live Checkout are the last step before GA. Production stays in sandbox until the
web app is otherwise complete. See `docs/risk-register.md` for the hardened guard rails.

---

## Completed sprints (summary)

Detailed retros live in `sprint-planning.md`. Listed here so this doc stays the only place
you need to look for current status.

- Sprint 9 — Billing: Standard Plan (2026-05-11)
- Sprint 10 — App Shell + POS Foundation (2026-05-11)
- Sprint 11 — Catalog Management (2026-05-11)
- Sprint 12 — Register Core (2026-05-13)
- Sprint 13 — Offline Sync + Dead Letter (2026-05-13)
- Sprint 14 — Beta Hardening (code) (2026-05-13)
- Sprint 15 — Modifiers (2026-05-13, production validated)
- Sprint 16 — UX Polish + Onboarding + Mobile Hardening (2026-05-14)
- Pre-beta sprints PB-1, PB-2, PB-3, PB-4, PB-5, PB-7 — closed in May 2026. Carry-over items are
  listed above; analytics work remains open and is also above.
