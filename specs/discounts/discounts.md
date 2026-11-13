# Descuentos de venta

## Estado

Implementado (V1): un descuento por venta en MXN (`discount_amount`) y una tasa adicional
(`tax_rate`) sobre `POST /api/v1/orders` y la cola offline. Cálculo, redondeo, prorrateo por línea,
devoluciones y tickets se describen en `specs/sales-pricing.md`. Lo que sigue en "Pendiente" no
está implementado.

## Autorización (servidor)

- Permiso `orders.discount`: owner y manager. Cashier y staff no lo tienen.
- Venta en línea (`POST /api/v1/orders`, sin `client_uuid`):
  - `discount_amount > 0` sin `orders.discount` → `403`; no se crea venta, pago ni movimiento.
  - `tax_rate` distinta de la tasa predeterminada del negocio
    (`tenant_receipt_settings.default_tax_rate`, `0.00` si no hay configuración) sin
    `orders.discount` → `403`. La comparación es numérica (`16` = `16.00`). Cashier y staff venden
    siempre con la tasa configurada; cambiarla para una venta requiere owner o manager.
  - El permiso se resuelve con la membresía de la sesión, nunca con datos del navegador.
- Canje de recompensa de lealtad: el checkout rechaza descuentos del cliente y aplica el importe de
  la recompensa definido en el servidor, así que no exige `orders.discount`; la tasa sí se valida.
- Precio unitario congelado (`unit_price_amount`) sin `client_uuid` → `400`, como antes.

## Ventas offline (`POST /api/v1/sync/offline-sales`, con `client_uuid`)

Una venta en cola ya se cobró en el mostrador; puede ser legítima aunque se haya calculado con un
catálogo o una tasa desactualizados. Por eso **nunca se rechaza ni se descarta** por estos controles.
Se acepta tal como se cobró y se registra una entrada de auditoría `orders.pricing_review`
(recurso = venta) cuando ocurre cualquiera de estos casos:

- `discount_without_permission`: descuento > 0 y el usuario no tiene `orders.discount`.
- `tax_rate_without_permission`: tasa distinta de la predeterminada y sin `orders.discount`.
- `unit_price_differs_from_catalog`: algún precio unitario congelado difiere del precio vigente del
  producto más modificadores (se audita para cualquier rol).

La entrada guarda `client_uuid`, motivos, descuento, tasa enviada y predeterminada, y por línea
`product_id`, precio cobrado y precio de catálogo. No guarda datos personales. Un reintento
idempotente no duplica la venta ni la entrada de auditoría. Las demás validaciones offline
(producto, inventario, tenant, sucursal, modificadores, pagos) no cambian.

## Errores

- `400`: descuento mayor que el subtotal, tasa fuera de 0-100, precio congelado en línea.
- `403`: descuento o tasa distinta sin `orders.discount` en una venta en línea.

## Pruebas

`backend/app/tests/test_order_pricing_controls.py`: cajero/staff con descuento en línea → 403 sin
venta; manager con descuento y tasa → 201; cajero con tasa distinta a la configurada → 403 y con la
predeterminada → 201; venta offline sin permiso y con precio desactualizado → sincronizada y auditada
una sola vez; venta offline del owner a precio de catálogo → sin auditoría de revisión; precio
congelado en línea → 400. `test_sale_pricing.py` cubre cálculo y devoluciones.

## Pendiente (no implementado)

- Descuentos por línea, porcentuales, con motivo/`reason_code` y límites por rol
  (`discounts.override_limit`).
- Tabla de intenciones de descuento y desglose gross/neto por línea en la respuesta.
- Bandeja en la interfaz para revisar `orders.pricing_review`; hoy sólo vive en auditoría.
- La interfaz de Caja aún permite capturar descuento/tasa a roles sin permiso; el servidor responde
  `403` en línea. Ocultar o explicar el control por rol es trabajo de frontend.
