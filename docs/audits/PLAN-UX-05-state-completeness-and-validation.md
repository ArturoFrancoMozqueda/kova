# PLAN-UX-05 — State Completeness & Validation Clarity

## Priority and rationale

**Rank 5 of the UX plans.** The app's state coverage is already good (strong empty states, no premature-success, errors never console-only), but three gaps generate avoidable confusion and support load: (1) missing/foreign records and conflicts collapse into a **generic error** instead of a clear 404/409 message (F-ST-1); (2) data views (inventory, orders, reports) have **no local subscription-inactive state** — if access lapses mid-session they can show a generic error rather than a clear "activate to continue" with a CTA (F-SUB-1); (3) several modals use **disable-only validation** (the submit button is simply greyed out with no explanation, leaving the user to guess — F-FRM-1). These are trust-and-support fixes: the user always understands what happened and what to do next.

## Goal

- A missing/foreign record shows a clear "no encontrado" (404) state; a conflict shows a clear 409 message; neither collapses into a generic error.
- Data views render a consistent, actionable "tu prueba/suscripción terminó — activa para continuar" state on a 402, matching Catalog's existing pattern, instead of a generic error.
- Disable-only modals give specific, inline validation feedback so the user knows why they can't submit.

## Current behavior (repository evidence)

- **No distinct 404/409:** `OrderDetail.tsx:50-52,111-125` collapses a missing/foreign order and conflicts into the generic `loadError` card; catalog/inventory/shift conflicts fall through `resolveApiErrorMessage`.
- **402 handled only in Catalog:** `CatalogView.tsx:150-160` maps a 402 to a billing CTA; inventory/orders/reports rely on the global `BillingBanner` (`AppShell.tsx:262`) + backend 402 and otherwise show a generic error.
- **Disable-only modals:** `InventoryView.tsx:478-481` (`amount = Number(amount)`, no range feedback), `CashMovementModal.tsx:37,47` (`amount && reason`), OpenShift/CloseShift — submit disabled with no specific message. Contrast: Catalog price and ResetPassword give specific inline validation.

## Problems identified

1. F-ST-1: no distinct 404/409 states → confusing generic errors on missing records/conflicts.
2. F-SUB-1: no local subscription-inactive state on inventory/orders/reports → generic error when access lapses.
3. F-FRM-1: disable-only validation on several modals → user can't tell why submit is blocked.

## Scope

**Included:** `OrderDetail.tsx`, `CatalogView.tsx`/`InventoryView.tsx`/`OrderListView.tsx`/`ReportsView.tsx` (402 + 404/409 handling), the disable-only modals (`InventoryView`/`InventoryModal`, `CashMovementModal`, `OpenShiftModal`, `CloseShiftModal`), and the shared error helper `lib/apiError.ts`/`resolveApiErrorMessage`. **Excluded:** backend behavior (it already returns 402/404/409 correctly), billing lifecycle (companion PLAN-01), the modal a11y work (PLAN-UX-01).

## Exact files to modify

- **`frontend/src/lib/apiError.ts`** (and/or `resolveApiErrorMessage`) — expose the HTTP status so views can branch on 402/404/409 distinctly; provide standard es-MX messages for each.
- **`frontend/src/orders/OrderDetail.tsx`** (`:50-52,111-125`) — render a distinct "Orden no encontrada" (404) state (with a back-to-orders CTA) and a distinct conflict (409) message, instead of the generic `loadError`.
- **`frontend/src/inventory/InventoryView.tsx`, `orders/OrderListView.tsx`, `reports/ReportsView.tsx`** — on a 402, render the same billing-CTA state Catalog uses (`CatalogView.tsx:150-160`) — factor it into a small shared `SubscriptionInactiveState` component and reuse.
- **New `frontend/src/components/SubscriptionInactiveState.tsx`** — shared "activa para continuar" panel with a "Ir a Facturación" CTA (reuse the copy from `BillingBanner`).
- **`frontend/src/inventory/InventoryView.tsx` (InventoryModal), `shifts/CashMovementModal.tsx`, `shifts/OpenShiftModal.tsx`, `shifts/CloseShiftModal.tsx`** — replace disable-only gating with specific inline validation (e.g. "Ingresa un monto mayor a 0", "El motivo es obligatorio", "La cantidad contada no puede ser negativa"), keeping the submit disabled but explaining why.

New files: `SubscriptionInactiveState.tsx`, tests.

## Dependencies

- Relies on the backend already returning correct 402/404/409 (confirmed in the companion audit). No backend change.
- Complements PLAN-UX-01 (modal a11y) — validation messages must be associated via `aria-describedby` (coordinate so both land cleanly on the same modals).

## Step-by-step implementation order

1. **Expose status in the error helper** (`lib/apiError.ts`). Behavior: views can branch on status. Tests: unit — helper surfaces 402/404/409.
2. **404/409 states in OrderDetail** (and any other id-fetch view). Behavior: distinct, actionable messages. Tests: RTL — a 404 renders "no encontrada" + back CTA; a 409 renders the conflict message.
3. **Shared SubscriptionInactiveState + wire into inventory/orders/reports.** Behavior: consistent 402 → activate CTA. Tests: RTL — a 402 on each view renders the billing CTA, not a generic error.
4. **Specific validation on disable-only modals.** Behavior: inline messages explain why submit is blocked; associate via `aria-describedby`. Tests: RTL — empty/invalid fields show the specific message.

## Edge cases

- **404 vs 403 (foreign tenant):** the backend may return 403 or 404 for a foreign order (companion notes both are used). The UI should show a non-leaky "no encontrada / no disponible" for both — never reveal that the id exists in another tenant.
- **402 mid-session:** if a trial expires while the user is on inventory, the next fetch 402s — the view must swap to the SubscriptionInactiveState, not a transient generic error; and the global banner should not double up confusingly.
- **409 on shift open** (companion D7 — concurrent open): once the backend enforces a single open shift, the UI must show "ya hay un turno abierto" (not a generic error) — coordinate with PLAN-04.
- **409 on idempotent retry:** a replayed create that conflicts should be treated as success where appropriate (offline dedup) — don't show a scary conflict for a benign replay.
- **Validation for negative inventory** (companion D5/PLAN-04): the modal message should match the backend's `WOULD_GO_NEGATIVE` rejection so client and server agree.
- **Read-only/permission (403) vs 402:** distinguish "no tienes permiso" from "activa tu suscripción" — different CTAs.
- **Offline:** a network failure should show the offline/retry state, not a 404/402 (don't misclassify a network error as not-found).

## Security requirements

- 404/403 messaging must not leak cross-tenant existence (uniform "no disponible").
- No change to backend authorization; the UI only presents the backend's status more clearly.
- Validation is UX; server-side validation remains authoritative.

## Data migration and rollback

- **None** — pure frontend. Rollback = revert the commits.

## Testing strategy

- **Unit/RTL:** error helper status branching; OrderDetail 404/409 states; SubscriptionInactiveState on inventory/orders/reports 402; specific validation messages on the four modals.
- **Integration/e2e:** simulate a 402 (blocked tenant) and confirm each data view shows the activate CTA; simulate a missing order id → 404 state.
- **Regression:** existing view tests green; coordinate with PLAN-UX-01 so `aria-describedby` associations hold.
- **Manual:** with a blocked/trial-expired tenant, visit inventory/orders/reports and confirm consistent messaging.

Exact test files: `frontend/src/lib/apiError.test.ts` (extend), `frontend/src/orders/OrderDetail.test.tsx` (extend), `frontend/src/components/SubscriptionInactiveState.test.tsx` (new), `frontend/src/inventory/InventoryView.test.tsx` / `shifts/*Modal.test.tsx` (extend).

## Observability

- Optional funnel/telemetry: `subscription_inactive_state_shown` (how often users hit the wall — informs conversion), and a count of 404/409 states shown (surfacing broken links or conflict hotspots). No PII.

## Acceptance criteria

- Given a request for a missing or foreign order, when OrderDetail loads, then it shows a clear "no encontrada / no disponible" state with a back-to-orders CTA (no cross-tenant leak), distinct from a generic error.
- Given a tenant whose access has lapsed, when they open inventory, orders, or reports, then each shows a consistent "activa tu suscripción para continuar" panel with a Facturación CTA, not a generic error.
- Given a conflict (e.g. second shift open), when it occurs, then the UI shows a specific conflict message ("ya hay un turno abierto"), not a generic error.
- Given the inventory/cash-movement/shift modals, when a required field is empty or invalid, then a specific inline message explains why submit is blocked (and is associated via `aria-describedby`).

## Verification commands

```bash
npm --prefix frontend run lint && npm --prefix frontend run typecheck
npm --prefix frontend test -- apiError OrderDetail SubscriptionInactiveState InventoryView
npm --prefix frontend run test:e2e -- billing-banner routing
npm --prefix frontend run build
```

## Definition of done

- Distinct 404/409 states where records are fetched by id; no cross-tenant leak.
- Consistent local subscription-inactive state across inventory/orders/reports (shared component).
- Specific inline validation on the previously disable-only modals, `aria-describedby`-associated.
- Tests green; lint/typecheck/build pass.

## Risks and mitigations

- **Risk:** misclassifying a network error as 404/402. **Mitigation:** branch on explicit status; fall back to the offline/retry state otherwise.
- **Risk:** 404/403 messaging leaks cross-tenant existence. **Mitigation:** uniform "no disponible" for both.
- **Risk:** duplicate messaging (global banner + local state). **Mitigation:** suppress the local panel when the global banner already covers the same state, or vice-versa — pick one per context.
