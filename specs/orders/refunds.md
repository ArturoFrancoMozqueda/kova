# Devoluciones y recuperación de resultados inciertos

## Problema, usuarios y valor

Dueños y gerentes necesitan devolver unidades cobradas con varios medios sin
duplicar devoluciones cuando se pierde una respuesta. El saldo por medio, las
existencias y el efectivo esperado deben seguir conciliando.

## Requisitos y permisos

- Requiere sesión, acceso comercial y `orders.refund`; conserva tenant y sucursal
  resueltos por el servidor. No devuelve ventas anuladas ni excede unidades pendientes.
- Una devolución contiene un único conjunto de unidades y un total calculado por
  el servidor, con el redondeo acumulativo existente de descuentos e impuestos.
- Acepta el medio único anterior (`refund_payment_method`) o una distribución
  (`refund_payments`), nunca ambos. Cada medio aparece una vez, con Decimal positivo.
- La suma de la distribución coincide exactamente con el total; ningún tramo
  supera lo cobrado por ese medio menos devoluciones previas, incluidas las antiguas.
- Una unidad de $50 pagada $30 efectivo + $20 transferencia puede devolverse con
  esa distribución. Solo $30 salen del efectivo esperado; se requiere turno abierto.
- Recibo, detalle, reportes por medio, exportación de cuenta y auditoría conservan
  la distribución. Su registro no ejecuta transferencias ni reembolsos bancarios externos.
- Artículos, inventario, distribución, movimiento de caja y clave idempotente se
  confirman en una transacción. Los productos con lotes conservan sus reglas de reposición.

## Devolver dinero no es reponer el producto

Devolver el dinero y regresar la unidad a las existencias son decisiones distintas.
Cada línea acepta `restock` opcional:

- Omitido (clientes e intenciones anteriores) o `true`: se repone lo que la venta
  descontó, como antes. Omitirlo conserva el hash idempotente previo.
- `false`: se devuelve el dinero y la unidad no regresa al inventario (maltratada,
  caducada o ya consumida). No se crea movimiento; la salida de la venta se conserva.
- Una misma línea repetida con decisiones distintas devuelve 400 sin escrituras.
- Los productos con lote siguen sin reposición automática; se reponen con un ajuste
  del lote. Servicios y productos sin inventario no tienen nada que reponer.

`refund_items.restocked_quantity` guarda las unidades realmente repuestas (`NULL` en
devoluciones anteriores a la migración 0109). Las lecturas de una venta agregan
`stock_consumed` por línea para ofrecer la casilla «Regresar al inventario» solo
donde la venta descontó existencias. La casilla inicia desmarcada para «Defectuoso»
y marcada para los demás motivos; la decisión explícita se conserva en la intención
persistida para reintentos. El detalle de la venta muestra «Devuelto sin regresar al
inventario», nunca el ticket del cliente.

Análisis reporta estas unidades en Merma como «Devoluciones que no regresaron al
inventario», valuadas con el costo de la partida al vender; sin costo histórico el
valor queda incompleto, nunca $0. Definición en
[`report-metric-definitions.md`](../../docs/report-metric-definitions.md).

## Recuperación y offline

Antes de enviar, el navegador persiste clave y payload en IndexedDB por
tenant/usuario/sucursal/venta. Un resultado incierto conserva esa identidad aunque
se cierre el modal, se navegue o se recargue. La recuperación muestra los datos
originales bloqueados y reintenta la misma operación, incluso si el recibo ya
refleja su confirmación. Otra pestaña no reemplaza una intención pendiente.

Un 401/402/403/409/429 o un rechazo posterior no demuestra que el primer intento
no se confirmó. La opción «Revisar resultado y desbloquear» consulta/reserva esa
misma clave bajo los locks de devolución: si ya existe, recupera su resultado;
si no existe, guarda una cancelación idempotente antes de permitir otra intención.
Un POST original que llegue tarde encuentra esa cancelación y no devuelve dinero
ni repone inventario. Así se puede corregir un payload inválido cuya respuesta se
perdió sin liberar a ciegas una operación potencialmente confirmada.

La devolución sigue requiriendo conexión. El almacenamiento local no concede
permisos ni guarda credenciales. Si no puede recuperarse o persistirse, se bloquea
la nueva escritura y se ofrece volver a intentar. Solo una respuesta definitiva
permite liberar la intención para registrar otra devolución.

## Escenarios y errores

```gherkin
Scenario: Devolver una unidad con pago mixto
  Given una venta de una unidad de $50 con $30 efectivo y $20 transferencia
  When el gerente registra la devolución con ambos medios
  Then existe una devolución y una sola reposición de esa unidad
  And el movimiento de devolución de efectivo es de $30
  And el neto por ambos medios es cero

Scenario: Recuperar una devolución parcial tras perder la respuesta
  Given una devolución parcial cuyo resultado es incierto
  When el gerente cierra, navega y vuelve a abrir la venta
  Then recupera el mismo payload y clave de idempotencia
  And el reintento no crea otra devolución ni reposición ni movimiento de caja
```

Ausencia de sesión/permiso/acceso conserva los gates existentes. Distribución
inconsistente devuelve 400; medios duplicados, importes inválidos, cantidades
excesivas o límites por medio excedidos devuelven 422 sin escrituras parciales.
Un fallo de transporte o 5xx conserva la intención. Solo una validación 400/422
del primer intento permite corregirla directamente; tras incertidumbre se usa
la conciliación autoritativa para desbloquear.

## Datos, API y auditoría

La migración expansiva 0108 agrega `refund_payments`, con pertenencia compuesta
al refund/tenant/sucursal, RLS forzado y privilegios SELECT/INSERT. Mantiene
`refunds.refund_payment_method` para filas de medio único y hashes de solicitudes
anteriores. Los padres sin distribución se leen mediante el campo histórico.
El guard de base conserva los límites por medio ante escrituras de una app anterior.
El downgrade no descarta distribuciones mixtas. Decisión: ADR-037.

`POST /orders/{id}/refunds` admite la distribución alternativa. Las respuestas
de devolución y recibo agregan `payments`. `POST /orders/{id}/refunds/reconcile`
requiere el mismo payload y clave, sesión/permiso/acceso comercial y CSRF. Devuelve
`confirmed` con la devolución previa o `cancelled` después de impedir que esa clave
pueda crear una devolución. No mueve dinero ni inventario. La cancelación se
audita como `orders.refund_reconcile`. `orders.refund` conserva auditoría con
su distribución y `shifts.cash_movement` documenta solo el tramo de efectivo.

## Matriz y aceptación

| Contrato | Evidencia automatizada |
| --- | --- |
| Unidad indivisible, reintento, inventario, payout y reporte por medio | `test_refund_method_validation.py` sobre API/PostgreSQL |
| RLS, pertenencia, grants, rollback y downgrade | `migration_tests/test_0108_refund_payments.py` |
| Confirmación/cancelación y carrera con POST tardío | `test_refund_reconciliation.py`, API y sesiones PostgreSQL con rol runtime |
| Cerrar/reabrir/navegar, payload y clave conservados | `OrderDetail.test.tsx`, fetch simulado |
| IndexedDB persistente, concurrencia y separación de identidad | `refundIntents.test.ts` |
| Distribución visible y envío $30+$20 | `RefundModal.test.tsx` |
| Reponer / no reponer, payload anterior, reintento, conflicto, costo faltante, aislamiento | `test_refund_restock.py`, `bdd/test_refunds.py` sobre API/PostgreSQL |
| Columna aditiva, registros anteriores en `NULL`, grants y downgrade | `migration_tests/test_0109_refund_item_restock.py` |
| Casilla por motivo, intención bloqueada y teclado a 390/1440 px | `RefundModal.test.tsx`, `e2e/refund-void.spec.ts` (mock) |

La aceptación requiere que los escenarios anteriores aprueben sin duplicar
unidades ni dinero registrado. La validación local no acredita despliegue ni devolución bancaria.
