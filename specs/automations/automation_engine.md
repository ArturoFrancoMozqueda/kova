# Automatizaciones operativas internas

Implementación inicial del plan E2E: eventos transaccionales, reglas opt-in por sucursal y tareas
internas durables. No envía WhatsApp/correo, no cobra, no factura y no modifica inventario.
La respuesta de capacidades declara expresamente esos límites.

## Contratos y autorización

- `GET /api/v1/automations`: reglas, últimas 100 ejecuciones y capacidades; `limit` máximo 200.
- `PUT /api/v1/automations/rules/{template_key}`: `enabled`, `expected_version` (0 para crear).
- `POST /api/v1/automations/process`: procesa hasta 100 eventos/tareas de la sucursal actual.
- `POST /api/v1/automations/runs/{id}/resolve`: versión y estado `completed` o `dismissed`.
- Acceso comercial y `settings.manage` obligatorios; tenant y sucursal provienen de la sesión.
- Una regla captura al autorizante y su versión. Worker revalida usuario activo/verificado,
  membresía activa, permiso, alcance de sucursal y acceso comercial; no necesita sesión de navegador.
- Las tareas de pedido respetan el flag `customer_orders` y el permiso de consulta; las de
  reposición requieren el permiso de inventario del autorizante, también durante su ejecución.
- Todas las tablas tienen FORCE RLS por tenant y FKs compuestas; aislamiento adicional de sucursal.

## Plantillas

`order_ready`, `order_fulfilled`, `restock_review` crean tareas internas sobre datos reales. La regla
empieza desactivada y sólo procesa eventos posteriores a su activación. Pausar o cambiar la regla
suprime tareas pendientes de versiones anteriores. No se reproducen efectos históricos al reactivar.

Pedidos requieren que el estado y versión actuales coincidan con el evento. Si cambian, la tarea
se suprime al procesar y no puede completarse. Reposición exige producto activo con inventario,
umbral configurado y disponible (existencia menos reservas activas) menor o igual al umbral.
La regla de reposición escanea el inventario real y registra cambios con revisión en microsegundos
UTC a partir de la última actualización de producto, reserva o movimiento. Repetir el escaneo sin
cambio no crea tarea; editar una reserva existente o el umbral sí se vuelve a evaluar. El tipo
BIGINT conserva la revisión sin desbordar INTEGER; los valores actuales caben en enteros seguros JS.

Eventos se insertan en la transacción del dominio, con identidad única por tipo/entidad/versión y
sin nombres/teléfonos/textos privados. Rollback retira también el evento. Un bloqueo transaccional
por tenant/sucursal serializa cambios de reglas, procesamiento y resolución. Una restricción única
evento/regla y una tarea pendiente por fuente evitan duplicados. Un fallo previo al commit no pierde
el evento y repetir la resolución final devuelve el resultado existente.

Procesamiento es acotado y usa el worker privado existente; el caller conserva la responsabilidad
de bind de tenant/sucursal y commit. No se comparte el registro agregado de cambios del asistente.

## QA

Probar replay y rollback de evento, regla apagada, cambio de versión, pausa/revocación, estados de
pedido obsoletos, reposición con reservas, aislamiento de tenant/sucursal, permisos y billing.
Validación con PostgreSQL real; mocks no acreditan entrega de mensajes ni cobros.


## Revisión de vencimientos de atención (corte 2026-10-19)

`service_case_overdue` es opt-in y comienza desactivada. Genera sólo una revisión interna por caso
activo y fecha de vencimiento. No escala personas, define SLA, envía mensajes ni compensa ventas.
Sólo son elegibles vencimientos manuales desde `enabled_since`, anteriores al reloj del servidor;
no hay retroactividad automática para casos vencidos antes de autorizar la regla.

La identidad del evento `service_case.review_due` usa caso y fecha UTC en microsegundos, igual al
patrón BIGINT de reposición. Notas/asignación no generan otra revisión. Cambiar la fecha invalida
el pendiente anterior; la nueva fecha puede generar otra revisión al vencer. Volver a una fecha ya
procesada no repite el evento. Una revisión completada/descartada no vuelve por la misma fecha.

El scanner proyecta candidatos con NOT EXISTS antes del límite, para que casos ya procesados no
bloqueen otros. El barrido acotado de supresión prioriza revisiones de casos con fuente obsoleta,
para que un lote lleno de revisiones válidas no las bloquee. Reusa el bloqueo transaccional por sucursal y las restricciones únicas. El worker
existente conserva cohort/lease/runtime RLS y billing. Usuario activo/verificado, membresía activa,
`settings.manage` y alcance de sucursal se revalidan; no requiere feature de pedidos.

Resolver/cancelar el caso, quitar/cambiar fecha o perder autorización suprime tareas pendientes en
el siguiente procesamiento acotado; no se promete supresión inmediata fuera de ese ciclo. Completar
la revisión exige fuente vigente. La validación de la fuente toma FOR SHARE sobre el caso hasta el commit: un cierre o
reprogramación concurrente no puede confirmar entre validar y completar la revisión. La revisión
no cambia estado ni historia del caso. La auditoría
y eventos del motor contienen identificadores/estado, sin título, cliente o notas privadas.

Validación local de este corte: 25 pruebas API aprobadas con psycopg y 25 con pg8000 (diez de
vencimientos y 15 del motor previo), más dos pruebas de migración 0091. Incluye creación y
resolución con dos conexiones runtime simultáneas, un solo evento/revisión y una sola auditoría de
resolución; carrera de cierre confirmada antes del arreglo y bloqueo de fuente hasta commit;
dos negocios reales y sucursales; roles y billing; vencimiento sin retroactividad;
notas sin duplicar; fechas futuras/null; reprogramación/resolución/pausa/revocación; y lotes de una
fila sin bloquear nuevos casos ni suprimir tarde los obsoletos. Downgrade vacío es reversible y
rechaza retirar la plantilla cuando existe historial, aun con regla desactivada. Ruff y diff-check
aprobados. No acredita ejecución productiva ni efectos externos.
