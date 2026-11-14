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
- Failed sales are surfaced as dead letters. Only a definitive per-sale
  rejection (a `failed` result for that sale, or a single-sale `400`/`413`/`422`)
  or an exhausted retry budget makes a sale `failed`; a failed sale is never
  deleted automatically.
- The worker sends chunks of 25 sales; each request times out after 30 s.
- Transient errors (network failure, timeout, unreadable response, `408`,
  `5xx`, `429`) release the leases without consuming the sale's retry budget
  and retry indefinitely while online with capped backoff (2 s → 2 min).
  `429` honors `Retry-After`.
- The retry budget (5) is only spent by sends whose outcome stays unknown for
  other reasons: an expired lease after a crashed tab or a malformed
  acknowledgement.
- Batch-level `400`/`413`/`422` split the batch in halves until the rejected
  sale is isolated; the rest of the batch still syncs.
- Batch-level `401`/`403`/`409` (session, CSRF or identity) and other
  unexpected `4xx` keep every sale pending without spending retries, and the
  queue view explains that the session must be verified (or that sending is
  paused).
- `synced` rows are purged from the device after 7 days. Pending, syncing,
  failed and quarantined rows are never purged. Local lot refresh reads only
  unconfirmed rows.
- The queue asks the browser once for persistent storage (best effort). If the
  device is out of space, synced copies are dropped and the write is retried
  once; if it still fails, checkout says the sale was not saved and keeps the
  cart, so nothing is lost silently.
- A prepared register can reload without internet without losing queued sales.
- A cold-offline identity does not activate synchronization until the server
  revalidates its session. Reconnection then resumes the same queued UUIDs.

## Error States

- Missing auth returns `401`; queued sales stay pending (see Offline Impact).
- Missing permission or CSRF returns `403`; queued sales stay pending.
- Blocked subscription returns `402`; queued sales stay pending with their UUIDs
  and retry budget intact. Automatic retries pause until access is restored.
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
- Browser acceptance against the real API and PostgreSQL covers cold-offline
  reload and loss of a successful sync response, preserving one sale, one
  payment and one inventory debit at mobile and desktop sizes.
- Once the session is verified again, the register refreshes its catalog,
  inventory and shift so the next cash sale can proceed without reloading.

## Test Matrix

| Contract | Coverage |
| --- | --- |
| Cold-offline reload, lost successful response, deduplication and next cash sale | `frontend/e2e/offline-sale-real.spec.ts`, real API/PostgreSQL/RLS at 390 and 1440 px |
| No queue claims or retry consumption while the browser is offline | `frontend/src/offline/syncWorker.persistence.test.ts` |
| Outages, batch `403` and request timeouts never produce failed sales | `frontend/src/offline/syncWorker.outage.test.ts`, `frontend/src/offline/sync.test.ts` |
| Purge keeps unsynced rows; quota errors never lose a sale silently | `frontend/src/offline/storage.test.ts` |
| Offline identity cannot activate sync until server revalidation | `frontend/src/auth/AuthContext.identity.test.tsx` |
