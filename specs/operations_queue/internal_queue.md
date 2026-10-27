# Cola operativa interna de lectura

## Enlaces a registros de origen

Cada fila abre una ruta local conocida con el identificador de origen, sin buscar en la muestra
de 20 filas ni ampliar permisos: `/service-cases?case_id=UUID`, `/crm?opportunity_id=UUID`,
`/followups?task_id=UUID` y `/appointments?reminder_id=UUID`. Recargar conserva el enlace;
cerrar la selección retira sólo ese parámetro. Un ID inválido o una entidad no disponible produce
un estado seguro, sin modificar registros ni interpretar una URL del payload.

Los GET individuales nuevos `/api/v1/crm/opportunities/{id}` y
`/api/v1/crm/followups/{id}` reutilizan los DTO de sus listas y requieren el mismo acceso comercial
dueño/gerente, tenant y sucursal. Conservan el estado real, incluso cerrado, sin escritura.
`GET /api/v1/appointments/reminders/{id}` sólo devuelve recordatorios pendientes disponibles,
de una cita programada cuya versión coincide; futuros, resueltos y obsoletos reciben 404.
La ausencia y la pertenencia a otro negocio/sucursal comparten 404; las operaciones originales
siguen verificando permisos, versión y estado al actuar. Todas las respuestas privadas son no-store.

Fecha: 2026-10-19. Estado: backend y UI implementados y validados localmente; release pendiente.
Origen: [contrato implementado](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/plans/PLAN-COLA-OPERATIVA-INTERNA.md). Este corte reúne
pendientes existentes; no crea otra lista de tareas ni completa el horizonte de automatización E2E.

## Acceso y respuesta

GET `/api/v1/operations/queue` requiere `require_crm`: dueño/gerente, sesión, acceso comercial y
sucursal verificada del negocio. Usa la conexión runtime ordinaria con RLS. No incorpora lealtad,
que tiene acceso exclusivo del dueño, ni permite seleccionar tenant/sucursal mediante payload.

No hay parámetros de filtrado/paginación en este primer contrato. Se devuelve `generated_at`
UTC y exactamente cuatro secciones en orden fijo. Cada sección contiene `source`, `items` y
`has_more`; no tiene total, puntuación de prioridad ni valoración económica.

| Sección | Criterio sobre la fuente | `route_key` |
|---|---|---|
| `service_cases` | Estado `open`, `in_progress` o `reopened`. | `service_cases` |
| `opportunities` | Etapa `new`, `contacted` o `proposal`, con `next_action` no nula ni vacía tras quitar espacios/tabs/saltos de línea. | `crm` |
| `followups` | Tarea `pending`, de cualquier tipo interno ya existente. | `followups` |
| `appointment_reminders` | Recordatorio `pending`, vencimiento disponible al consultar, cita `scheduled` de la misma sucursal y versión de cita igual a `appointment_version`. | `appointments` |

Agenda aplica el mismo criterio de disponibilidad que su vista de recordatorios: los futuros no
aparecen aún. Una reprogramación/versionado hace desaparecer recordatorios obsoletos sin reparar
ni suprimir registros durante esta lectura. No se aplica un filtro adicional de cliente activo,
para conservar la semántica de los módulos fuente y permitir revisar pendientes históricos.

Cada item proyecta únicamente:

- `source_id`: UUID del registro fuente, incluido el ID del recordatorio en agenda.
- `title` y `customer_name`: textos reales del título y cliente; no se inventa otra acción.
- `state` y `version`: estado/etapa y versión vigentes del registro fuente.
- `due_at`: fecha original normalizada a UTC, o null en casos/oportunidades sin fecha.
- `overdue`: fecha no nula anterior al reloj `generated_at`; no significa SLA incumplido.
- `route_key`: enumeración de destino; la UI construye sólo rutas conocidas a las vistas fuente.

No devuelve columnas de notas, próxima acción completa, teléfonos, correos, consentimiento,
importes estimados ni importes de ventas. Los títulos/nombres son texto del negocio autorizado;
no constituyen una proyección pública ni se registran en auditoría de la cola.

## Límites y semántica

Cuatro SELECT proyectan hasta 21 filas cada uno. Se muestran las primeras 20 y `has_more` indica
si existía la fila adicional. El máximo de respuesta son 80 items; el tamaño de la muestra no se
presenta como cantidad total de pendientes. Orden por fecha ascendente, fechas null al final e ID
como desempate estable. Una fecha null permanece sin vencimiento y nunca se marca vencida.

Los destinos son las vistas fuente; el contrato no promete seleccionar/abrir automáticamente el
registro al navegar. Continuar una acción conserva los permisos, validación y versiones de su
endpoint original. La cola no fusiona una oportunidad, tarea y caso por semejanza de texto.

El filtro temporal opcional del plan se deja fuera de este primer corte: no se interpreta "hoy"
usando una zona horaria implícita ni se ocultan los pendientes sin fecha. El usuario puede revisar
la fecha real y continuar en el módulo correspondiente.

## Seguridad y efectos

No agrega tablas, migraciones, grants, eventos, notificaciones, consultas privilegiadas ni acceso
a proveedores. No invoca procesamiento de seguimientos, puntos, casos o recordatorios. La
proyección sólo lee; los controles y auditorías estándar existentes de autenticación/billing
permanecen intactos. La respuesta privada conserva `private, no-store, max-age=0`.

Todos los SELECT filtran tenant y sucursal explícitamente y unen clientes por tenant/ID; agenda
une además cita/recordatorio por tenant/sucursal/ID. Las respuestas tardías deben descartarse al
cambiar identidad/sucursal, siguiendo el workspace operativo existente.

## Evidencia local

Ocho pruebas enfocadas pasan con psycopg y pg8000: vacíos, campos reales, exclusión de datos de
contacto/notas/importes, elegibilidad/versión, límite y desempate, fechas null/iguales al reloj,
dos negocios/sucursales, roles/billing, conexión con rol RLS y cuatro SELECT con LIMIT 21.
La prueba RLS usa datos existentes de dos tenants y prueba lectura propia y denegación cruzada.
La consulta no agrega auditorías de dominio, claves de idempotencia ni eventos de casos.

OpenAPI agrega sólo el path de lectura, con schemas `OperationsQueue*`; los paths/schemas anteriores
permanecen estructuralmente idénticos. Ocho pruebas locales de workerd pasan, incluyendo lectura
de cola antes/después de resolver un caso y otro tenant vacío. La UI aprobó 15 pruebas focales, cuatro recorridos responsivos con axe A/AA,
un recorrido real con cuatro fuentes y 1,102 pruebas frontend completas. Build y escaneo de
119 JS también aprobaron. CI y publicación conservan aceptación separada. El [informe de entrega](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/audits/KOVA-OPERATIONS-QUEUE-2026-10-19.md)
registra estos límites sin deducir disponibilidad productiva de los resultados locales.
