# Ficha del cliente y continuidad de tareas

Entrega local del 22 de octubre de 2026; no certifica publicación ni canales externos.

`GET /api/v1/customers/{customer_id}` reutiliza `CustomerResponse`, acceso comercial y
`customers.view`. Consulta un cliente exacto del negocio; no depende de la primera página de
búsqueda. Inactivo se conserva consultable para historial. Desconocido y ajeno comparten 404.
Las tareas de creación validan además que siga activo; abrir una ficha no crea ni cobra nada.

`GET /api/v1/customers/{customer_id}/activity` requiere el mismo acceso owner/manager de CRM.
Devuelve `branch_id` y secciones `appointments`, `opportunities`, `followups`, `service_cases`
y, sólo con el feature existente habilitado, `customer_orders`. Cada sección tiene `items` y
`has_more`; no representa un total. Cada item proyecta `id`, `title`, `state`, `created_at` y
`due_at`, sin contactos, notas, importes ni montos estimados. Cinco SELECT (cuatro si Pedidos
está desactivado) filtran tenant, sucursal y cliente, con LIMIT 11 y diez resultados por fuente,
orden created_at descendente/ID. El título del pedido es su folio, no una identidad inferida.

Se incluyen estados abiertos y terminados como contexto histórico. La UI resume tres registros
por fuente, permite ampliar y omite bloques vacíos. Las fechas identifican la zona del dispositivo;
la vista exacta de cita conserva la zona del recurso. El historial de ventas existente conserva
su propia paginación y la sucursal seleccionada, reforzada con filtro explícito.

Cada enlace abre un registro exacto: cita `appointmentId`, oportunidad `opportunity_id`, tarea
`task_id`, caso `case_id` y `/pedidos/{id}`. Los destinos revalidan acceso y entidad. Las acciones
Nueva venta, Nuevo pedido y Agendar cita resuelven el cliente exacto antes de prellenar; los
formularios siguen exigiendo confirmación. Crear pedido respeta permiso y feature existentes.

Caja muestra el cliente de origen, bloquea el cobro mientras se verifica o falla la atribución,
y permite elegir explícitamente continuar sin cliente. La venta conserva el cliente en su cola
durable e idempotente existente. Una venta desde cita ofrece volver y confirmar el vínculo; la
navegación por sí sola no lo registra. Nueva venta limpia el contexto anterior.

No se mezclan clientes por teléfono ni se amplían permisos. Cookies, CSRF, gates comerciales,
aislamiento, no-store y limpieza de respuestas tardías permanecen. Los formularios y la ficha
se reinician al cambiar negocio, usuario, rol o sucursal; fallar actividad no bloquea Caja ni
presenta vacíos falsos como resultados confirmados.
