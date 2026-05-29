# CLAUDE.md

Kova is a production SaaS POS + business analytics platform for Mexican SMBs: React/Vite frontend, FastAPI backend, Supabase/Postgres, Stripe subscriptions, Vercel frontend, Fly backend.

Before editing, inspect the relevant files, current planning docs, API contracts, migrations, existing patterns, and related tests; make the smallest safe change, do not rewrite broad areas unless explicitly requested, and report changed files, tests, and manual QA.

Never weaken auth, cookie-only session handling, Supabase RLS, billing gates, Stripe live/test separation, tenant isolation, offline sync idempotency, data ownership, or production deployment safety; do not read, print, commit, or expose secrets.

Do not change tests, snapshots, fixtures, migrations, seed data, or expected results just to make failures pass; fix implementation first, or clearly explain why expected behavior legitimately changed.

Kova must feel premium, clear, and worth paying for: use real backend data only, no fake/demo analytics in production paths, preserve Spanish/es-MX copy for Mexican SMBs, and prioritize intuitive POS flows plus actionable business storytelling.

## Always follow this working loop

1. Understand the task and classify the risk: copy/UI, frontend behavior, backend/API, auth/security, billing, data/reporting, offline/PWA, database/migration, deployment, or planning.
2. Read the smallest relevant code/docs set before editing.
3. Keep public contracts stable unless the task explicitly requires a contract change.
4. If changing behavior, update or add tests that prove the intended behavior.
5. Run the narrowest relevant checks available in the repo.
6. Summarize what changed, why, how it was validated, and what remains unverified.

## Do not assume

- Do not assume pricing, plan names, Stripe price IDs, tax behavior, billing copy, or subscription rules. Verify in code, migrations, config, Stripe-related files, and planning docs before changing them.
- Do not assume table schemas, RLS policies, tenant identifiers, API payloads, or analytics definitions. Inspect the source of truth first.
- Do not assume demo/sample data is acceptable. Kova production UX must rely on real backend data and empty states when data is missing.

## Reference docs

Use these when relevant instead of loading everything by default:

- `docs/claude/product-context.md` for Kova product, market, UX, copy, and SaaS goals.
- `docs/claude/architecture-context.md` for system architecture and safety boundaries.
- `docs/claude/manual-qa-checklist.md` before finishing meaningful UI/product flows.
- `docs/claude/release-ga-checklist.md` before changes related to launch, billing, auth, onboarding, or production readiness.

Path-specific instructions live in `.claude/rules/`.
