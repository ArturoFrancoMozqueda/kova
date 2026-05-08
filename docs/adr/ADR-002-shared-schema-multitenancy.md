# ADR-002: Shared Schema Multi-Tenancy

## Status

Accepted

## Context

The product must support many business accounts in one SaaS platform.

Options considered:

1. Database per tenant
2. Schema per tenant
3. Shared database, shared schema with tenant_id

For v1, database/schema per tenant adds too much operational complexity.

## Decision

Use shared database, shared schema multi-tenancy.

Every tenant-scoped table must include `tenant_id`.

Use PostgreSQL Row-Level Security as defense in depth where applicable.

## Consequences

### Positive

- Simpler operations.
- Easier migrations.
- Lower cost.
- Better fit for small tenants.
- Easier reporting within one schema.

### Negative

- Tenant isolation must be extremely disciplined.
- A bad query can become dangerous without RLS/tests.
- Some future enterprise customers may require stronger isolation.

## Rules

- Every tenant-scoped table must include `tenant_id`.
- Every tenant-scoped query must be scoped by tenant.
- Cross-tenant tests are required.
- Forged tenant_id payloads must be ignored/rejected.
- RLS should protect key tenant-scoped tables.
