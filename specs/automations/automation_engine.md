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
