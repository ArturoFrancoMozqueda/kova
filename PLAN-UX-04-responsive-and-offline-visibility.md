# PLAN-UX-04 — Responsive Polish & Offline Visibility

## Priority and rationale

**Rank 4 of the UX plans.** Mexican SMB owners and cashiers run Kova on phones. The responsive foundation is strong (dual card/table patterns, bottom-sheet POS, off-canvas + bottom-tab nav), so this is targeted polish, not a rework. Two tables (ShiftView closed-shifts, RefundsAndCancellations) lack the mobile card fallback the rest of the app uses and degrade to horizontal scroll; the **offline indicator is hidden on phones** (sidebar-only, behind the hamburger), so a cashier can't glance-confirm connection/queue state on the exact device most likely to lose signal; split-payment rows are cramped at 360px; a few touch targets are under 44px. This raises daily mobile confidence for the primary usage device.

Cross-references companion `PLAN-03` for offline **correctness** (cold-offline catalog, timestamp, sync resilience). This plan is the offline **visibility/affordance** and responsive layer; do not duplicate PLAN-03's sync work.

## Goal

- No data table forces horizontal scroll on phones: ShiftView and RefundsAndCancellations get a mobile card layout matching the OrderList/ProductInventory pattern.
- An always-visible offline/queue indicator is present on mobile (not hidden behind the hamburger or the collapsed sidebar).
- Split-payment entry is usable at 360px; interactive touch targets are ≥44px.

## Current behavior (repository evidence)

- **Intentional mobile patterns (keep):** `AppShell.tsx:216-299` off-canvas drawer + bottom tab bar + separate desktop collapsible sidebar; `OrderListView.tsx:227-317` cards `sm:hidden` + table `hidden sm:block`; `ProductInventoryAnalysis.tsx:337-389` same dual pattern; `RegisterView.tsx:816-858` bottom-sheet cart; `dialog.tsx:33-51` bottom-sheet modal.
- **Tables without mobile fallback:** `ShiftView.tsx:350` closed-shifts table is `overflow-x-auto` only; `RefundsAndCancellations.tsx:158` is `overflow-x-auto` only.
- **Offline indicator hidden on mobile:** `OfflineIndicator` is rendered only in the sidebar footer and hidden when the sidebar is collapsed (`AppShell.tsx:182`); on phones it's behind the hamburger. The register compensates with queued-sale toasts, but there's no persistent chip.
- **Split-payment cramping:** stacked `Input`/`Select` per payment row inside the mobile bottom sheet (`RegisterView.tsx:964-1085`).
- **Touch targets:** most are ≥44px (cart steppers `h-11 w-11`, payment `min-h-[60px]`, bottom-nav `h-14`); a few icon buttons are `h-10 w-10` (40px) on mobile (`CatalogView.tsx:431,585,598`) and the mobile dialog close is `h-10 w-10`.

## Problems identified

1. F-RSP-1: ShiftView + RefundsAndCancellations tables horizontally scroll on phones (inconsistent with the app's own pattern).
2. F-OFF-1: no always-visible offline/queue indicator on mobile.
3. F-POS-2/F-RSP-2: split-payment rows cramped at 360px.
4. F-RSP-3: a few sub-44px touch targets on mobile.

## Scope

**Included:** `ShiftView.tsx`, `RefundsAndCancellations.tsx` (card fallbacks), `AppShell.tsx` + `OfflineIndicator.tsx` (mobile chip), `RegisterView.tsx` (split-payment layout + touch targets), `CatalogView.tsx` (touch targets). **Excluded:** offline sync correctness (PLAN-03), any backend, non-mobile layout changes.

## Exact files to modify

- **`frontend/src/shifts/ShiftView.tsx`** (`:350`) — add a mobile card list (`sm:hidden`) mirroring OrderList; keep the table `hidden sm:block`.
- **`frontend/src/reports/components/RefundsAndCancellations.tsx`** (`:158`) — same dual card/table pattern.
- **`frontend/src/offline/OfflineIndicator.tsx` + `frontend/src/layout/AppShell.tsx`** — render a compact offline/queue chip that is **always visible on mobile** (e.g. in the top bar next to the hamburger, or as part of the bottom tab bar), showing online/offline + pending-count, linking to `/sync-queue`. Keep the sidebar version for desktop.
- **`frontend/src/register/RegisterView.tsx`** (`:964-1085`) — improve split-payment row layout at 360px (stack labels, full-width inputs, adequate spacing); bump any sub-44px interactive targets.
- **`frontend/src/catalog/CatalogView.tsx`** (`:431,585,598`) — bump icon-button hit areas to ≥44px on mobile (padding/min-size), keeping the visual icon size.

No new files except tests.

## Dependencies

- Reuses the existing OrderList dual-pattern and Tailwind breakpoints; no new libraries.
- The mobile offline chip should reflect the same Dexie `liveQuery` state the sidebar indicator uses (`useSyncQueue`/`useIsOnline`) — reuse, don't reimplement.
- Independent of other UX plans; complements PLAN-03.

## Step-by-step implementation order

1. **Table card fallbacks** (`ShiftView.tsx`, `RefundsAndCancellations.tsx`). Behavior: cards on `<sm`, table on `sm+`. Tests: RTL at a mobile viewport renders cards, not a scrolling table.
2. **Mobile offline chip** (`OfflineIndicator.tsx`, `AppShell.tsx`). Behavior: always-visible online/offline + pending-count on mobile, links to `/sync-queue`. Tests: RTL — chip visible at mobile width; reflects offline + pending count from the queue hook.
3. **Split-payment layout + touch targets** (`RegisterView.tsx`, `CatalogView.tsx`). Tests: RTL/e2e at 360px — split rows readable and operable; icon buttons ≥44px.

## Edge cases

- **Many closed shifts / many refunds:** the mobile card list must virtualize or paginate consistently with the desktop table (don't render hundreds of cards unbounded).
- **Offline chip state churn:** rapid online/offline toggles must not flicker; debounce like the existing indicator.
- **Pending-count while syncing:** the chip should reflect pending vs syncing vs dead-letter counts accurately (reuse `useSyncQueue`).
- **Bottom-tab collision:** if the offline chip goes in the bottom bar, ensure it doesn't crowd the 4 tabs at 360px; if in the top bar, ensure it doesn't overlap the trial chip.
- **Landscape phones / small tablets (768px):** verify the card/table breakpoint (`sm`) lands correctly — 768px is `md`, so tables show; confirm that's intended.
- **Safe-area insets:** the mobile chip and split-payment sheet must respect `env(safe-area-inset-*)` (already used elsewhere).
- **RTL of currency inputs at 360px:** ensure numeric keyboards and change display don't overflow.

## Security requirements

- None new — purely presentational. The offline chip surfaces queue counts already available to the authenticated client; no new data exposure.

## Data migration and rollback

- **None** — pure frontend. Rollback = revert the commits.

## Testing strategy

- **Unit/RTL:** ShiftView + RefundsAndCancellations render cards at mobile width; offline chip visible + reflects queue state; split-payment layout present.
- **E2E (Playwright) at 360/390px:** the offline chip is visible on the register and links to `/sync-queue`; split payment is operable; no horizontal page scroll on shifts/reports.
- **Visual/manual:** re-run the multi-viewport screenshot pass (1440/1024/768/390/360) and diff the target screens.
- **Regression:** existing `mobile.spec.ts`, `shifts`, `reports` tests green.

Exact test files: `frontend/src/shifts/ShiftView.test.tsx` (extend), `frontend/src/reports/components/RefundsAndCancellations.test.tsx` (new/extend), `frontend/src/offline/OfflineIndicator.test.tsx` (new/extend), `frontend/e2e/mobile.spec.ts` (extend).

## Observability

- Optional: a `offline_indicator_opened` funnel event (adoption of the sync-queue link from mobile).
- No new logs.

## Acceptance criteria

- Given a phone viewport (≤390px), when viewing closed shifts or the refunds report, then data renders as cards with no horizontal page scroll.
- Given a phone viewport, when the device is offline or has queued sales, then an always-visible chip shows the state and pending count and links to `/sync-queue`, without opening the hamburger.
- Given the register at 360px, when entering a split payment, then each payment row's inputs are full-width and legible and all interactive targets are ≥44px.
- Given the catalog at 360px, then icon action buttons have a ≥44px touch area.

## Verification commands

```bash
npm --prefix frontend run lint && npm --prefix frontend run typecheck
npm --prefix frontend test -- ShiftView RefundsAndCancellations OfflineIndicator
npm --prefix frontend run test:e2e -- mobile
npm --prefix frontend run build
```

## Definition of done

- No data table forces horizontal scroll on phones.
- Always-visible mobile offline/queue chip linking to `/sync-queue`.
- Split-payment usable at 360px; touch targets ≥44px.
- Tests green; multi-viewport screenshot pass clean; lint/typecheck/build pass.

## Risks and mitigations

- **Risk:** card lists render unbounded on large datasets. **Mitigation:** mirror the desktop table's pagination/limit.
- **Risk:** the mobile chip crowds the top/bottom bar at 360px. **Mitigation:** compact icon + count; test at 360px; place deliberately.
- **Risk:** touch-target padding shifts desktop layout. **Mitigation:** apply size bumps at mobile breakpoints only.
