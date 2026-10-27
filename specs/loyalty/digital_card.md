# Tarjeta digital de lealtad

Estado: corte autorizado por el propietario el 2026-10-26; implementación local.

El propietario puede compartir una tarjeta de puntos de un cliente activo de la sucursal.
La tarjeta consulta el saldo real del ledger existente y la regla vigente; no inscribe al
visitante por teléfono y no acumula por escanear el menú. La consulta pública no aplica canjes.
Cuando el dueño configura una recompensa POS vigente, muestra su beneficio y progreso real;
el equipo confirma el canje al completar una venta según [su contrato](pos_rewards.md).

La continuación autorizada permite además [obtener una tarjeta desde el menú](public_enrollment.md),
con opt-in del dueño y una membresía nueva por dispositivo. Esa tarjeta usa cookie HttpOnly y
`/lealtad?menu=...`, código/QR de socio y vigencia de 180 días. El contrato de enlace privado
emitido por dueño descrito abajo conserva su fragmento, lectura sin cookies y vigencia de 30 días.

## Experiencia pública

La identidad comercial aparece sobre una tarjeta compacta con el saldo y su estado.
El menú publicado queda a un toque dentro de la primera pantalla móvil, cuando existe.
La regla por tramos completos de cada compra, vigencia y privacidad pueden desplegarse;
el nombre completo del negocio/sucursal sigue disponible aunque el encabezado se acote.
Reversas pendientes y saldos negativos se explican sin tener que abrir ese detalle.
La tarjeta no inicia la precarga de la PWA del comercio ni muestra avisos de Caja.
No se dibuja progreso hacia un premio, sellos o valor monetario que el negocio no haya definido.

## Contrato

- `POST /api/v1/loyalty/customers/{customer_id}/digital-card`, sin cuerpo, requiere propietario,
  acceso comercial y CSRF de sesión. Devuelve `share_path` y `expires_at`; no escribe datos,
  no contacta al cliente y no exige clave de idempotencia.
- `share_path` tiene la forma `/lealtad#CAPABILITY`: el fragmento no se envía al servidor al
  abrir la página. Compartir el enlace concede únicamente lectura de esa tarjeta durante 30 días.
- `POST /api/v1/public/loyalty/cards` con cuerpo `{ "token": "CAPABILITY" }` no requiere sesión.
  Es una lectura sin mutaciones; la capability viaja en el cuerpo para excluirla de URLs,
  logs de acceso y breadcrumbs de navegación. Devuelve `business_name`,
  `branch_name`, `balance`, `adjustments_pending`, `policy`, `expires_at`, `catalog_path` y `reward`.
  `reward` es `null` sin una recompensa habilitada por un propietario vigente; cuando existe,
  incluye título, puntos y descuento explícitos. La tarjeta no promete canje con ajustes pendientes.
  La política contiene la regla de puntos existente; `catalog_path` sólo enlaza un menú publicado
  de la misma sucursal y puede ser `null`. No devuelve nombre/contacto/ID del cliente, historial,
  ventas, costos, identificadores de usuario ni contactos de otros negocios.
- El cliente consulta con `credentials: omit` y `referrerPolicy: no-referrer`. La respuesta usa
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer` y `X-Robots-Tag: noindex, nofollow`.

## Límites y seguridad

La capability usa HS256 con la clave existente y audiencia exclusiva `kova-loyalty-card`,
identifica tenant/sucursal/cliente, incluye expiración obligatoria y revisión del cliente.
No es un token de sesión ni es aceptada por otras APIs. Alteración, audiencia incorrecta,
expiración y claims malformados producen el mismo 404 genérico antes de consultar datos.
La lectura verifica negocio activo, billing, cliente activo y propietario autorizante vigente.
Editar o desactivar el cliente invalida sus tarjetas previas, incluso si luego se reactiva.
Volver a generar un enlace no revoca otros enlaces aún vigentes; la caducidad y la revisión
del cliente son los mecanismos de revocación de este corte, sin nueva tabla o migración.

El contexto tenant se deriva sólo de la firma verificada, mediante `set_tenant_context` y
`bind_branch` con sesión runtime y RLS. Cada consulta mantiene tenant/sucursal explícitos.
La ruta pública tiene rate limit por IP. No usa conexión privilegiada, no procesa puntos
durante la lectura y no genera consentimiento de marketing.

`adjustments_pending` informa reversas conocidas pendientes. El saldo puede ser negativo;
no se ocultan reversas. Compras recientes pueden tardar en procesarse y no se presentan como
puntos confirmados hasta existir en el ledger. No hay equivalencia monetaria o premio inventados.

## Aceptación

- Una venta real procesada aparece en el saldo público; consultar no crea entradas ni modifica ventas.
- La tarjeta muestra la regla real o la pausa del programa, sin rellenar tasas ausentes.
- Una devolución pendiente se distingue del saldo materializado; saldo negativo se conserva.
- El enlace sólo accede a su cliente/sucursal. No permite cambiar IDs para consultar otro saldo.
- Token alterado, vencido, de catálogo o de sesión, cliente editado/inactivo, billing bloqueado
  y autorizante revocado impiden leer la tarjeta sin divulgar la causa o información privada.
- Propietario puede emitir; gerente/cajero no. La página pública no ofrece canje ni pago.
- La aceptación productiva, tarjetas Wallet, sellos, alta pública verificada y QR físico
  requieren entregas independientes. El canje conectado con POS tiene su propia aceptación local.
