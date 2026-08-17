# Proveedores, compras y recepción

## Estado y gates

Especificado, no implementado. La activación requiere entrada explícita en `docs/current-sprint.md`,
validar el flujo con pilotos y decidir la política de costo (último costo o promedio ponderado). La
recepción con variantes depende además del contrato de variantes; productos simples pueden entrar
primero sin esa dependencia.

## Alcance

El owner o manager registra proveedores, prepara una orden de compra y confirma una o varias
recepciones. Sólo una recepción confirmada aumenta existencias. Facturas por pagar, CFDI de compra,
pagos a proveedor y multi-almacén quedan fuera de V1.

## Modelo propuesto

- `suppliers`: `id`, `tenant_id`, `name`, `tax_id nullable`, `email nullable`, `phone nullable`,
  `notes nullable`, `is_active`, timestamps. `tax_id` se normaliza pero no se valida como autorización
  fiscal.
- `purchase_orders`: `id`, `tenant_id`, `supplier_id`, `status` (`draft`, `sent`,
  `partially_received`, `received`, `cancelled`), `currency` fijo `MXN`, `expected_at nullable`,
  `supplier_reference nullable`, `notes nullable`, `created_by_user_id`, timestamps.
- `purchase_order_items`: `id`, `tenant_id`, `purchase_order_id`, `product_id`,
  `product_variant_id nullable`, `description_snapshot`, `sku_snapshot nullable`, `ordered_quantity`,
  `unit_cost`, `received_quantity`, timestamps.
- `goods_receipts`: `id`, `tenant_id`, `purchase_order_id`, `status` (`draft`, `confirmed`,
  `cancelled`), `received_at`, `supplier_document_ref nullable`, `created_by_user_id`,
  `confirmed_by_user_id nullable`, timestamps.
- `goods_receipt_items`: `id`, `tenant_id`, `goods_receipt_id`, `purchase_order_item_id`,
  `received_quantity`, `unit_cost_snapshot`, `inventory_movement_id nullable`.

Cantidades y costos usan `Decimal`; cantidades son positivas. Cada tabla conserva `tenant_id` para
RLS y verificaciones de consistencia. Proveedor, producto, variante, orden y recepción deben pertenecer
al mismo tenant.

## Estados e invariantes

- Sólo un borrador puede editarse o cancelarse sin movimiento de inventario.
- Confirmar es una transición transaccional: bloquea filas de orden, valida saldo pendiente, crea un
  movimiento `purchase_receipt` por renglón y actualiza cantidades recibidas/estado exactamente una vez.
- La suma recibida no supera la ordenada en V1. El sobre-recibo exige una decisión posterior explícita.
- Una recepción confirmada es inmutable. La corrección se hace mediante un ajuste enlazado y auditado,
  no reescribiendo el ledger.
- Cancelar una orden con recepción confirmada está prohibido; puede cerrarse tras completar el saldo.
- La política de costo aprobada se ejecuta dentro de la misma transacción. Hasta decidirla, esta épica
  no debe alterar `products.cost`.

## API propuesta

- `GET|POST /api/v1/suppliers`; `GET|PATCH /api/v1/suppliers/{id}`.
- `GET|POST /api/v1/purchase-orders`; `GET|PATCH /api/v1/purchase-orders/{id}`.
- `POST /api/v1/purchase-orders/{id}/send` y `/cancel`.
- `POST /api/v1/purchase-orders/{id}/receipts` crea borrador.
- `PATCH /api/v1/goods-receipts/{id}` edita borrador.
- `POST /api/v1/goods-receipts/{id}/confirm` requiere `Idempotency-Key`.

El servidor calcula subtotales y saldos. Nunca acepta `tenant_id`, total calculado, cantidad ya recibida
ni estado final controlados por el cliente. Los listados tienen paginación y filtros por estado/proveedor.

## Seguridad, auditoría e idempotencia

- Permisos: `suppliers.read/write`, `purchases.read/write`, `purchases.receive`.
- Default propuesto: owner/manager; cashier sin acceso. El rol definitivo se aprueba antes de migrar.
- RLS y service layer filtran siempre por tenant; recursos ajenos responden `404`.
- Eventos: `supplier.created/updated`, `purchase_order.created/sent/cancelled`,
  `goods_receipt.confirmed`, con IDs, actor y cantidades, sin copiar notas sensibles innecesarias.
- El hash idempotente de confirmación incluye recepción, líneas normalizadas y versión de política. Replay
  idéntico devuelve el mismo resultado; misma key con otro payload devuelve `409`.

## Offline

V1 es online-only. No se permite confirmar recepción ni editar compras desde una caché offline. El
catálogo local se invalida/actualiza después de confirmar. Una versión futura necesitará cola propia,
leases y resolución de concurrencia; no reutilizará ciegamente el contrato de venta offline.

## Aceptación

- Recepciones parciales actualizan saldo, kardex y estado sin duplicar inventario al reintentar.
- Dos confirmaciones concurrentes no sobre-reciben ni crean movimientos dobles.
- La falla de cualquier renglón revierte recepción, movimientos y estado completos.
- Tenant B no puede descubrir proveedor, orden o recepción de tenant A.
- Dinero/cantidades pasan casos Decimal y los reportes reconcilian con el ledger.
- Tests unitarios, integración Postgres/RLS, BDD de estados y E2E del flujo teclado/móvil.
