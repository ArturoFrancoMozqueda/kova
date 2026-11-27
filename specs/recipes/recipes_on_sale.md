# Recetas al vender

Estado: publicado el 26-nov-2026 (#395, release 45937609716; E3 del
[backlog competitivo](../../docs/backlog-competitivo.md)). Decisión: [ADR-041](../../docs/adr/ADR-041-recetas-versionadas-al-vender.md).

## Problema, usuarios y valor

Una cafetería vende un latte, no leche ni café. Sin receta, Kova no sabe cuánta leche salió ni
cuánto costó la bebida: el margen queda vacío o inventado y la reposición de insumos depende de
contar a mano. Dueños y gerentes necesitan definir una vez qué lleva cada producto preparado, que
cada venta descuente esos insumos y que el costo real de la partida quede registrado.

## Requisitos

- **Receta** de un producto a la venta que no lleva existencias propias: lista de insumos con
  cantidad entera en la unidad de cada insumo (ml, g, pza). Hasta 50 líneas, sin repetir insumo.
- **Versiones:** guardar crea una versión nueva vigente desde ese momento; las anteriores no se
  editan. Una lista vacía deja de descontar insumos desde ese momento. Una venta usa la versión
  vigente al cobrarse (`occurred_at`), también si se cobró offline y se sincroniza después.
- **Ajustes por opción de modificador:** cantidades con signo por unidad vendida. Sustitución:
  «Almendra» = −240 ml de leche entera, +240 ml de leche de almendra. Extra: «Shot» = +9 g de café.
  Por unidad, ningún insumo baja de cero.
- **Venta:** por cada partida se crean movimientos `consumption` de los insumos con control de
  inventario, ligados a la partida. **Nunca se bloquea** la venta por existencias de insumos; un
  saldo negativo es una diferencia a revisar en conteo.
- **Costo de la partida** (`order_items.unit_cost`): suma del costo por unidad base de cada insumo
  ([ADR-040](../../docs/adr/ADR-040-insumos-unidades-y-recetas-en-todos-los-planes.md)) para la
  receta con sus ajustes. Si algún insumo no tiene costo, la partida queda **sin costo** (nunca $0).
  Un producto sin receta con opciones que agregan insumos suma ese costo al del catálogo.
- **Devolución:** el dinero regresa; los insumos no (la bebida ya se preparó). **Anulación:** el
  registro fue un error, así que el consumo se revierte una sola vez.
- **Reglas que evitan doble conteo:** un producto con receta no puede controlar existencias propias
  (400 en ambos sentidos); un insumo no lleva receta; un producto no es insumo de sí mismo; los
  insumos con control de lotes todavía no se usan en recetas.
- **Permisos:** leer o guardar recetas y ajustes requiere `catalog.update` porque muestran costos.
  Todos los planes (decisión del dueño, ADR-040).

## Escenarios

```gherkin
Scenario: Vender un latte con leche de almendra
  Given el latte lleva 240 ml de leche entera y 18 g de café
  And la opción "Almendra" cambia 240 ml de leche entera por 240 ml de leche de almendra
  When se venden 2 lattes normales y 1 con almendra
  Then salen 480 ml de leche entera, 240 ml de almendra y 54 g de café
  And el costo de cada partida es $13.20 y $18.00

Scenario: Venta offline con una receta que cambió después
  Given la versión 1 estaba vigente cuando se cobró sin conexión
  When se guarda la versión 2 y después se sincroniza la venta
  Then la venta consume y cuesta según la versión 1
```

## Datos y API

Migración `0111_recipes_on_sale`: `recipes` (versión, `mode` `on_sale|batch`, `effective_from`),
`recipe_lines` y `modifier_option_consumptions`, con FK compuestas por tenant, RLS forzado y
privilegios mínimos (versiones sólo SELECT/INSERT; ajustes SELECT/INSERT/DELETE). Agrega el tipo de
movimiento `consumption`. El downgrade se rechaza cuando ya hay recetas o consumo registrado.

- `GET|PUT /api/v1/catalog/products/{id}/recipe` (Idempotency-Key obligatorio en PUT).
- `GET|PUT /api/v1/catalog/modifier-options/{id}/consumption`.
- La cobertura de inventario (`days_until_out`) cuenta ventas y consumo por receta.
- Exportación de cuenta incluye las tres tablas; la purga las elimina antes que productos.

## Pruebas

| Contrato | Evidencia |
| --- | --- |
| Latte con almendra, sin bloqueo, devolución, anulación idempotente, offline por versión, costo desconocido, reglas, aislamiento | `backend/app/tests/test_recipes_on_sale.py` |
| RLS forzado, privilegios, FK entre tenants, downgrade protegido | `backend/migration_tests/test_0111_recipes_on_sale.py` |
| Presupuesto de consultas del cobro | `test_order_pricing_controls.py` |
| Diálogo: enteros positivos, signos en opciones, reintento con la misma clave, costo incompleto | `frontend/src/recipes/IngredientLinesDialog.test.tsx` |

## Fuera de alcance

Producción por lote (E4, `mode = batch`), tamaños como variantes, insumos con lotes en recetas,
merma de preparación y sugerencia de compra de insumos (E5).
