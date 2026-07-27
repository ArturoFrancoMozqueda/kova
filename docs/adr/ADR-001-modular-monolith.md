# ADR-001: Use a Modular Monolith

## Status

Accepted

## Context

We are building a new POS SaaS with a small team.

The product requires:

- Multi-tenancy
- Auth/RBAC
- Catalog
- Orders
- Payments
- Offline sync
- Shifts
- Inventory
- Billing
- Reporting

A microservices architecture would introduce operational complexity before the product has usage, revenue, or scale pressure.

## Decision

Use a modular monolith.

The backend should be one deployable service with clear internal domain boundaries.

Suggested domains:

- auth
- tenants
- users
- rbac
- catalog
- orders
- payments
- refunds
- inventory
- shifts
- reports
- billing
- sync
- audit
- idempotency
- settings

## Consequences

### Positive

- Faster development.
- Simpler deployment.
- Easier debugging.
- Easier transactions across domains.
- Lower operational cost.
- Better fit for 1–2 engineers.

### Negative

- Requires discipline to maintain boundaries.
- Can become a ball of mud if domain structure is ignored.
- Future extraction may require effort.

## Rules

- Routers stay thin.
- Services own business logic.
- Repositories own persistence.
- Policies own authorization.
- Cross-domain calls should go through services, not direct table access.

