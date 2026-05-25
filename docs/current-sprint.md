# Current Sprint

Last updated: 2026-05-25

## Source Of Truth

This file is the active execution board only.

- Current execution target and release gates live here.
- Historical sprint notes, completed audit findings, and future roadmap live in
  `docs/sprint-planning.md`.
- Operational runbooks live in `docs/runbooks/`.
- Risks live in `docs/risk-register.md`.
- Do not duplicate detailed acceptance criteria here; link to the owning spec, runbook, or planning
  section instead.

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
| Support/legal | Beta agreement exists; branded support and `/seguridad` still open. |

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

## Active Release Gates

These block broad selling and should be closed before live Stripe or more than founder-assisted
controlled tenants.

- [ ] Stripe live checkout full-flow verified:
      checkout, webhook, active subscription, retry/past_due, grace period, cancel, and resume
      behavior if supported.
- [ ] Post-checkout, welcome, and trial-ending emails verified against real inbox providers
      (Gmail, Outlook/Hotmail at minimum).
- [ ] Restore drill completed from a real R2 backup into a fresh Supabase project and documented in
      `docs/runbooks/restore-supabase-backup.md`.
- [ ] Beta agreement signed by first paid tenants.
- [ ] Domain/support path confirmed:
      current support is `posprojectsupport@gmail.com`; preferred future path is a branded support
      address once the domain/mailbox decision is final.
- [ ] `/seguridad` plan or page confirmed, covering tenant isolation, HttpOnly cookies, backups,
      uptime monitoring, and support expectations.
- [ ] Production smoke on custom domain completed after the Vercel rewrite deploy:
      login, signup, session refresh, billing subscription fetch, catalog load, register sale,
      reports, settings, `/api/health`, and `/api/health/db`.

## Known Follow-Ups

These are not blockers for controlled paid beta unless a real tenant hits them.

- [ ] Clean up the stray Vercel `frontend` project after confirming it is unused.
- [ ] Decide whether employee management should graduate from Settings to first-class navigation
      after beta usage data.
- [ ] Add invitation acceptance-path E2E once that flow is finalized.
- [ ] Decide whether the cafe preset needs modifier groups for milk/size, or keep modifiers as a
      later usability pass.
- [ ] Replace remaining audit-era historical references in `docs/ux-review-2026-05-19.md` only if
      that file stops being treated as historical evidence.

## Verification Baseline

Recent documented verification:

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
