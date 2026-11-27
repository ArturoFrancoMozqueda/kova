# ADR-043 — Producción por lote sobre las recetas existentes

Estado: aceptada; implementación local (E4), publicación no acreditada.
Fecha: 2026-11-26.

## Contexto

Las recetas al vender ([ADR-041](ADR-041-recetas-versionadas-al-vender.md)) cubren bebidas que se
preparan al cobrar. El pan se produce antes: los insumos salen en el horno y las piezas se venden
después con existencias propias. Hacer las dos cosas sin una regla clara descontaría la harina dos
veces.

## Decisión

1. **Reutilizar `recipes` con `mode = 'batch'` y `batch_yield`**, en lugar de una segunda tabla de
   recetas. Las versiones y las líneas siguen inmutables.
2. **`production_batches` por sucursal** registra cada lote. Sus movimientos de consumo y de entrada
   viven en `inventory_movements` con `production_batch_id`: el inventario sigue siendo la única
   fuente de existencias.
3. **Separación estricta:** producción exige que el producto controle existencias; la receta al
   vender exige lo contrario. Una venta nunca toca insumos de un producto producido.
4. **Costo del lote por piezas reales**, sin costo si falta algún insumo. **Política:** el costo del
   catálogo sigue al último lote por omisión, desactivable por lote; el costo de cada venta queda
   congelado en su partida ([ADR-010](ADR-010-product-cost-snapshots.md)).
5. **Merma de producción como faltante del lote**, no como movimiento: esas piezas nunca existieron.
   Se reporta aparte de la merma tipificada, valuada con el costo por pieza esperada del lote.

## Consecuencias

- Corregir un lote mal registrado requiere hoy un ajuste de inventario; una anulación de lote queda
  como trabajo futuro.
- Un rollback de app no baja la base; una versión anterior no produce lotes.
