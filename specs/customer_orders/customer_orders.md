# Especificación: Pedidos de clientes

## Problema

Kova necesita representar compromisos que todavía deben prepararse, cobrarse o entregarse sin
registrarlos prematuramente como ingreso. Caja sigue resolviendo ventas inmediatas y Ventas sigue
siendo el historial financiero; Pedidos es un dominio operativo independiente.

## Usuarios y valor

- Dueño y gerente: supervisan, corrigen estados y cobran.
- Cajero y staff: capturan, preparan, avanzan, cancelan pedidos no pagados y cobran.
- El negocio puede comprometer inventario sin duplicar ingresos ni sobreasignar existencias.

## Flujo y estados

El flujo normal es `new → confirmed → in_progress → ready → fulfilled`. `cancelled` es terminal.

- Cajero y staff avanzan un paso.
- Dueño y gerente también pueden retroceder un paso para corregir la operación.
- `fulfilled` exige una venta vinculada con pago completo.
- Un pedido pagado no se cancela: primero se anula o devuelve totalmente la venta mediante el
  flujo financiero autorizado.
- El estado de pago se deriva de la venta: `unpaid`, `paid`, `partially_refunded`, `refunded` o
  `voided`; no se persiste como una segunda fuente de verdad.

## Captura y snapshots

- Modalidad: recoger o entrega. La entrega exige nombre y dirección; teléfono es opcional.
- Canal: mostrador, teléfono/WhatsApp u otro.
- Se aceptan fecha prometida opcional, nota general y nota por artículo de hasta 200 caracteres.
- Producto, nombre, precio y modificadores se congelan al capturar. Cambios posteriores al
  catálogo no alteran el total prometido.
- No se permiten precio libre, descuentos, impuestos, anticipos, pagos parciales ni cargos de
  entrega automáticos. Un envío cobrable se modela como producto de catálogo.

## Inventario

- `new` no reserva.
- Confirmar crea una reserva agregada por producto después de bloquear y validar existencias.
- Editar un pedido confirmado recalcula sus reservas atómicamente.
- Cancelar libera, y cobrar consume, las reservas.
- Disponibilidad es `stock_on_hand - reserved_quantity` y Caja respeta reservas activas ajenas.
- Un ajuste físico es la verdad y puede dejar reservas insuficientes. El pedido queda en conflicto
  y no puede cobrarse hasta corregir artículos o inventario.

## Conversión a venta

`POST /api/v1/customer-orders/{id}/checkout` bloquea pedido, reservas y productos, valida versión,
pago exacto y turno para efectivo, y crea exactamente una venta financiera junto con artículos,
modificadores, pagos y movimientos. Después consume reservas y vincula la venta en la misma
transacción. Usa precios prometidos y costo vigente. Un producto desactivado puede cobrarse si aún
existe y conserva una reserva válida.

Solo la venta cobrada afecta reportes, turnos, recibos e ingresos. El documento “Pedido PED-…” no
es recibo de pago ni comprobante fiscal.

## API, concurrencia e idempotencia

- Se expone `/api/v1/customer-orders`; `/api/v1/orders` no cambia.
- Toda mutación exige `Idempotency-Key` y `expected_version`.
- Una versión obsoleta devuelve `409 VERSION_CONFLICT`; otros códigos funcionales son
  `INVALID_TRANSITION`, `ALREADY_PAID`, `PAID_ORDER_REQUIRES_REVERSAL` y `OUT_OF_STOCK`.
- Las operaciones bloquean filas y aumentan `version`. Reintentar la misma mutación devuelve el
  mismo resultado; checkout nunca duplica la venta.

## Seguridad, rollout y privacidad

- Las cuatro tablas son tenant-scoped con RLS habilitado y forzado, políticas `USING` y
  `WITH CHECK`, más defensa de tenant en repositorios y servicios.
- Los permisos son `customer_orders.view/create/update/cancel/checkout`.
- El módulo requiere acceso comercial y el feature flag `customer_orders`, apagado por defecto.
- La auditoría registra acciones e identificadores operativos, no teléfono, dirección ni notas.

## Offline

Los pedidos activos y recientes se cachean por tenant solo para consulta e impresión. Offline se
muestra la fecha de actualización y se bloquean creación, edición, cambios de estado, cancelación y
cobro. La caché se borra al cerrar sesión. No existe una segunda cola; Caja conserva sin cambios su
cola de ventas inmediatas.

## Fuera de alcance

CRM, mesas, meseros, KDS especializado, recetas por ingrediente, repartidores, mapas, tarifas,
WhatsApp automático, flujos configurables, descuentos, impuestos y CFDI. Las funciones fiscales
futuras operarán sobre la venta financiera, nunca sobre el pedido pendiente.

## Criterios de aceptación

- Un pedido puede capturarse, confirmarse, prepararse, cobrarse y entregarse sin modificar Caja
  normal ni contabilizar ingreso antes del cobro.
- Dos pedidos, o un pedido y Caja, no comprometen silenciosamente las mismas existencias.
- Reintentos y concurrencia no generan ventas duplicadas ni reservas huérfanas.
- Roles, feature flag, acceso comercial y tenant impiden accesos no autorizados.
- Sin conexión se conserva visibilidad de trabajo reciente en modo de solo lectura.
