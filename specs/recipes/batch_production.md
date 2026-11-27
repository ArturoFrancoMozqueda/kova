# Producción por lote

Estado: implementado localmente (E4 del [backlog competitivo](../../docs/backlog-competitivo.md));
publicación no acreditada. Decisión: [ADR-043](../../docs/adr/ADR-043-produccion-por-lote.md).

## Problema, usuarios y valor

Una panadería hornea charolas, no conchas sueltas: los insumos salen al producir y las piezas se
venden después. Sin producción, el inventario de pan y de harina no cuadra, la merma del horno no se
registra y el costo por pieza es una suposición. Dueños y encargados necesitan registrar un lote con
lo que realmente salió, sin descontar los insumos otra vez al vender.

## Requisitos

- **Receta de producción** (`mode = 'batch'`) de un producto que **sí** controla existencias:
  insumos de un lote completo y `batch_yield`, las piezas que rinde. Versionada como las recetas al
  vender ([ADR-041](../../docs/adr/ADR-041-recetas-versionadas-al-vender.md)).
- **Registrar un lote:** número de lotes y piezas que salieron. Se descuenta `cantidad × lotes` de
  cada insumo (movimientos `consumption` ligados al lote) y entran las piezas reales (movimiento
  `production`). Nunca se bloquea por existencias de insumos.
- **Merma de producción:** si salen menos piezas que las esperadas se exige un motivo tipificado; si
  salen las esperadas o más, no se acepta motivo.
- **Costo:** costo de insumos del lote ÷ piezas que salieron. Sin costo si falta el de algún insumo
  o si no salió ninguna pieza. Por omisión el costo del catálogo del producto se actualiza al del
  último lote (casilla desactivable); con unidad de compra se expresa por esa unidad.
- **Sin doble descuento:** un producto con receta de producción controla existencias y no puede tener
  receta al vender; venderlo mueve sólo las piezas, con el costo del catálogo en la partida.
- **Idempotencia:** `Idempotency-Key` obligatorio; un reintento registra un solo lote.
- **Permisos:** registrar y listar lotes requiere `inventory.adjust`; la receta, `catalog.update`.
  Todos los planes ([ADR-040](../../docs/adr/ADR-040-insumos-unidades-y-recetas-en-todos-los-planes.md)).
- Productos e insumos con control de lotes todavía no se producen.

## Escenario

```gherkin
Scenario: Charola de conchas con merma
  Given la receta de producción de "Concha" rinde 24 piezas con 1 kg de harina y 250 g de azúcar
  When se registran 2 lotes y salen 45 piezas por "daño"
  Then salen 2 kg de harina y 500 g de azúcar y entran 45 conchas
  And el costo por pieza es $1.60 y el del catálogo se actualiza
  And al vender 2 conchas sólo bajan las conchas
  And Merma muestra 3 piezas que no salieron, valuadas en $4.50
```

## Datos y API

Migración `0112_batch_production`: `recipes.batch_yield` con CHECK por modo; `production_batches`
por sucursal con RLS forzado y sólo SELECT/INSERT para la app; `inventory_movements.production_batch_id`
con FK compuesta; tipo de movimiento `production`. El downgrade se rechaza con historial.

- `GET|PUT /api/v1/catalog/products/{id}/batch-recipe`.
- `GET|POST /api/v1/inventory/production`.
- Análisis → Merma agrega «Piezas que no salieron en producción», aparte de la merma tipificada.
- Exportación de cuenta incluye lotes, `batch_yield` y `production_batch_id`.

## Pruebas

| Contrato | Evidencia |
| --- | --- |
| Charola con merma, venta sin doble descuento, costo, reintento, motivo, costo desconocido, reglas, aislamiento | `backend/app/tests/test_batch_production.py` |
| CHECK por modo, privilegios, RLS y downgrade protegido | `backend/migration_tests/test_0112_batch_production.py` |
| Diálogo «Producir»: consumo previo, motivo obligatorio, clave idempotente | `frontend/src/recipes/ProductionDialog.test.tsx` |
| Bloque de merma de producción | `frontend/src/reports/components/WasteAnalysis.test.tsx` |

## Fuera de alcance

Corregir o anular un lote registrado, producción con lotes y caducidades, productos intermedios con
varias etapas y planeación de producción.
