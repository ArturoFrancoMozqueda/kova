# ADR-006: Specification-Driven BDD for Critical Business Behavior

## Status

Accepted

## Context

The MVP had no automated tests. That makes production confidence low.

A POS has critical business behavior that must be specified before implementation.

## Decision

Use specification-driven development.

P0/P1 user-facing business behavior requires:

- Feature Spec
- Gherkin scenarios
- Test matrix
- Automated tests where feasible

BDD is required for behavior, not for every implementation detail.

## Consequences

### Positive

- Less ambiguity.
- Better regression safety.
- Easier for Claude Code to implement correctly.
- Better review process.

### Negative

- More upfront planning.
- Can become heavy if applied to trivial helpers.

## Rules

BDD required for:

- tenant isolation
- auth/session refresh
- catalog behavior
- order creation
- payments
- refunds
- inventory
- shifts
- offline sync
- billing
- reporting permissions

BDD not required for:

- tiny helpers
- internal utility functions
- trivial repository methods
- pure implementation details
