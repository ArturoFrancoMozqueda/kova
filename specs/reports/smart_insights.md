# Smart Report Insights

## Problem

Owners need reports that explain what happened and what to do next, not just KPI cards. The current report already uses real sales data, but it needs faster date selection, comparative context, and inventory-aware recommendations.

## Target Users

- Owner reviewing daily and weekly performance.
- Manager planning staffing, stock, and payment operations.

## Business Value

Clearer reports increase retention by making the subscription feel like operational control: what sold, when demand concentrated, what payment mix implies, and which stocked products need action.

## Functional Requirements

- Provide date range presets for today, last 7 days, and current month.
- Fetch a previous comparable period for the selected range.
- Compare current vs previous period for net sales, completed orders, average ticket, best daypart, and peak hour when previous data exists.
- Connect low-stock inventory to products sold in the selected period.
- Surface inventory velocity when available, especially products at risk of running out.
- Generate actionable recommendations from real data only.
- Keep the owner-facing decision block compact: show three comparison facts and at most three
  recommended actions.
- Rank recommendations by operational urgency: restock risks first, then backend story actions,
  then secondary operational prompts.
- Keep detailed KPIs and charts available but collapsed behind a single analysis disclosure so the
  first report view does not feel overwhelming.
- Prefer decision-oriented analysis over metric cards: time patterns, product/inventory priority,
  payment/operations risk, and employee comparison only when there is enough staff data.
- Keep all empty states honest; do not show demo or fabricated insights.

## Data Model Impact

No database changes.

## API Impact

No new endpoints. Uses existing:

- `GET /api/v1/reports/business-story`
- `GET /api/v1/reports/sales-by-hour`
- `GET /api/v1/inventory/low-stock`
- `GET /api/v1/inventory/velocity`

## Permissions Impact

Uses existing report and inventory read behavior. If inventory calls fail or are unavailable, report insights degrade gracefully.

## Offline Impact

No offline behavior changes.

## Acceptance Criteria

- A user can apply Today, 7 days, or Month presets and the report reloads for that range.
- If the previous comparable period has data, the report shows clear positive/negative/neutral comparisons.
- If a top-selling product is low in stock, the report recommends restocking that product.
- If velocity indicates a product may run out soon, the report shows a risk recommendation.
- If multiple recommendations exist, the UI shows no more than three so the owner is not overwhelmed.
- If there are sales, the first report view shows summary and decisions first; detailed KPI/chart
  sections are available after opening the detailed analysis control.
- Detailed analysis avoids duplicate KPI cards and organizes charts around business questions:
  when to prepare, what to restock/protect, how payments affect operations, and whether employee
  comparison is meaningful.
- If there are no sales, the report stays empty/honest and does not invent comparisons.
- Existing tests, typecheck, lint, and build pass.
