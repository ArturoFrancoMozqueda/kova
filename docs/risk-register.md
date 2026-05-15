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
| Scope creep | High | High | current-sprint.md, deferred-scope.md, strict beta scope | Product/Engineering |
| Over-engineering | High | Medium | modular monolith, no microservices, avoid Kafka/GraphQL/custom auth | Engineering |
| Solo-engineer burnout | High | Medium | smaller sprints, 60% capacity planning, defer non-beta scope | Product |
| Poor beta onboarding | Medium | Medium | bakery preset, onboarding checklist, founder-assisted onboarding | Product |
| Support overload | Medium | Medium | limit beta tenants, support runbooks, Sentry/logs/request_id | Product/Support |
| Legal/compliance gaps | Medium | Medium | beta agreement, privacy notice, legal review before GA | Product |
| Infrastructure fragility | High | Low/Medium | GitHub Actions pg_dump daily backup (artifact 30d), restore drill before GA, staging, rollback plan | Engineering |
| Performance issues | Medium | Medium | indexes, p95 targets, load tests before GA | Engineering |
| Stripe dependency | Medium | Low | accept for v1, isolate billing adapter | Engineering |
| Offline UX confusion | Medium | Medium | clear sync indicator, dead-letter UX, user recovery actions | Design/Engineering |

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
