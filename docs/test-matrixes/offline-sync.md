# Test Matrix: Offline Sync + Dead Letter

Spec:
- `specs/orders/offline_sync.md`
- `specs/orders/dead_letter.md`

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| OFFLINE-001 | specs/orders/offline_sync.feature | Queued offline sale syncs into an order | Backend BDD | backend/app/tests/bdd/test_offline_sync.py | @p0 @offline @orders @idempotency | Beta | Required | Batch sync happy path |
| OFFLINE-002 | specs/orders/offline_sync.feature | Replaying an offline sale does not duplicate the order | Backend BDD | backend/app/tests/bdd/test_offline_sync.py | @p0 @offline @orders @idempotency | Beta | Required | `client_uuid` dedupe |
| OFFLINE-003 | specs/orders/offline_sync.feature | Invalid queued sale becomes a dead letter | Backend BDD | backend/app/tests/bdd/test_offline_sync.py | @p0 @offline @dead-letter | Beta | Required | Per-sale failure |
| OFFLINE-004 | specs/orders/dead_letter.md | Failed queue entry can be reset to pending | Frontend Unit | frontend/src/offline/queue.test.ts | @offline @dead-letter | Beta | Required | Local recovery helper |
