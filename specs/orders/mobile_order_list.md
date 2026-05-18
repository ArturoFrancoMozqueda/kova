# Mobile Order List

## Decision

The orders page renders table rows on tablet/desktop and compact cards below the small breakpoint.
Phone users should not need horizontal scrolling to inspect order date, status, total, or receipt
link.

## Acceptance Criteria

- At 390 px width, the order list uses cards.
- No horizontal page overflow exists at 390 px.
- Each card links to the order detail.
- Filters remain usable at 390 px.

## Test Matrix

| Scenario | Layer | Expected |
|---|---|---|
| Orders at 390 px | E2E | Order cards fit without horizontal overflow. |
| Empty orders at 390 px | E2E | Empty state fits and filter clear action remains visible. |
