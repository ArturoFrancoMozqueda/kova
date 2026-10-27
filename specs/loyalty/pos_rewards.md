# Recompensa de puntos aplicada en Caja

Estado: corte autorizado el 2026-10-26; implementación y validación locales completas.
Publicación y aceptación productiva pendientes. Amplía los puntos
internos y la tarjeta digital con un beneficio real, explícito y trazable a una venta.

## Alcance y contrato

El propietario define una recompensa vigente por sucursal: nombre, coste entero de puntos
y descuento fijo MXN. Cada cambio agrega una revisión inmutable, con versión y autorizante;
no existe equivalencia monetaria implícita. La acumulación conserva su política independiente.

- `GET /api/v1/loyalty/rewards` (propietario) devuelve la recompensa vigente o `null`.
- `PUT /api/v1/loyalty/rewards` (propietario, CSRF, Idempotency-Key) recibe
  `{expected_version,enabled,title,points_cost,discount_amount}` y devuelve
  `{id,version,enabled,title,points_cost,discount_amount}`.
- `GET /api/v1/loyalty/rewards/offer?customer_id=UUID` requiere `orders.create` y acceso
  comercial. Devuelve `{customer_id,balance,adjustments_pending,reward}` sin historial ni
  contactos. Un cajero puede consultar y aplicar sólo la recompensa explícita autorizada.
- `POST /api/v1/loyalty/rewards/checkout` requiere `orders.create`, CSRF, conexión e
  Idempotency-Key. Recibe `{order:OrderCreate,reward_id,reward_version,expected_balance,
  confirmed:true}`. `order.customer_id` es obligatorio; `order.discount_amount` debe ser cero:
  no se apilan descuentos. Devuelve la venta completada `OrderResponse`.
- La tarjeta pública agrega `reward` (misma proyección o `null`). El progreso se calcula
  con puntos reales; la tarjeta no aplica el beneficio, no cobra y no certifica entrega.
- Venta y recibo agregan `loyalty_reward` opcional: `{id,title,points_cost,discount_amount}`,
  un snapshot de la recompensa aplicada, independiente de cambios posteriores de política.

## Integridad financiera

El backend valida recompensa y autorizante vigentes, versión, cliente activo y sucursal.
Serializa el ledger por sucursal, bloquea ventas fuente de puntos y rechaza reversas pendientes,
saldo cambiado o insuficiente. El descuento exacto se aplica mediante el calculador Decimal y
los snapshots existentes. Si supera el subtotal se rechaza; no se recorta ni consume puntos
para un beneficio distinto. Pagos deben sumar exactamente el total posterior a descuento e
impuestos. No cambia cantidades ni precios de producto y la venta sólo acumula sobre su total
realmente registrado, posterior a descuento.

Venta, inventario, pagos, snapshot fiscal, débito de puntos, vínculo de recompensa y claves de
idempotencia se confirman en una sola transacción. Un error revierte todo. Reintentar la misma
clave y contenido devuelve la misma venta; otra clave con saldo obsoleto falla sin otra venta.
La comprobación de replay conserva el resultado aun cuando después cambie el saldo o política.

El canje manual previo permanece separado: sólo registro interno y no afirma descuento POS.
El nuevo débito usa ese ledger y queda enlazado a la venta mediante una fila inmutable de canje
POS. El retorno agrega `kind:reward_return` positivo sin editar el historial.

## Devoluciones, anulación y offline

Una devolución parcial usa los importes netos históricos prorrateados existentes y conserva el
coste completo de puntos de la recompensa. Cuando se devuelven todas las unidades de la venta,
o se anula, se restituyen los puntos consumidos una sola vez, dentro de la misma transacción.
La reversión de puntos ganados por la compra conserva su procesamiento existente; mientras esté
pendiente se bloquea otro canje. No se entrega dinero por el importe descontado.

Este checkout es exclusivamente online y no usa `/sync/offline-sales`, ni agrega campos a
`OrderCreate`, `client_uuid` o contratos antiguos de la cola. Una respuesta incierta se reconsulta
repitiendo la misma operación, sin encolar una venta paralela ni volver a cobrar. Las ventas
offline ordinarias conservan hashes, payloads y reglas existentes.

## Persistencia y seguridad

`loyalty_reward_revisions` y `loyalty_reward_redemptions` son append-only, FORCE RLS, con FK
compuestas tenant/sucursal y grants runtime sólo SELECT/INSERT. El ledger admite el retorno
positivo tipificado; no cambia los asientos anteriores. Exportación y purga incluyen el nuevo
grafo, hijos antes de padres. El downgrade sólo permite tablas nuevas vacías y ausencia de
retornos de recompensas; nunca descarta historial financiero.

## Aceptación

- Definir recompensa es explícito, versionado y exclusivo del propietario.
- Canje por cajero autorizado aplica descuento y débito exactamente una vez; ticket y tarjeta
  muestran los datos reales y no reinterpretan los puntos como dinero.
- Caja, impuestos, inventario y snapshots se reconcilian con el importe cobrado.
- Fallo de pagos, stock, saldo, cliente, versión o permisos no deja efectos parciales.
- Dos canjes concurrentes no sobregiran puntos; replay idéntico no duplica venta ni débito.
- Refund parcial/total y void preservan dinero, inventario, reversas ganadas y retorno de coste.
- RLS runtime, tenants/sucursales ajenos, billing y autorizante revocado impiden uso indebido.
- Migración conserva historial y rechaza downgrade con datos; offline anterior sigue funcionando.
