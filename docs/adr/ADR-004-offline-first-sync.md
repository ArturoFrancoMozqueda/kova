# ADR-004: Offline-First Sync for POS Register

## Status

Accepted

## Context

POS systems must keep working during network outages.

The MVP proved offline-first behavior is valuable, but sync failure states must be stronger than a dead synced=2-style state.

## Decision

The register flow must be offline-first.

Use Dexie on the frontend for a local sale queue.

Use server-side idempotency to avoid duplicate orders.

Use dead-letter recovery for failed syncs.

## Local States

- pending
- syncing
- synced
- failed

## Retry Policy

Use exponential backoff.

Example:

- 2 seconds
- 4 seconds
- 8 seconds
- 16 seconds
- 32 seconds
- 60 seconds
- 60 seconds

After threshold is reached, move to failed/dead-letter.

## Consequences

### Positive

- Cashiers can keep selling.
- Better trust during outages.
- Reduced duplicate sales risk.

### Negative

- More complex frontend.
- More complex conflict handling.
- Requires strong E2E tests.

## Rules

- Offline sales must not disappear automatically.
- Retried sync must reuse the same client_uuid/idempotency identity.
- Server must return existing order for duplicate sync.
- Failed sync must show recovery actions.
