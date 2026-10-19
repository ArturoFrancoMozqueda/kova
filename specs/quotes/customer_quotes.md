# Cotizaciones y conversión a pedido

Cotizaciones autenticadas para owner/manager con acceso comercial. Se cotizan productos simples a
precios actuales del servidor, con cliente existente, cantidades y vigencia con zona horaria. No
hay precio libre, impuestos/descuentos/anticipos ni modificadores en esta primera versión.

Cada partida congela producto, nombre, precio y cantidad. Total MXN Decimal, sin costos internos.
No se crean reservas, ventas ni ingresos al cotizar. Las partidas no se editan después de guardar;
una revisión de condiciones se representa con una nueva cotización y cancelación de la anterior.

## API y estados

- `GET /api/v1/quotes`: `{items, total}`, paginación `limit` hasta 100 y `offset`.
- `POST /api/v1/quotes`: cliente, `expires_at` e items producto/cantidad; crea `draft`.
- `POST /{id}/mark-sent`: versión y `confirmed_shared: true`; el usuario registra que ya compartió
  la cotización. Estado `sent` no significa entrega verificada por Kova ni envío por proveedor.
- `POST /{id}/accept`: versión y `confirmed_customer_acceptance: true`; el negocio registra la
  aceptación del cliente y crea un pedido nuevo sin reservas ni ingreso.
- `POST /{id}/cancel`: versión; sólo borradores o cotizaciones compartidas vigentes.

Todos los cambios exigen `Idempotency-Key`. La misma solicitud repite el resultado; cambiar body
con la misma key se rechaza. Versiones obsoletas producen `409`. La vigencia se valida al ejecutar,
no sólo al cargar la pantalla. El estado efectivo `expired` se deriva al leer y no muta mediante GET.
Una cotización aceptada/cancelada conserva su estado después de la fecha de vigencia.

## Conversión atómica

Conversión requiere Pedidos habilitado, permiso `customer_orders.create` y los permisos normales
de cotizaciones. Bloquea la cotización y productos en orden estable; revalida estado activo, nombre,
precio y ausencia de modificadores. Si cambió el catálogo, conserva el snapshot y rechaza convertir
con `409`: revisar y generar una cotización nueva. Nunca pasa precios libres al dominio de pedidos.

El servicio de pedidos existente crea `new`, modalidad recoger, origen otro y los datos de contacto
cotizados. El vínculo tenant/sucursal al pedido y el estado `accepted` se confirman junto con ambas
respuestas idempotentes. Fallar antes del commit revierte todo; dos aceptaciones no generan pedidos
duplicados. El contacto identifica al cliente existente desde la cotización; no se infiere una
identidad por coincidencia de teléfono ni se copian notas privadas del CRM.

## Seguridad y QA

Tablas `customer_quotes` y `customer_quote_items` con FORCE RLS, scope de sucursal y FKs compuestas.
El rol runtime no puede editar snapshots ni identidad; sólo el estado y vínculo de una cotización.
API no pública; marcar compartida/aceptada exige declaración expresa del usuario. Auditoría incluye
IDs, versión y estado; nunca teléfono ni prosa privada.

Probar snapshots, precio modificado, expiración, declaración explícita, flag apagado, permisos,
tenant/sucursal, replay, atomicidad bajo fallo y aceptación concurrente con PostgreSQL real.
