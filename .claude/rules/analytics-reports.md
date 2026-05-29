---
paths:
  - "**/*report*"
  - "**/*analytics*"
  - "**/*dashboard*"
  - "**/*metric*"
  - "**/*kpi*"
  - "**/*insight*"
  - "**/*chart*"
---

# Analytics, Reports, and KPI Storytelling Rules

Kova is not only a POS. Its analytics should help small businesses understand what is selling, when money comes in, and what needs attention.

## Non-negotiables

- Production report paths must use real backend data only.
- Do not add fake/demo/sample analytics to production flows.
- If data is missing, use empty states, onboarding prompts, or clear "no data yet" explanations.
- Do not invent KPI definitions. Trace each metric to real tables and fields.
- Do not silently change metric definitions.
- Keep analytics useful for non-technical business owners.

## KPI quality bar

Good Kova metrics should answer:

- How much did I sell?
- What products drive revenue?
- What time/day performs best?
- Which items are low stock or moving slowly?
- What should I restock?
- Are sales improving or declining?
- How does cash flow look over the selected period?
