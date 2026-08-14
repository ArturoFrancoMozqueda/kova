# Descuentos de venta

## Estado y gate

Especificado, no implementado. Requiere 10 pilotos activos, política comercial aprobada y entrada
explícita en `docs/current-sprint.md`.

## Resultado para el usuario

Owner o manager autorizado aplica un descuento de línea o de orden con tipo, valor y motivo. El
ticket, devolución y reporte explican cuánto se descontó sin alterar el precio histórico.

## Contrato funcional

- Tipos: `fixed` y `percentage`; alcance: `line` u `order`.
- Motivo requerido, 1-160 caracteres, más `reason_code` configurable de catálogo controlado.
- Un descuento de orden se prorratea entre líneas por base neta, con residuo asignado de forma
  determinista a la línea de mayor base y luego por `order_item.id`.
- Descuentos de línea se aplican antes del prorrateo de orden; impuestos usan la base posterior.
- El total de una línea y el total de orden nunca pueden ser negativos.
- Devolución usa el neto/descuento prorrateado original; no recalcula con la política vigente.
- Void revierte inventario y excluye la venta de netos, pero conserva snapshots/auditoría.

## Datos propuestos

`sale_discount_intents`: `id`, `tenant_id`, `order_id`, `order_item_id nullable`, `scope`, `kind`,
`value`, `reason_code`, `reason`, `authorized_by_user_id`, `created_at`.

Snapshots no nulos con default cero:

- `order_items.gross_line_amount`, `line_discount_amount`, `order_discount_allocated_amount`,
  `net_before_tax_amount`.
- `orders.gross_amount`, `discount_total_amount`, `tax_total_amount`, `total_amount`,
  `pricing_engine_version`.

No se persiste sólo porcentaje/valor: se conserva también el resultado calculado.

## API propuesta

El endpoint existente `POST /api/v1/orders` agrega intenciones opcionales, nunca totales calculados:

```json
{
  "items": [{
    "product_id": "uuid",
    "quantity": 2,
    "discount": {"kind": "percentage", "value": "10", "reason_code": "courtesy", "reason": "Cliente frecuente"}
  }],
  "order_discount": {"kind": "fixed", "value": "20.00", "reason_code": "promotion", "reason": "Cupón autorizado"}
}
```

La respuesta agrega breakdown gross/descuento/base/impuesto/total por línea y orden. Clientes que no
envían descuentos mantienen el contrato actual.

## RBAC, auditoría e idempotencia

- Permisos nuevos: `discounts.apply` y `discounts.override_limit`.
- Default propuesto: owner/manager aplican; cashier no hasta decisión explícita.
- Auditoría `orders.discount.applied` registra alcance, monto final, motivo y autorizador.
- La idempotencia de la orden cubre también la intención; misma key con cambio de descuento falla.
- El servidor ignora cualquier rol/límite declarado por cliente.

## Offline

V1 online-only. Offline mantiene venta sin descuento. No se almacena autorización en localStorage.
Una futura cola versionada deberá llevar intención y una capacidad firmada; el servidor recalcula.

## Errores

- `400`: valor cero/negativo, porcentaje >100, monto supera base o motivo inválido.
- `403`: permiso/límite insuficiente.
- `409`: política cambió antes de confirmar; carrito se recalcula y requiere confirmación.

## Aceptación y pruebas

- Golden Decimal para fijo, porcentaje, dos descuentos, prorrateo con centavo residual e impuesto.
- Refund parcial conserva el descuento unitario original.
- Replay concurrente crea una sola orden/auditoría.
- Cashier sin permiso recibe `403`; tenant B recibe `404`.
- Ticket/reporte muestran gross, descuento y neto reconciliables.
- E2E online; control deshabilitado y explicación al quedar offline.

