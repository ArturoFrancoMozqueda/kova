# Current Sprint

Last updated: 2026-09-07

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
