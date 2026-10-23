# Agenda interna por recurso y sucursal

Corte solicitado 2026-10-19. Agenda owner/manager con acceso comercial, cookies/CSRF y sucursal
autorizada. No conecta Google/Meta, no expone disponibilidad pública, no cobra ni crea ventas.

El dueño define recursos reales (por ejemplo una persona o un espacio) y su zona IANA mexicana:
America/Mexico_City, Cancun, Tijuana, Hermosillo, Mazatlan o Monterrey. No se crean recursos de
muestra. Zona del recurso inmutable; la interfaz la muestra junto a cada cita. API exige instantes
con offset; persiste y responde UTC, conservando zona para visualización. Un horario local ambiguo
debe resolverse a un instante con offset por el operador; el servidor no adivina horarios de verano.

Una cita vincula cliente activo explícito y recurso activo de la sucursal. Tiene título, intervalo,
nota privada y versión. Inicio futuro hasta 366 días y duración positiva hasta 24 horas. Intervalos
[start,end): citas contiguas permitidas. Se rechaza cualquier intersección con citas scheduled del
mismo recurso. Bloqueo transaccional advisory por tenant/sucursal/recurso serializa altas,
reprogramación y transición; el recurso también se bloquea para evitar carreras con desactivación.

Reprogramación conserva recurso/cliente y exige versión vigente; para cambiar recurso/cliente,
cancelar y registrar otra cita. Cancelled/completed/no_show son finales. Completed/no_show sólo
después de iniciar. Desactivar recurso no cancela citas existentes, pero bloquea altas y cambios de
horario. Historial de snapshots y actor se agrega con cada cambio, sin UPDATE runtime.
Idempotency-Key comparte transacción con mutación, historia y recordatorio. No hay borrado de citas.

Cada versión scheduled genera un recordatorio interno, vencido 24h antes de inicio (o ahora si se
registra dentro de ese plazo). Cambio de horario o resolución suprime recordatorios pendientes de
versiones anteriores. La bandeja incluye recordatorios vencidos con cita vigente; completar es una
acción humana que no significa envío. No llama ningún proveedor ni requiere consentimiento de
marketing para una tarea privada. Revalida cita/cliente y permiso comercial antes de resolver.

Tablas privadas aditivas con ENABLE/FORCE RLS, FKs compuestas tenant/sucursal, grants por columnas,
exportación y purga en inventario central. Auditoría sólo IDs, estado y versión, sin título/nota/PII.

## Contrato y evidencia

Prefijo `/api/v1/appointments`. Recursos: `GET/POST /resources`, `PATCH /resources/{id}`.
Citas: `GET/POST` del prefijo, `POST /{id}/reschedule`, `POST /{id}/transition` y
`GET /{id}/history`. Tareas: `GET /reminders`, `POST /reminders/{id}/resolve`.
Listas de citas/recordatorios tienen `limit` (1–200), `offset` y `has_more`. Recursos se limitan a
200 por sucursal. Citas por defecto: intervalo desde hace siete días hasta dentro de 90; filtros
`starts_from` y `starts_until` requieren offset, rango positivo de hasta 366 días. La consulta
incluye citas que intersectan ese rango, incluso cuando empiezan antes de su límite inferior.
Las listas se construyen con JOINs acotados, sin una lectura de cliente/recurso por cada cita.

Validación backend local: **17 pruebas aprobadas**, incluyendo dos conexiones runtime concurrentes,
RLS SQL sin bypass, grants inmutables, revocación por recurso/cliente, cancelación/reprogramación,
historia y recordatorio en la misma transacción, tareas vencidas sin envío y replay idéntico en UTC
con PostgreSQL configurado en America/Mexico_City. **Cinco pruebas de migración** (matriz general
0065 y pruebas 0088) verifican permisos exactos de los seis dominios nuevos agenda/lealtad,
conservación de ventas, upgrade/downgrade vacío y rechazo de pérdida de historial.

Pendientes de aceptación: navegador y runtime Workers del corte completo, carga, operación con
horarios reales del negocio y dispositivos. No se certifica integración con calendarios externos,
reserva pública, cobro, aviso por canal, disponibilidad laboral recurrente ni sincronización offline.

## Continuidad con cliente y venta (2026-10-22)

La agenda permite abrir la ficha exacta del cliente, continuar en Caja con ese cliente validado y
volver a la cita por `appointmentId`, aunque esté fuera del período visible. `customerId` desde
Clientes abre el formulario con el cliente activo resuelto por ID; no crea una cita automáticamente.

`GET /{id}` consulta una cita exacta en la sucursal. `GET /{id}/sales` devuelve ventas vigentes del
mismo cliente/sucursal aún sin cita, con paginación `limit` (1–100), `offset` y `has_more`.
`POST /{id}/sale` recibe `{expected_version, sale_order_id}` e Idempotency-Key. Mantiene las mismas
barreras comerciales, owner/manager, cookie/CSRF y sucursal que la agenda. La selección es explícita:
no se asocia una venta por proximidad de fecha, importe, teléfono ni nombre.

El vínculo se conserva en `appointment_sales`, privada con ENABLE/FORCE RLS y sólo SELECT/INSERT
para runtime. FKs compuestas verifican tenant/sucursal, una venta sólo corresponde a una cita y
cada cita sólo admite una venta. No se reemplaza ni elimina el vínculo desde la interfaz. Exportación
y purga de cuenta incluyen esta relación antes de sus padres.

La transacción bloquea primero la venta y después la cita, valida cliente idéntico y activo,
venta completed, cita scheduled/completed y versión vigente; agrega vínculo, historial `sale_linked`,
versión, auditoría y replay en una transacción. No crea una venta, aplica un pago, cambia inventario,
completa atención ni envía avisos. Dos atribuciones simultáneas de la misma venta se serializan.

La respuesta de cita añade `sale` nullable con ID, estado vigente, importe original, suma real de
devoluciones y fecha. Anulaciones/devoluciones posteriores se reflejan al consultar; no se etiqueta
una cita atendida como pagada. Las listas agregan devoluciones por página, sin una consulta por cita.
