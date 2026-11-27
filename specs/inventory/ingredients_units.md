# Insumos, unidades y unidad de compra

Estado: publicado el 26-nov-2026 (#392, release 45922044316; E2 del
[backlog competitivo](../../docs/backlog-competitivo.md)). Decisión: [ADR-040](../../docs/adr/ADR-040-insumos-unidades-y-recetas-en-todos-los-planes.md).

## Problema, usuarios y valor

Una cafetería compra leche por litro y la gasta por mililitro; una panadería compra harina por
bulto y la usa por gramo. Hoy Kova solo cuenta piezas vendibles, así que esos insumos quedan fuera
del inventario, del costo y de la reposición. Dueños y gerentes necesitan registrar insumos que no
se venden, contarlos en una unidad útil y comprarlos en la unidad del proveedor sin hacer cuentas.
Es la base para recetas (E3) y producción (E4).

## Requisitos

- Un producto puede marcarse como **insumo** (`is_sellable = false`). Se compra, se cuenta, se
  ajusta y se valúa, pero no aparece en Caja, catálogo público, cotizaciones ni pedidos.
- **Unidad de inventario** (`stock_unit`): `pza`, `g` o `ml`. Las existencias siguen siendo enteros
  de esa unidad (750 ml, 2 250 g); no hay decimales binarios ni migración de columnas existentes.
  No se puede cambiar la unidad si el producto ya tiene movimientos en cualquier sucursal (400).
- **Unidad de compra** opcional (`purchase_unit_label` + `purchase_unit_quantity`): «Litro» = 1000
  ml, «Caja» = 12 pza. Nombre y contenido van juntos (400 si falta uno; CHECK en base de datos).
- Con unidad de compra, `cost_price` es el costo de **una unidad de compra** ($25 por Litro). Sin
  ella, el de una unidad de inventario, como antes. El costo por unidad base se deriva sin
  redondear (`app/catalog/units.py`) y el dinero se redondea una vez al multiplicar.
- Aplica a todos los planes. Compras sigue en Gestión; en Esencial el costo se captura en Catálogo.

## Reglas por flujo

| Flujo | Comportamiento |
| --- | --- |
| Venta en línea de un insumo | 422 `PRODUCT_NOT_SELLABLE`, sin escrituras |
| Venta offline ya cobrada de un producto que después se volvió insumo | Se conserva y se registra `product_not_sellable` en la revisión de precios (`orders.pricing_review`) |
| Catálogo público, solicitudes del menú, cotizaciones, pedidos nuevos | Excluyen o rechazan insumos; las líneas ya guardadas de un pedido se conservan |
| Orden de compra | Cantidad y costo en unidad de compra; la partida congela `units_per_purchase` y la etiqueta |
| Recepción | Entra `cantidad × units_per_purchase` en unidad base; los lotes se asignan en unidad base. Con «actualizar costo», el costo se convierte si la unidad de compra del catálogo cambió desde la orden |
| Reposición | Faltante y mínimo en unidad base; `suggested_purchase_quantity` redondea hacia arriba a unidades de compra; lo pendiente de recibir se convierte con el factor congelado |
| Costo por partida vendida | `order_items.unit_cost` = costo por unidad base redondeado ($120 por Caja de 12 → $10) |
| Valuación de inventario y merma | Unidades base × costo por unidad base |
| Importación CSV/XLSX | Columnas opcionales `tipo` (`producto`/`insumo`) y `unidad` (`pza`/`g`/`ml`); solo valores distintos al predeterminado entran a la fila normalizada para conservar hashes de archivos anteriores |
| Exportación de cuenta | Incluye las columnas nuevas de productos y partidas de compra |

## Escenarios

```gherkin
Scenario: Comprar leche por litro y contarla en mililitros
  Given un insumo "Leche entera" contado en ml que se compra por "Litro" de 1000 ml a $25
  When se ordenan 3 Litros y se reciben 2
  Then el inventario sube 2000 ml
  And la valuación usa $0.025 por ml

Scenario: Un insumo no se cobra en Caja
  Given "Leche entera" es insumo
  When un cajero intenta cobrarla en línea
  Then recibe 422 PRODUCT_NOT_SELLABLE y no se crea venta

Scenario: Cambiar la unidad de compra no reescribe una compra en tránsito
  Given una compra pendiente de 1 Litro de 1000 ml
  When el catálogo cambia a "Galón" de 4000 ml y se recibe la partida
  Then entran 1000 ml y el costo se expresa por Galón
```

## Datos y API

Migración aditiva `0110_ingredients_units`: `products.is_sellable` (default true),
`stock_unit` (default `pza`), `purchase_unit_label`, `purchase_unit_quantity` y
`purchase_order_items.units_per_purchase` (default 1) / `purchase_unit_label`, con CHECKs y
`downgrade()`. Los defaults reproducen el comportamiento anterior para filas existentes y para
escrituras de una app anterior tras un rollback. Limitación conocida: una app anterior que reciba
una partida con factor distinto de 1 sumaría unidades de compra sin convertir. Si se revierte la
app, no se reciben compras con unidad de compra hasta volver a publicar esta versión.

`ProductCreate/Update/Response`, `InventoryStockItem`, `PurchaseItemResponse` y la sugerencia de
reposición exponen los campos nuevos; `specs/openapi.json` regenerado.

## Pruebas

| Contrato | Evidencia |
| --- | --- |
| Unidades, caja, offline, compra/recepción, costo por pieza, reposición, menú/pedidos, importación | `backend/app/tests/test_ingredients_units.py` (API/PostgreSQL) |
| Defaults, CHECKs y downgrade | `backend/migration_tests/test_0110_ingredients_units.py` |
| Formulario de insumo y unidad de compra incompleta | `frontend/src/catalog/CatalogView.test.tsx` |
| Caja no ofrece insumos y conserva el caché completo | `frontend/src/register/RegisterView.test.tsx` |
| Reposición en unidades de compra | `frontend/src/replenishment/ReplenishmentView.test.tsx` |
| Formato de cantidades | `frontend/src/catalog/units.test.ts` |

## Fuera de alcance

Conversión entre unidades distintas (g ↔ ml), decimales de inventario, varias unidades de compra
por producto, recetas (E3) y producción (E4).
