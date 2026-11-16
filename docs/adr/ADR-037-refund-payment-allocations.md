# ADR-037 — Distribución de devoluciones por medio original

Estado: aceptada para implementación; publicación no acreditada.
Fecha: 2026-11-16.

## Contexto

Un reembolso admite actualmente un único medio. Una unidad de $50 cobrada con
$30 efectivo y $20 transferencia no puede devolverse sin superar uno de sus límites.
Dividir artificialmente la cantidad o crear padres con importes y artículos
inconsistentes rompería los reportes, el inventario y el historial financiero.

## Decisión

Conservar un `Refund` con su conjunto de `RefundItem` y agregar allocations
inmutables en `refund_payments` por medio. Una transacción verifica que su suma
coincide con el total calculado y cada tramo cabe en el saldo original del medio.
El movimiento de caja usa exclusivamente el tramo de efectivo. Los lectores
cuentan allocations una vez y recurren al campo antiguo solo si no existen.

La migración es expansiva, conserva tenant/sucursal mediante FK compuesta,
RLS forzado y SELECT/INSERT para `kova_app`. Se mantiene el campo anterior para
devoluciones de medio único y el hash de solicitudes anteriores. Un trigger
diferido protege suma y límites por medio ante escrituras de una versión anterior.
Un rollback de app mantiene la base; el downgrade de esquema se bloquea cuando
eliminaría el único historial de una distribución mixta. Una app anterior puede
leer el total y los artículos, pero no desglosa medios de una devolución mixta;
la versión actual es necesaria para consultar ese desglose completo.
La purga de una app anterior conserva su guard de grafo desconocido y se bloquea
ante la tabla nueva; no se debilita ese guard ni se certifica purga completa con
fuentes anteriores. Exportación/purga del grafo nuevo requieren esta versión.

La intención del navegador se guarda antes de enviar, con payload y clave
idempotente, en IndexedDB por usuario/tenant/sucursal/venta. Cerrar un modal o
navegar no elimina una operación de resultado incierto. Su recuperación reutiliza
la identidad hasta una respuesta definitiva, sin almacenar credenciales.
Los gates o una validación posterior no resuelven un commit anterior desconocido.
La conciliación explícita usa la misma reserva idempotente y orden de locks de la
devolución: devuelve el efecto confirmado o guarda una cancelación permanente de
esa clave. Solo entonces se puede iniciar una intención nueva. Esta cancelación
impide que una solicitud original tardía efectúe una devolución tras desbloquear.

## Consecuencias

Recibos, mezcla de pagos y exportación de cuenta incluyen las allocations. La
cantidad devuelta y la reposición siguen ocurriendo una vez. La app registra el
dinero devuelto; no ejecuta pagos externos. Las pruebas cubren una unidad con
pago mixto, reintentos, caja, aislamiento y el ciclo de migración.
