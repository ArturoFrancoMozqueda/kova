# Snapshots fiscales de venta

## Estado

La captura inmutable de importes operativos y los cierres para contador están implementados. La
clasificación y el cálculo fiscal siguen fuera de alcance; esta infraestructura no emite, timbra ni
cancela CFDI.

## Invariantes

- La orden es fuente histórica y congela la versión del motor.
- Configuración actual de producto/tasa nunca modifica una venta anterior.
- El cliente manda IDs/intención, no base, impuesto o total autoritativos.
- Snapshots se escriben en la misma transacción que orden, pagos e inventario.

## Esquema propuesto

Campos de `orders`:

- `gross_amount`, `discount_total_amount`, `tax_total_amount`, `total_amount` `NUMERIC(14,2)`.
- `tax_calculation_status` diferencia `not_calculated` de un impuesto cero calculado.
- `pricing_engine_version`, `tax_catalog_version`, `currency`, `occurred_at`.

Campos de `order_items`:

- `variant_id nullable`, `variant_name nullable`, `sku_snapshot nullable`.
- `gross_line_amount`, `line_discount_amount`, `order_discount_allocated_amount`.
- `net_before_tax_amount`, `tax_total_amount`, `line_total_amount`.
- `tax_object_code_snapshot`, `product_service_code_snapshot nullable`, `unit_code_snapshot nullable`.

Tabla `order_item_tax_snapshots`:

- `id`, `tenant_id`, `order_id`, `order_item_id`.
- `direction` (`transfer|withholding`), `tax_code`, `factor_type` (`rate|quota|exempt`).
- `base_amount NUMERIC(18,6)`, `rate_or_quota NUMERIC(18,6) nullable`,
  `tax_amount NUMERIC(18,6) nullable`, `catalog_version`.

Constraints compuestos aseguran que item/orden pertenecen al mismo tenant. Las filas son inmutables.

## Precisión

- Cálculo interno conserva seis decimales donde el contrato fiscal lo requiere.
- Cobro y reportes monetarios se cuantizan a dos decimales con `ROUND_HALF_UP`.
- Regla de agregación/validación final debe aprobarse con PAC/contador antes de CFDI.
- No se cambia precisión silenciosamente: `pricing_engine_version` selecciona algoritmo.

## Lecturas

Recibo y reportes reciben breakdown desde snapshots. Los cierres `accountant-package-v2` dejan vacío
el importe de impuestos cuando `tax_calculation_status=not_calculated` y lo etiquetan explícitamente.
El ledger de factura individual conserva confirmaciones y reaperturas externas sin afirmar que Kova
emitió el documento.

## Offline

Una venta offline futura guarda IDs/versiones e intención, no totales fiscales finales. Al sincronizar,
el servidor usa la regla efectiva en `occurred_at` o envía la venta a recuperación si la versión ya no
puede resolverse. Nunca descarta ni duplica la venta.

## Aceptación

- Cambiar producto, variante o tasa no altera receipt/reporte histórico.
- Una devolución anterior al límite del periodo reduce ese cierre; una posterior crea un ajuste
  negativo en el siguiente sin reescribir el original.
- Tenant B no puede consultar snapshots de A por ruta ni SQL con `kova_app`.
- Una excepción a mitad de persistencia hace rollback de orden, snapshots, pago e inventario.
- El paquete se identifica como `NO_EMITIDO` y explica que no es CFDI ni constancia de timbrado.
