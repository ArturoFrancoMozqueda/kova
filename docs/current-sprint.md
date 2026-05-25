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
| Support/legal | Beta agreement exists; `/seguridad` shipped; branded support address still open. |

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
- [x] CSRF protection hardened (2026-05-25):
      threat model in `docs/security/cookie-csrf-threat-model.md`, double-submit middleware
      in `backend/app/middleware/csrf.py`, frontend wired via `frontend/src/lib/csrf.ts`,
      negative tests in `backend/app/tests/test_csrf.py` and `frontend/src/lib/csrf.test.ts`,
      Stripe webhooks and `X-Internal-Key` paths verified as exempt.

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
- [x] `/seguridad` page shipped at `frontend/src/routes/LegalPage.tsx` (security variant);
      covers tenant isolation (app + RLS), HttpOnly cookies + CSRF, backups, uptime monitoring,
      payment separation, beta expectations, and support; linked from the home footer, the legal
      pages, and the signup trust block; excluded from the SW navigation fallback so deploys
      never serve a stale copy.
- [ ] Production smoke on custom domain completed after the Vercel rewrite deploy:
      login, signup, session refresh, billing subscription fetch, catalog load, register sale,
      reports, settings, `/api/health`, and `/api/health/db`.

## Sellability Audit Follow-Ups

These are detailed follow-ups from the 2026-05-25 sellability review. They should either be closed
before broad self-serve selling or explicitly accepted as controlled-beta risks by the founder.

- [ ] Make production rate limiting deployment-safe:
      replace or front the current single-instance in-memory limiter with a production-safe option
      such as provider/WAF limits or shared Redis-style limits; cover login, signup, password reset,
      sync, uploads, billing checkout, and webhook abuse cases; document limits, user-facing 429
      copy, and alerting expectations.
- [ ] Fix onboarding billing completion logic:
      verify `GET /api/v1/onboarding/state` marks billing complete when the tenant has `active`,
      `trialing`, or allowed paid/grace subscription access; add regression tests for active
      subscription, signup trial, expired trial, and past_due grace; confirm the dashboard checklist
      no longer asks an already-paid tenant to activate the plan.
- [ ] Make email delivery a production gate:
      ensure production cannot silently skip required auth/billing lifecycle emails when Resend (or
      the chosen provider) is missing; add health or startup validation for required email config;
      implement/verify verification, password reset, welcome/post-checkout, billing receipt or
      billing confirmation, and trial-ending reminder flows; test Gmail and Outlook/Hotmail inboxes,
      spam placement, links, sender identity, and Spanish copy.
- [ ] Add frontend performance follow-up:
      review the production bundle warning (~692 kB minified main chunk); decide whether code
      splitting is required before broad selling; if required, split public/auth/app routes and
      heavy report/register surfaces; verify first load on mobile 4G and returning PWA browsers.
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
