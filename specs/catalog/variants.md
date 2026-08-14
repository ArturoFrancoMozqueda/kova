# Variantes de producto

## Estado y gate

Especificado, no implementado. Continúa diferido hasta que pilotos del segmento elegido demuestren que
talla, color o presentación con inventario independiente es un problema prioritario y el trabajo entre
catálogo, POS, offline, importación, compras y reportes entre explícitamente al sprint.

## Definición y límites

Una variante es una identidad vendible con SKU, precio y existencias propias. Un modificador sigue
siendo una elección de preparación/complemento y no crea SKU ni inventario independiente. V1 admite
hasta dos ejes por producto y una combinación única; bundles, matrices de más ejes y generación masiva
avanzada quedan fuera.

## Modelo propuesto

- `variant_axes`: `id`, `tenant_id`, `product_id`, `name`, `position`.
- `variant_axis_values`: `id`, `tenant_id`, `axis_id`, `value`, `position`.
- `product_variants`: `id`, `tenant_id`, `product_id`, `sku nullable`, `barcode nullable`,
  `display_name`, `price_override nullable`, `cost_override nullable`, `is_active`, timestamps.
- `product_variant_values`: `tenant_id`, `product_variant_id`, `axis_value_id`.

Restricciones: SKU y barcode únicos por tenant cuando existan; combinación de valores única por
producto; valores pertenecen a ejes del mismo producto/tenant; máximo una variante predeterminada.
Precio/costo usan `Decimal`. El inventario identifica `(product_id, product_variant_id nullable)` para
mantener compatibilidad con productos simples.

## Contratos

- `POST /api/v1/products` conserva productos simples y acepta opcionalmente `variant_axes` y
  combinaciones; el servidor valida la matriz completa de forma atómica.
- `GET /api/v1/products` devuelve variantes activas y un `catalog_schema_version`.
- `PATCH /api/v1/products/{id}/variants/{variant_id}` actualiza una variante; eliminar se modela como
  desactivar si ya tiene movimientos u órdenes.
- Venta, ajuste, conteo, compra y recepción aceptan `product_variant_id` opcional. Cuando el producto
  tiene variantes activas, el ID es obligatorio y debe pertenecer al producto.
- Ticket y orden congelan nombre de producto, nombre/valores de variante, SKU, precio y costo efectivos.
- CSV/XLSX requiere columnas explícitas de ejes/valores y preview; no interpreta texto libre como matriz.

## POS y offline

- Escanear SKU/barcode resuelve directamente una sola variante; una colisión impide guardar catálogo.
- Seleccionar producto con múltiples variantes abre selector compacto, navegable por teclado, que muestra
  disponibilidad real; no agrega silenciosamente la primera opción.
- La caché offline se versiona y guarda variantes e inventario por identidad. Un cliente con esquema
  anterior debe refrescar antes de vender un producto con variantes.
- Ventas offline guardan snapshots e ID de variante y conservan `client_uuid`; el servidor deduplica y
  valida pertenencia, sin sustituir por otra variante si cambió el catálogo.

## Seguridad, auditoría y concurrencia

- Reutiliza permisos de catálogo/inventario; una capacidad separada `catalog.variants.write` puede
  habilitar rollout gradual. Owner/manager propuesto, sujeto a aprobación.
- RLS por tenant en todas las tablas y validación service-layer en relaciones.
- Writes requieren idempotencia y eventos `product_variant.created/updated/deactivated` con actor y diff.
- Ajustes y recepción bloquean la fila de inventario de la variante; no agregan stock al padre.

## Aceptación

- Producto simple conserva exactamente el flujo y contrato actuales.
- Dos variantes pueden tener precio/stock distintos y aparecen correctamente en POS, ticket, kardex,
  refund, reportes e import preview.
- SKU/barcode duplicado o combinación repetida falla atómicamente.
- Venta offline/replay afecta una vez la variante seleccionada.
- Tenant B obtiene `404` al usar IDs de variante de tenant A.
- Tests cubren migración/backfill, RLS, Decimal, scan, selector teclado/móvil, importación y downgrade de
  caché incompatible.
