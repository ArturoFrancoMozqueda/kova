# Spec — Receipt Stub (Sprint 3)

## Problem Statement

After a sale, a cashier or customer needs a receipt to confirm what was purchased
and how it was paid. Sprint 3 delivers a JSON receipt response; PDF and email
delivery are deferred.

## Receipt Contents

| Field | Source |
|---|---|
| `order_id` | Order UUID |
| `receipt_number` | Last 8 chars of order UUID, uppercased |
| `tenant_name` | Tenant record |
| `created_at` | Order `created_at` (ISO 8601 UTC) |
| `status` | Order status |
| `items` | Order line items (name, qty, unit price, line total) |
| `subtotal_amount` | Order subtotal |
| `total_amount` | Order total |
| `payments` | All payment entries for this order |
| `total_tendered` | Sum of `amount_tendered` across cash payments |
| `total_change` | Sum of `change_due` across all payments |

## API

```
GET /api/v1/orders/{order_id}/receipt
Authorization: valid session (any tenant member)
Tenant scope enforced — 404 if order belongs to another tenant
```

## Deferred

PDF rendering, email delivery, print HTML, QR code, folio number.

## Test Matrix

| Scenario | Layer | Tag |
|---|---|---|
| Single payment receipt | Integration | orders |
| Split payment receipt totals | Integration | money, orders |
| Receipt for unknown order → 404 | Integration | orders |
