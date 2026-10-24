# Centro de control del negocio

## Consulta y autorización

`GET /api/v1/reports/dashboard?period=day|week|month&branch_id=all|UUID`
amplía el overview con `control_center`. Omitir `branch_id` conserva la respuesta
anterior. Se mantienen permiso de reportes, acceso comercial y caché privada
no-store. La UI solicita todas al entrar; miembros con `allowed_branch_id` sólo
pueden consultar su sucursal, incluso solicitando `all`. El servidor rechaza
sucursales ajenas y restaura el contexto operativo después de la supervisión.

## Proyección y definiciones

- `scope` declara alcance efectivo y permiso para consultar todas.
- `branches` contiene opciones autorizadas; `branch_sales` sólo el alcance
  consultado, incluyendo sucursales sin ventas. Contiene órdenes completadas,
  ventas netas, ticket, participación, stock bajo, turnos abiertos y señales.
  Las ventas usan la cohorte y devoluciones del reporte por sucursal existente.
- `areas` ofrece métricas tipadas para seis áreas. Cada métrica declara su base:
  `current`, `period`, `today` o `business`. Catálogo y clientes son globales.
- `generated_at` indica actualización; la UI usa la zona horaria del negocio.
- `alerts` agrupa por tipo y sucursal, con cantidad, ruta y prioridad. Son
  señales, no registros únicos entre categorías: un pedido puede aparecer en varias.
- Se muestran hasta 12 grupos, ordenados por prioridad, cantidad y sucursal.
  `alert_groups_total`, `priority_counts` y señales por sucursal se calculan antes
  del límite; `alerts_has_more` comunica que hay más grupos.

Los totales provienen de agregados SQL, nunca del tamaño de listas paginadas.
Todos filtran tenant y sucursales autorizadas. Inventario se evalúa por posición
producto/sucursal, incluyendo productos activos sin movimientos; no se compensa
un faltante con otra sucursal. Disponible es físico menos reservado, mínimo cero.
Lotes vencidos o por vencer en siete días requieren saldo físico positivo.
Conflictos cuentan pedidos distintos, incluidos déficits de lote.

Caja usa apertura + cobros en efectivo + entradas − salidas − pagos de devolución.
Pedidos activos se desglosan por estado, entrega vencida y falta de venta cobrada.
Compras pendientes/parciales se consultan por estado persistido.
Clientes incluye oportunidades abiertas, próximas acciones no vacías vencidas,
solicitudes nuevas, seguimientos pendientes y cotizaciones vigentes. Agenda cuenta
citas programadas de hoy, citas pasadas sin actualizar y recordatorios vencidos
únicamente de la versión vigente de una cita programada. Atención incluye casos
abiertos/vencidos, conversaciones abiertas y borradores internos.

Conciliación descuenta coincidencias confirmadas de los saldos sin asignar.
Gastos y utilidad requieren `margin_reports` y permiso de gastos; utilidad sin
costos suficientes permanece nula. Lealtad, equipo, suscripción y fiscal mantienen
sus permisos; lealtad es exclusiva del dueño también en navegación. Fiscal consulta
preparación registrada y pendientes `live`: un CFDI de prueba no implica preparación
productiva. WhatsApp usa la disponibilidad declarada por el backend, sin inventar
una conexión ni contactar al proveedor.

Cada área opcional se aísla con savepoint: un fallo SQL produce `unavailable`, sin
métricas ni alertas parciales. La UI comunica lectura parcial y nunca convierte
el fallo en cero pendientes. No requiere migraciones ni nuevas acciones externas.

## Navegación y dispositivo

Filtrar o cambiar periodo sólo cambia la consulta. Abrir una herramienta operativa
desde todas pide elegir sucursal. Abrir otra sucursal requiere confirmar el cambio
operativo y el vaciado del carrito/cambios sin guardar; cancelar conserva Caja.
La navegación global no requiere cambiar sucursal.

Sincronización lee sólo la cola local del dispositivo y tenant actual. Espera las
tres lecturas antes de afirmar cantidades. No modifica registros, idempotencia ni
el trabajador de sincronización. El fallback anterior explicita su alcance operativo.

## Jerarquía visual (2026-10-24)

Panel presenta primero cifras y gráfico horario/diario del overview; después
compara sucursales, productos, horas y cobros. Cada área expone dos señales y
permite expandir el resto. Los tres primeros grupos de pendientes se muestran
inicialmente y el resto se puede expandir sin alterar el límite ni los totales
backend. Análisis conserva rangos personalizados y lectura profunda, con
navegación hacia rentabilidad, operación, reposición/productos y plan de acción.
