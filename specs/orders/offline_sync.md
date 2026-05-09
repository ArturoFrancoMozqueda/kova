# Offline Sync Spec

## Problem

The register must not lose sales when the network drops.

## Target Users

- Cashier
- Tenant owner

## Business Value

Offline-first selling is a core POS differentiator and protects revenue during common connectivity interruptions.

## Functional Requirements

- Offline sales are assigned a client-generated `client_uuid`.
- The frontend stores queued sales locally with statuses: `pending`, `syncing`, `synced`, and `failed`.
- The backend accepts queued sales through `POST /api/v1/sync/offline-sales`.
- The backend deduplicates synced sales by `(tenant_id, client_uuid)`.
- Each sale in a sync batch is processed independently.
- Successful sale sync returns the created or previously synced order.
- Failed sale sync returns a per-sale error without blocking the full batch.

## Non-Functional Requirements

- Every synced order remains tenant-scoped.
- Server-side pricing still wins over client-provided assumptions.
- Sync writes use existing order permission checks and audit behavior.
- Sync logs carry normal `request_id`, `tenant_id`, and `user_id`.

## Permissions

- Sync requires `orders.create`.

## Idempotency

- `client_uuid` is the durable offline idempotency key.
- Replaying the same `client_uuid` returns the existing order result.

## Offline Impact

- Frontend queue persists sales locally.
- Manual sync can retry pending and failed sales.
- Failed sales are surfaced as dead letters.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- Duplicate `client_uuid` returns the existing order.
- Invalid product or payment data marks that sale as failed.

## Data Model Impact

- Add nullable `client_uuid` to `orders`.
- Add unique constraint on `(tenant_id, client_uuid)`.

## API Impact

- `POST /api/v1/sync/offline-sales`

## Acceptance Criteria

- Queued sale sync creates an order.
- Replaying the same queued sale does not duplicate the order.
- A failed sale appears in the batch response with a recoverable error.
