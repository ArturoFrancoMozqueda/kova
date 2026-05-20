# Current Sprint

Last updated: 2026-05-20

## Source-of-truth rules

- This is the single document for what is in flight and what is the next execution target.
- Historical roadmap and completed sprints live in `docs/sprint-planning.md`.
- The Kova Product/UX/Business Audit backlog lives in `docs/sprint-planning.md` under
  `Kova Product/UX/Business Audit Findings`.
- Do not duplicate detailed acceptance criteria here; mirror current status and next execution focus.

## Active Focus

Kova Product/UX Audit execution.

Sprint 1 is mostly complete. Sprint 2 is functionally complete. Sprint 3 is functionally complete.
Sprint 4 is in progress, focused on report clarity without overwhelming the owner.

## Completed From Kova Audit Sprint 1: Trust, Clarity, and Conversion

- [x] Standard Plan price aligned to $299 MXN/month across frontend constants, backend billing
      defaults, docs, specs, tests, and Alembic migration
      `backend/alembic/versions/0023_standard_plan_299_mxn.py`.
- [x] Landing claims narrowed to beta-true cafe/small food retail scope.
- [x] Unsupported claims around branches, taxes, WhatsApp receipts, restaurant tables, commissions,
      barcode/fiado, and broad vertical support were removed or softened.
- [x] Signup trust cues improved with trial/price copy, privacy/terms mailto access, and support
      contact.
- [x] Global PWA update prompt suppressed on public/auth routes.
- [x] Billing/trial copy and tests/specs now reference the $299 MXN Standard Plan.

## Left From Sprint 1

- [ ] Create a formal billing state copy matrix for active trial, expired trial, active subscription,
      past due, canceled, and Stripe unavailable.
- [ ] Add real privacy/terms pages or hosted documents instead of mailto request links.
- [ ] Replace remaining audit-era historical references in `docs/ux-review-2026-05-19.md` only if
      that file is no longer treated as historical evidence.

## Completed From Kova Audit Sprint 2: Onboarding and First Value Moment

- [x] Added tenant-scoped cafe preset at `backend/presets/cafe.json`.
- [x] Allowed the onboarding preset API to apply `cafe`, alongside bakery and retail.
- [x] Rewrote dashboard checklist copy to be Spanish-first and cafe-specific.
- [x] Checklist action paths now open direct setup actions:
      `/catalog?new=product` and `/catalog?inventory=activate`.
- [x] Catalog opens the product form from those query params; inventory setup starts with inventory
      tracking enabled.
- [x] Register empty state now offers `Crear primer producto` and `Cargar menu de cafeteria`.
- [x] Inventory empty state explains which cafe products should use stock tracking.
- [x] Added first-value milestone states for first product, inventory, shift, sale, and first report.
- [x] Updated onboarding specs/features and Sprint 2 backlog status.

## Left From Sprint 2

- [ ] Add a dedicated full-path E2E: signup -> checklist visible -> first product -> open shift ->
      first sale -> first report -> checklist/milestones update.
- [ ] Add first employee setup as a first-value path once employee management is clearer in Sprint 3.
- [ ] Decide whether the cafe preset should include modifier groups for milk/size, or keep modifiers
      as a later usability pass to avoid expanding beta scope.

## Verification Completed 2026-05-20

- [x] Frontend typecheck: `npm run typecheck`
- [x] Frontend lint: `npm run lint` passed with two existing warnings in `RegisterView.tsx`.
- [x] Frontend production build: `npm run build`
- [x] Frontend unit tests: `npm test -- --run` (13 passed)
- [x] Focused E2E: `npm run test:e2e -- e2e/mobile.spec.ts e2e/app-shell.spec.ts --project=chromium`
      (9 passed)
- [x] Backend full test suite: `UV_PROJECT_ENVIRONMENT=.venv-win uv run pytest`
      (183 passed, 1 skipped)
- [x] Diff hygiene: `git diff --check`

## Sprint 3 Verification Completed 2026-05-20

- [x] Frontend typecheck: `npm run typecheck`
- [x] Frontend lint: `npm run lint`
- [x] Frontend production build: `npm run build`
- [x] Frontend unit tests: `npm test -- --run` (13 passed)
- [x] Focused E2E:
      `npm run test:e2e -- e2e/register-sale.spec.ts e2e/settings.spec.ts e2e/mobile.spec.ts --project=chromium`
      (11 passed)
- [x] Focused Sprint 3 operational E2E:
      `npm run test:e2e -- e2e/catalog.spec.ts e2e/inventory.spec.ts e2e/orders.spec.ts e2e/settings.spec.ts --project=chromium`
      (11 passed)
- [x] Full frontend E2E: `npm run test:e2e -- --project=chromium` (49 passed, 3 skipped)
- [x] Diff hygiene: `git diff --check`

## Completed From Kova Audit Sprint 3: POS, Products, Employees, and Inventory Usability

- [x] Register payment controls are replaced by an instructional state until the cart has products.
- [x] Split payment remains behind advanced options and is hidden until a sale has cart context.
- [x] Employee roles are localized and now include business-language permission descriptions.
- [x] Employee management remains in the Settings employees tab, with clearer role guidance before
      inviting staff.
- [x] Mobile regression coverage now confirms the sidebar is closed on fresh mobile app loads while
      bottom navigation remains available.
- [x] Employee setup spec updated to reflect role-description UX acceptance criteria.
- [x] Catalog now supports product search and sorting by name, price, or inventory-tracked products.
- [x] Inventory now supports search, low/healthy filtering, and sorting by name, stock, or threshold.
- [x] Orders now support visible client-side sort options for newest, oldest, highest amount, and
      lowest amount alongside existing filters.
- [x] Mobile E2E now covers catalog product search/sort, product create/edit, inventory activation,
      inventory search/filter/sort, order status/sort, and employee invite/role/deactivation flows.

## Left From Sprint 3

- [ ] Decide whether employee management should graduate from Settings tab to a first-class nav item
      after beta usage data.
- [ ] Add invitation acceptance-path E2E once that separate acceptance flow is finalized.

## Completed From Kova Audit Sprint 4: Reports and Business Storytelling

- [x] Reports now use a compact owner decision brief instead of repeating a longer action list.
- [x] The owner brief deduplicates recommendations and caps them at three actions.
- [x] Restock-risk guidance is prioritized before general report recommendations.
- [x] Previous-period comparison, restock guidance, and the three-action cap are covered in E2E.
- [x] Reports spec, Gherkin scenario, and test matrix now document the compact decision brief.

## Sprint 4 Verification Completed 2026-05-20

- [x] Frontend typecheck: `npm run typecheck`
- [x] Frontend lint: `npm run lint`
- [x] Frontend production build: `npm run build`
- [x] Frontend unit tests: `npm test -- --run` (13 passed)
- [x] Focused reports E2E:
      `npm run test:e2e -- e2e/reports.spec.ts --project=chromium` (2 passed)
- [x] Full frontend E2E: `npm run test:e2e -- --project=chromium` (49 passed, 3 skipped)

## Left From Sprint 4

- [ ] Normalize all report endpoints to tenant timezone for date bounds, daypart grouping, and hour
      grouping.
- [ ] Add deeper cafe product trends: best/worst products by week/month, growth/decline, and slow
      movers.
- [ ] Strengthen inventory recommendations by joining sales velocity with low-stock thresholds in
      backend/service logic.
- [ ] Add employee contribution and staffing cues that stay useful for small teams.
- [ ] Collapse no-data reports into a single guided empty state with one primary CTA.

## Next Sprint Recommendation

Continue Sprint 4: Reports and Business Storytelling, starting with tenant-timezone consistency and
backend-backed product/restock trends.

## Carried Over From Older Production-Review Backlog

- [ ] Clean up the stray Vercel `frontend` project after confirming it is unused.
- [ ] Tenant isolation tests for every tenant-scoped route.
- [ ] Analytics credibility: replace fake-looking landing metrics, add real backend-driven dashboard
      trend comparison, and revisit richer report endpoints before Tax/Discounts work.

## Pre-Beta Ops Checklist

Still required before onboarding the first beta tenant.

- [x] Sentry: backend and frontend DSNs configured, alert rules active.
- [x] Backups: GitHub Actions `db-backup.yml` daily `pg_dump` (artifact 30 d).
      Pro plan upgrade and managed backups deferred to pre-GA.
- [ ] Uptime monitor: add UptimeRobot on `https://pos-project-backend.fly.dev/health` with email alert.
- [x] Support channel: `posprojectsupport@gmail.com` active.
- [x] Beta agreement template: `docs/beta-agreement-template.md`.
- [x] Production deployment Sprint 14: security headers verified in production.
- [x] Verify secure cookies in production: `Secure; HttpOnly; SameSite=Lax` confirmed.

## Release Gate

Stripe live keys and live Checkout are the last step before GA. Production stays in sandbox until the
web app is otherwise complete. See `docs/risk-register.md` for the hardened guard rails.

## Completed Sprints Summary

Detailed retros live in `docs/sprint-planning.md`.

- Sprint 9: Billing: Standard Plan (2026-05-11)
- Sprint 10: App Shell + POS Foundation (2026-05-11)
- Sprint 11: Catalog Management (2026-05-11)
- Sprint 12: Register Core (2026-05-13)
- Sprint 13: Offline Sync + Dead Letter (2026-05-13)
- Sprint 14: Beta Hardening (code) (2026-05-13)
- Sprint 15: Modifiers (2026-05-13, production validated)
- Sprint 16: UX Polish + Onboarding + Mobile Hardening (2026-05-14)
- Kova Audit Sprint 1: Trust, Clarity, and Conversion (2026-05-20, mostly complete)
- Kova Audit Sprint 2: Onboarding and First Value Moment (2026-05-20, functionally complete)
- Kova Audit Sprint 3: POS, Products, Employees, and Inventory Usability (2026-05-20, functionally complete)
- Kova Audit Sprint 4: Reports and Business Storytelling (2026-05-20, in progress)
