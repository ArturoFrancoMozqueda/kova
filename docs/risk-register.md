# Risk Register

This document tracks the highest-risk areas of the POS SaaS project.

## Risk Summary

| Risk | Severity | Probability | Mitigation | Owner |
|---|---:|---:|---|---|
| Tenant data leakage | Critical | Medium | tenant_id everywhere, RLS, cross-tenant tests, authz matrix | Engineering |
| Money rounding bugs | Critical | Medium | Decimal only, golden tests, no floats lint, property tests | Engineering |
| Duplicate offline sales | Critical | Medium | client_uuid, idempotency keys, sync tests, dead-letter UI | Engineering |
| Data loss during offline sync | Critical | Medium | Dexie queue, retry policy, recoverable failed state, E2E offline tests | Engineering |
| Weak authorization | High | Medium | centralized RBAC, permission constants, endpoint tests | Engineering |
| Billing webhook bugs | High | Medium | webhook idempotency, event log, state from webhook only | Engineering |
| Live billing flow lacks a current full production lifecycle verification | Critical | Medium | retain strict live/test guards and require a dated live Checkout, webhook and subscription-state acceptance before public selling | Engineering/Product |
| Stale PWA app shell after deployment | High | Medium | Workbox outdated cache cleanup, early service worker update checks, production smoke for returning browsers | Engineering |
| Scope creep | High | High | current-sprint.md, deferred-scope.md, strict beta scope | Product/Engineering |
| Over-engineering | High | Medium | modular monolith, no microservices, avoid Kafka/GraphQL/custom auth | Engineering |
| Solo-engineer burnout | High | Medium | smaller sprints, 60% capacity planning, defer non-beta scope | Product |
| Poor beta onboarding | Medium | Medium | bakery preset, onboarding checklist, founder-assisted onboarding | Product |
| Support overload | Medium | Medium | limit beta tenants, support runbooks, Sentry/logs/request_id | Product/Support |
| Legal/compliance gaps | Medium | Medium | beta agreement, privacy notice, legal review before GA | Product |
| Infrastructure fragility | High | Low/Medium | GitHub Actions PostgreSQL 17 `pg_dump` daily backup to Cloudflare R2 with 7-day retention, restore drill before broad paid beta, staging, rollback plan | Engineering |
| Performance issues | Medium | Medium | indexes, p95 targets, load tests before GA | Engineering |
| Stripe dependency | Medium | Low | accept for v1, isolate billing adapter | Engineering |
| Offline UX confusion | Medium | Medium | clear sync indicator, dead-letter UX, user recovery actions | Design/Engineering |
| Offline queue cross-tenant ownership or stuck leases | Critical | Medium | tenant-scoped Dexie rows, legacy quarantine, recoverable leases, A/B and crash tests | Engineering |
| Out-of-order Stripe webhook state | Critical | Medium | persisted event watermark, stale-event policy, authoritative reconciliation, test-mode gate | Engineering |
| Incomplete production RLS posture | Critical | Medium | dedicated non-owner runtime role, fail-closed boot checks, two-tenant smoke | Engineering |
| Deploy accepted without post-deploy smoke | Critical | Medium | commit-pinned Vercel/Fly deploys and non-skippable production smoke | Engineering |

## Critical Risks

### Tenant Data Leakage

Severity: Critical

Why it matters:
A multi-tenant SaaS cannot allow one business to see another business’s data.

Mitigation:

- Add `tenant_id` to all tenant-scoped tables.
- Use application-level tenant scoping.
- Use PostgreSQL RLS where applicable.
- Add cross-tenant BDD scenarios.
- Test guessed IDs.
- Test forged tenant_id payloads.
- Add authz matrix tests.

Release gate:
No beta release unless tenant isolation tests pass.

### Money Rounding Bugs

Severity: Critical

Why it matters:
POS systems handle money. Rounding bugs damage trust immediately.

Mitigation:

- Use Decimal for all money values.
- Ban floats in money modules.
- Store currency on orders.
- Add golden test fixtures.
- Add property-based tests where useful.
- Add manual examples for cash change, refunds, split payments, discounts, and taxes.

Release gate:
No sale/payment/refund feature closes without money tests.

### Duplicate Offline Sales

Severity: Critical

Why it matters:
Offline sync can create duplicate sales if retries are not idempotent.

Mitigation:

- Use `client_uuid`.
- Use `Idempotency-Key`.
- Persist local queue status.
- Sync retries must reuse the same idempotency identity.
- Server must return existing order for duplicate sync.
- Add Playwright offline tests.

Release gate:
No beta release unless duplicate sync tests pass.

### Data Loss During Offline Sync

Severity: Critical

Why it matters:
A POS cannot lose sales when the network drops.

Mitigation:

- Dexie queue.
- pending/syncing/synced/failed states.
- Exponential backoff.
- Dead-letter view.
- Manual recovery actions.
- No auto-delete of failed sales.
- Server timestamps authoritative.

Release gate:
Offline E2E scenarios must pass.

### Live Billing Requires Full Production Lifecycle Verification

Severity: Critical

Why it matters:
A buyer can reach Checkout while a configuration, webhook or state-convergence defect still prevents
a reliable paid subscription. Test-mode evidence reduces technical risk but cannot certify the live
account, live endpoint or the complete production customer journey.

Current evidence:
The 2026-07-21 read-only production diagnosis recorded a live key, Price and webhook configuration
and reconciled the Stripe-backed subscriptions it could identify. The 2026-09-07 disposable drill
completed Checkout and the subscription lifecycle in Stripe test mode. Neither record is a dated
full live-mode purchase/lifecycle acceptance for the current release.

Mitigation:

- Keep `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION` disabled for live selling.
- Verify the production `STRIPE_SECRET_KEY`, Standard Plan Price and webhook endpoint remain in the
  same live account before release.
- Keep backend startup validation that rejects test Stripe keys unless sandbox mode is explicitly enabled.
- Keep checkout runtime validation that rejects test Checkout Session ids unless sandbox mode is explicitly enabled.
- Run `npm run test:production-smoke` with `PRODUCTION_SMOKE_STRIPE_MODE=live` before public selling.

Release gate:
No public selling until production smoke proves Checkout redirects with a live `cs_live` session and
the webhook activates a subscription.

### Stale PWA App Shell After Deployment

Severity: High

Why it matters:
Returning users can see old pricing, old copy, or stale flows after a deployment, creating conflicting
business claims and support confusion.

Mitigation:

- Enable outdated cache cleanup in the PWA service worker.
- Check for service worker updates early and periodically.
- Keep visible app update prompt behavior.
- Add a returning-browser smoke scenario before paid beta.

Release gate:
Before selling, fresh and returning browsers must show the same current landing and app shell.

### Scope Creep

Severity: High

Why it matters:
A small team cannot build a universal POS before validating the core.

Mitigation:

- Use `docs/current-sprint.md`.
- Use `docs/deferred-scope.md`.
- Keep beta focused on bakery/small food retail.
- Reject work not tied to current or next sprint.
- One vertical at beta.

Release gate:
No deferred feature enters beta without explicit approval.

## Review Cadence

Review this document:

- At the start of each sprint
- Before closed beta
- Before GA
- After any production incident
