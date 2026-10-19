# Lealtad interna por cliente y sucursal

Estado: implementación en curso, 2026-10-19. Puntos internos; no dinero ni descuento POS.

El propietario configura explícitamente por sucursal una política opt-in: importe MXN por tramo
(`spend_amount`) y puntos por tramo (`points_per_step`). El estado inicial es desactivado y ambos
valores son desconocidos (`null`), sin sugerencias monetarias implícitas. Cada cambio agrega una
revisión inmutable con fecha de vigencia. La tasa de cada venta depende de la revisión vigente
cuando el servidor registró la venta; posteriores cambios no reprician ventas anteriores y una
pausa no pierde ventas elegibles que aún no se habían procesado.

Sólo ventas reales con cliente activo explícitamente asociado pueden acumular puntos. No se
unen contactos, no se usan estimados ni cotizaciones como ingresos. El cálculo usa Decimal:
`floor(total_mxn / spend_amount) * points_per_step`, sin fracciones ni redondeo hacia arriba.
No se arrastra el sobrante monetario de una venta a otra. El total es el total POS ya calculado,
incluidos descuentos/impuestos existentes; no se modifica su definición ni su importe.

Un ledger append-only conserva acumulación, reversas por devolución y anulación, y canjes. Una
venta genera como máximo una acumulación, incluso de cero puntos. Cada devolución conserva un
efecto único y reduce el saldo mediante diferencia entre los puntos del neto previo y nuevo,
con la tasa original. Una anulación revierte los puntos que aún quedaban de esa venta. El orden
por fecha/ID de las devoluciones es determinista. El procesamiento es acotado e idempotente;
no vuelve a acumular al editar una política ni altera ventas, pagos, inventario o caja.

Los canjes requieren propietario, cliente activo, saldo esperado, puntos positivos, descripción
de beneficio y confirmación explícita. Sólo registran un débito de puntos; no certifican entrega,
no reservan productos, no aplican descuentos y no procesan cobros. Si posteriormente hay una
reversa de compra, el saldo puede quedar negativo: se muestra íntegro y bloquea nuevos canjes.
No se ocultan ni limitan las reversas para acomodar un saldo ya consumido.

Los endpoints privados y worker revalidan acceso comercial y propiedad tenant/sucursal. Para
procesar una política se revalida que su autorizante siga siendo propietario activo con acceso
a la sucursal. Un bloqueo de facturación impide procesamiento/canje. Las reversas se procesan
aunque la política se desactive, conservando su regla original. No hay canal externo asociado.

## API y seguridad

Todas las rutas `/api/v1/loyalty` requieren propietario y acceso comercial. GET raíz expone
política y cuentas paginadas; GET `/customers/{id}` expone saldo y ledger paginado, con
`adjustments_pending` cuando hay devolución/anulación sin materializar. PUT `/policy` y
POST `/customers/{id}/redeem` requieren Idempotency-Key y versión/saldo esperado. POST `/process`
materializa como máximo cien entradas por pasada, priorizando reversas pendientes. El worker
privado usa el mismo servicio con tenant/sucursal explícitos y cohorte autorizada.

El canje toma el mismo bloqueo de las ventas fuente que utilizan devolución/anulación antes
de verificar ajustes pendientes y saldo. El bloqueo asesor por sucursal serializa política,
procesamiento y canje: dos confirmaciones simultáneas no duplican acumulación ni consumen el
mismo saldo. Una reversa pendiente bloquea el canje y pide procesar primero; no se oculta un
ajuste conocido para aceptar puntos aparentemente disponibles.

`0089_internal_loyalty` crea `loyalty_policy_revisions` y `loyalty_entries`, ambas FORCE RLS
con relaciones tenant/sucursal, grants runtime exclusivamente SELECT/INSERT y ningún permiso
Data API. El historial es append-only: no se edita ni se elimina desde runtime. Los downgrades
rechazan borrar revisiones o puntos existentes. Exportación/purga siguen el grafo del negocio.
El rol propietario de migraciones conserva la purga explícita por solicitud de eliminación.

No caducan puntos automáticamente ni se importan saldos históricos arbitrarios; no existe
transferencia de puntos entre sucursales ni equivalencia monetaria implícita. Los reportes
financieros, pagos y existencias permanecen en sus dominios originales. Este módulo no valida
entrega física del beneficio escrito, descuentos fiscales ni liquidaciones de un proveedor.

## Evidencia local

Once pruebas de dominio/API/runtime cubren tasas explícitas, vigencias históricas, pausas,
redondeo Decimal, cero puntos, acumulación/canje concurrentes con rol RLS, reversas por
refund/void, saldo negativo, presupuesto de 103 devoluciones, billing/RBAC, aislamiento y worker.
Dos pruebas de migración verifican conservación de ventas, rollback vacío reversible y rechazo
del downgrade con historial. La validación local no sustituye aceptación productiva autorizada.
