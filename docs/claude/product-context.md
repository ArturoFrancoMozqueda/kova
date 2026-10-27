# Kova Product Context

Kova is a SaaS POS and business analytics platform for Mexican SMBs.

The product should help owners:

- Sell with order and speed.
- Control products, inventory, and employees.
- Understand business performance through real analytics.
- Know what sells, when sales happen, and where money is coming from.
- Feel that the subscription is worth paying for.

## Positioning

Kova is more than a POS. It combines:

- Point of sale.
- Inventory control.
- Employee/product setup.
- Business reports.
- Operational clarity.

## Product direction requested on 2026-10-18

Evolve toward end-to-end business automation: acquisition, customer conversations, confirmed
orders, verified payments, fulfillment, replenishment and repeat purchases. Connect these steps
to real sales, inventory and costs, with explicit permissions and measurable outcomes. The
[E2E evolution plan](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/plans/PLAN-AUTOMATIZACION-E2E.md) defines competitive evidence, gaps and
phased acceptance. This is future direction, not a claim of current availability or a replacement
for the active sprint and production gates.

The owner subsequently authorized implementation and merge. The internal commercial circuit now
has reviewable catalog intake, explicit opportunity/quote/order/sale attribution, opt-in post-sale
tasks and an inbox/draft/outbox domain. Connected channels remain inactive. Exact validation and
release status: [implementation continuation](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/audits/KOVA-E2E-COMPLETION-2026-10-18.md).

Internal agenda/loyalty have their own bounded contracts. The latest locally validated slice adds
customer service cases: explicit customer/source, branch-scoped assignment, author-attributed
append-only notes and manual deadlines. Closing a case does not compensate a customer, send a
message or change POS data. Source and local validation are recorded in the
[customer service delivery](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/audits/KOVA-SERVICE-CASES-2026-10-19.md); release acceptance remains
separate from implementation, and the full E2E roadmap is not declared complete.

The 2026-10-26 scope adds an owner-issued [digital points card](../../specs/loyalty/digital_card.md)
for the customer to read their actual balance and return to the published menu. It is locally
validated, with production acceptance pending. The authorized continuation adds reviewed menu intake
directly into operational orders, private customer tracking, and owner-defined POS rewards with
atomic checkout and refund restoration. Missing-cost analysis opens the exact catalog record;
historical financial snapshots remain unchanged. The owner then excluded Wallet and paid pass
providers and authorized device-based web cards from the menu. Enrollment is owner opt-in,
creates a new customer with an alias, and uses a separate HttpOnly cookie. A public member code/QR
identifies the customer only in authenticated POS; it cannot authenticate a public balance lookup.
Verified-contact recovery across devices and external provider acceptance remain future work.
Current validation and availability live in the active sprint.

## Target user

The main user is a small or medium business owner in Mexico. They may not be technical. They need clear flows, trustworthy data, and a product that feels professional.

## Product quality bar

The product should feel:

- Premium.
- Reliable.
- Clear.
- Human.
- Fast.
- Worth paying for.
- Simple without feeling basic.

The owner explicitly requires a finished product throughout Kova: no database UUIDs, technical
versions, raw exceptions or implementation labels in ordinary customer/merchant screens.
Prefer business context and record links. A card presents its QR; its number is an explicit
manual alternative. Preserve useful folios, SKU, RFC and fiscal identifiers, and honest billing,
connection and payment states. Diagnostics belong in protected support/operations context.

## Copy voice

Spanish/es-MX by default. Confident but not exaggerated. Clear enough for any owner to understand.
