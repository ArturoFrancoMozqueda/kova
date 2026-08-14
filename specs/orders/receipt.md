# Receipt Spec (Sprint 5, Updated Sprint 6)

## Problem Statement

After a sale (or refund/void), a cashier or customer needs a complete receipt to confirm what was purchased, how it was paid, and any corrections made. Sprint 5 extends the Sprint 3 receipt stub with refund/void information and improved formatting for on-screen display and eventual printing.

## Target Users

- Cashier
- Customer
- Manager
- Tenant owner

## Business Value

Receipts are legally required for retail transactions, build customer trust, and provide a record for reconciliation and returns.

## Functional Requirements

- The receipt displays core order information: order number, date/time, items, quantities, prices.
- The receipt displays payment breakdown: payment methods, amounts, change due.
- The receipt displays tenant business name and contact info from tenant settings.
- The receipt displays refunds applied to the order (if any).
- The receipt displays void status (if order is voided).
- The receipt is formatted for terminal/POS display (fixed-width text suitable for 80-char printer).
- The receipt includes a short order ID (last 8 chars of UUID, uppercase) for easy reference.
- Refund receipts show the refund reason and refunded amount.
- Receipt data is immutable once generated (snapshot of state at retrieval time).
- The order detail page exposes an `Imprimir ticket` action for completed or corrected orders.
- The print action uses the same receipt template rendered on screen, so reprints match the receipt preview.
- Browser printing uses the tenant's configured 58 mm or 80 mm paper width and defaults to 80 mm.

## Non-Functional Requirements

- Display money with correct locale formatting (e.g., MXN currency).
- Use tenant timezone for display timestamps (store in UTC).
- Do not expose sensitive order data (e.g., internal IDs, payment method details beyond type).

## Permissions

- Receipt retrieval requires authenticated tenant session.
- Tenant isolation: user can only retrieve receipts for orders in their tenant.

## API Impact

- `GET /api/v1/orders/{order_id}/receipt` — get formatted receipt (JSON)
- Response includes: `order_id`, `receipt_number`, `tenant_name`, `created_at`, `status`, `items`, `subtotal_amount`, `total_amount`, `payments`, `refunds`, `total_tendered`, `total_change`.

## Receipt Format (Terminal)

```
================
  TENANT NAME
================
Order: ABC12345
Date: 2026-01-15 14:32 UTC

Items:
  Pan Dulce x 2      $12.00
  Coffee x 1         $45.00
                     ------
Subtotal:          $57.00
Total:             $57.00

Payments:
  Cash              $60.00
  Change            ($3.00)

Thank you!
================
```

## Refund Display

If refunds exist:

```
Refund (Defective):
  Pan Dulce x 1     ($12.00)
  Reason: defective
```

## Void Display

If order is voided:

```
[VOIDED]
Original Total: $57.00
Reason: operator_error
```

## Error States

- Missing auth returns `401`.
- Order from another tenant returns `404`.
- Order not found returns `404`.

## Data Model Impact

- No new tables required.
- Uses existing `orders`, `order_items`, `payments`, `refunds` data.

## Deferred

- PDF rendering
- Email delivery
- Hardware printer SDK
- Silent/background printing
- QR code
- Folio number
- Receipt history/archival

## Acceptance Criteria

- A cashier can retrieve a receipt for a completed order.
- Receipt displays order items, quantities, and prices correctly.
- Receipt displays payment breakdown.
- Receipt displays refunds (if any) with reason.
- Receipt displays void status (if voided).
- Receipt formatted for 80-character terminal display.
- Clicking `Imprimir ticket` from `/orders/{id}` opens the browser print dialog.
- Browser print output isolates the receipt content and hides surrounding app chrome/actions.
- 58 mm and 80 mm print roots select their matching named browser page size.
- Tenant B cannot retrieve Tenant A's receipts.
