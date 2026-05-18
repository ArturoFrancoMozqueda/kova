# Register Shift Gate

## Decision

For closed beta, selling without an open shift is allowed but warned. This avoids blocking offline
sales and early beta usage while making the operational expectation explicit.

The hard-block option is deferred until tenants confirm they want strict cash-drawer enforcement.

## Acceptance Criteria

- Register checks whether a shift is open.
- If no shift is open, register shows a warning with a link to shifts.
- Creating a sale without a shift still succeeds.
- Dashboard onboarding still treats opening a shift as a setup step.
- Backend order creation remains unchanged for offline sync compatibility.

## Test Matrix

| Scenario | Layer | Expected |
|---|---|---|
| No open shift | E2E | Register shows warning and Open shift link. |
| Sale without shift | E2E/API | Sale is accepted during beta. |
| Shift opened | E2E | Warning disappears after refresh/reload. |
