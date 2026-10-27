# Publicación y aceptación productiva del seguimiento de pedidos

Fecha: 2026-10-26, Ciudad de México. Publicado y validado en producción.
Autorización: el propietario pidió publicar los cambios y repetir el flujo completo,
especialmente la navegación automática al seguimiento después de enviar el pedido.

## Versión y controles de publicación

- [PR #283](https://github.com/ArturoFrancoMozqueda/kova/pull/283), fusionado.
- Release: `4ae7c8f7182d4d1c624f16c4ec227f744c3d6ae4`.
- [CI del PR](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40449215832), aprobado.
  El primer intento tuvo una caída del proceso Chromium con SIGSEGV al crear un contexto,
  sin ejecutar la pantalla afectada. Se repitió únicamente el trabajo fallido, conservando
  código, expectativas y controles. `CI required` terminó en verde.
- [Publicación coordinada](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40453273698),
  aprobada. Guardó `release-rollback-4ae7c8f7182d4d1c624f16c4ec227f744c3d6ae4`
  antes de publicar; candidato, backend, promoción y aceptación completados.
- El verificador existente confirmó HTML público, `version.json` con `4ae7c8f7182d`,
  API con SHA completo, base de datos y proxy del frontend, antes y después del recorrido.
  El release anterior verificado era `6cb346e75bc9c20eee2d568ef78c09724bda981a`.
- No se cambian DNS, credenciales, gates, permisos ni configuración de proveedores.
  Los cambios de esta funcionalidad no agregan migraciones.

## Recorrido real por navegador

Se utilizó la sesión existente del propietario de Cafetería Sweet Home en la pestaña de
Codex y una sesión separada para el cliente, sobre el menú que indicó el propietario:
`https://kovasuite.com/catalogo/cafeteria-sweet-home-2`. Sin interceptar APIs ni sembrar datos.

Pedido de aceptación: **PED-564580CF**, una Concha vainilla, **$24.00 MXN**.
Referencia: `KOVA-UX-20261026-1793077913756`. Se vinculó al cliente de validación ya
existente; no se dio de alta un cliente adicional. Las notas identifican la comprobación
autorizada y solicitan no preparar mercancía física ni contactar.

| Paso | Resultado observado |
|---|---|
| Menú y carrito | Selección de una unidad y subtotal de $24.00; formulario usable en escritorio. |
| Envío | El botón de envío abrió **automáticamente `/seguimiento#…`**. No se pulsó un enlace intermedio de seguimiento. |
| Recepción | La página mostró **Solicitud recibida**, negocio, sucursal y selección. |
| Revisión por negocio | La solicitud conservó cantidad, precio y notas; la selección del cliente fue explícita. Crear el pedido no cobró ni reservó. |
| Confirmación | Confirmar y reservar mantuvo 13 unidades físicas: **12 disponibles y 1 reservada**. |
| Actualización automática | El cliente vio **Pedido confirmado → En preparación → Tu pedido está listo → Pedido entregado**, sin pulsar Actualizar estado ni recargar entre esos estados. Se respetó el intervalo de consulta de 30 segundos. |
| Listo pendiente de cobro | Se explicó la siguiente acción y Marcar entregado permaneció deshabilitado hasta registrar el cobro. |
| Cobro vinculado | Se abrió Caja para el pedido exacto, sin recorrido de primera venta. Registro manual por transferencia, $24.00, con referencia que indica expresamente comprobación sin transferencia bancaria. |
| Recibo | Venta vinculada y recibo **ED6316B1**, una unidad por $24.00; inventario bajó de 13 a **12**, sin reserva pendiente. |
| Entrega | El seguimiento avanzó solo a **Pedido entregado** y conservó la misma dirección. |
| Persistencia y privacidad | Una tercera sesión anónima abrió el mismo enlace y mostró Entregado. No mostró nombre/contacto del cliente, referencia de validación ni notas privadas. |

Las capturas de recibido, listo y entregado se conservaron como artefactos de esta
conversación. No se registra la capability del enlace en el repositorio ni en este informe.
Las consolas de las sesiones de cliente y negocio tuvieron **cero errores** durante
la aceptación. El panel dejó de destacar horas con $0 y mostró el vacío correcto.
La sesión que ya tenía service worker ofreció la nueva versión: se aplicó desde Panel,
conservó la autenticación y dejó de mostrar el aviso, sin interrumpir el cobro.

## Conciliación de la operación de comprobación

Tras verificar entrega, se registró una **devolución total de $24.00**, motivo Otro y
medio Transferencia, vinculada a esa misma venta de validación. No se enviaron fondos
por banco/Stripe ni se produjo una devolución externa; ambos son registros manuales.

El recibo muestra **Devuelta total**, **-$24.00** y **neto $0.00**. Inventario volvió a
**13 unidades, sin reservas**. El pedido conserva su entrega y refleja **Devuelto** en
su estado privado de cobro. La venta, devolución, reserva, movimientos y solicitud se
conservan en el historial: no se borraron ni anularon registros ni se ajustó stock por SQL.
Los conteos brutos de ventas y devoluciones incluyen esta comprobación; no se ocultan
para fabricar reportes. La referencia permite identificarla y conciliarla.

## Alcance de la aceptación

Queda aceptado en producción el recorrido menú → seguimiento → revisión → reserva →
preparación/listo → cobro manual vinculado → entrega, con actualización automática y
reapertura anónima, más devolución/restauración de la comprobación.

Esto complementa la [validación local por roles](KOVA-ROLE-UX-REVIEW-2026-10-26.md),
sin sustituir aceptación de Stripe live, correo real, WhatsApp, CFDI, impresoras o cajones
físicos. No se activaron proveedores ni se contactó a terceros durante esta aceptación.
