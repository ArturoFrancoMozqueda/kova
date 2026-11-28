# Experiencia de tareas recurrentes

## Problema y alcance

La primera venta mide activación, pero no permite saber si el equipo puede repetir una tarea
sin errores ni cuánto trabajo activo requiere. Se extiende la telemetría existente; no se agrega
un proveedor ni se inventan satisfacción, ingresos, retención o resultados de usuarios reales.

## Eventos y privacidad

`task_started` y `task_finished` usan la ruta autenticada de telemetría. Las categorías son
`cash_sale`, `customer_order`, `purchase_receipt`, `replenishment_purchase`, `automation_task`,
`production_batch` (registrar un lote en Producción) y `shift_close` (cerrar el turno de caja).
Cada intento usa un UUID aleatorio sin relación con un registro del negocio. No incluye nombres,
texto libre, importes, productos, clientes ni IDs de operaciones. La ruta se normaliza al módulo.

El guard local de entrega conserva negocio y usuario como precondición, fuera de propiedades
y cuerpo JSON. Se envía en los headers de identidad esperada existentes; el servidor obtiene
la identidad de las cookies y rechaza el cruce de sesión. Un evento encolado de A no se atribuye
a B. Un rechazo 409 se descarta. La telemetría nunca autoriza operaciones de negocio.

## Semántica

- El intento empieza con la primera interacción; no con el montaje de la pantalla.
- `active_ms` usa reloj monotónico y excluye pestañas ocultas y esperas explícitas de servidor.
  `elapsed_ms` mide el intervalo monotónico completo. Ambos se acotan a 24 horas y se envían
  calculados: las fechas de recepción no se usan para restar tiempos.
- `completed` requiere respuesta exitosa de la operación. Sigue siendo autorreporte de cliente,
  no evidencia contable ni prueba de que una acción física ocurrió.
- Una venta guardada offline termina como `queued`, nunca como completada por servidor.
  La sincronización conserva su cola/idempotencia y no se mezcla con tiempo activo.
- Los rechazos definitivos producen `failed`; un cierre explícito antes de guardar, `cancelled`.
  Un desmontaje sin resultado no inventa uno. Puede haber intentos sin resolver por abandono,
  cierre del equipo, pérdida de telemetría o límite de ventana.
- Cada venta enviada conserva su propio intento aunque la siguiente se prepare antes de la
  respuesta anterior. Las respuestas invertidas no cierran el intento de otro carrito.
- Resolver una revisión de regla acredita esa revisión; no acredita entrega, compra ni contacto.

## Consulta de operación

`GET /api/v1/telemetry/internal/task-experience?days=7|30` exige la misma clave interna del reporte
de adopción. No se expone a clientes ni en OpenAPI público. Devuelve agregados sin identidades:
iniciados, finalizados, completados, fallidos, cancelados, encolados, pendientes de resultado,
resultados sin inicio y resultados contradictorios, tasa de completado y medianas de intentos
completados. Sin inicios o duraciones devuelve `null` en tasa o mediana, respectivamente.
`measurement_source` declara `client_reported`.

El emparejamiento usa propietario autenticado e intento opaco; tolera llegada invertida y colapsa
duplicados. Resultados contradictorios no cuentan como éxito. La ventana se define por recepción
y puede cortar un par en sus extremos, que queda explícitamente sin emparejar.

## Aceptación

Pruebas de reloj activo/oculto/espera, ventas concurrentes con respuestas invertidas,
eventos nuevos durante flush, guard al reintentar offline, validación de propiedades,
replay idempotente, protección de consulta y agregados sin PII. Conservar la utilidad de Análisis.
Comprensión, dificultad percibida y satisfacción requieren personas; los tiempos automatizados
no las sustituyen.
