# Cola de pendientes internos

Fecha: 2026-10-19. Estado: backend y UI publicados en `734f67fa` y aceptados a las 17:09:23 UTC;
[evidencia pública y límites](../audits/KOVA-OPERATIONS-QUEUE-2026-10-19.md). Complementa
[atención postventa](../audits/KOVA-SERVICE-CASES-2026-10-19.md). Las specs conservan el contrato
de implementación; el sprint y los informes de aceptación registran el estado de publicación.

## Problema y beneficio

El dueño/gerente consulta por separado oportunidades, seguimiento, citas y casos. Cada módulo ya
conserva su estado, pero todavía falta una consulta común de lo que exige atención. Reunir estos
pendientes permite abrir el flujo correcto sin volver a capturar datos ni inventar otra lista de tareas.

## Contrato implementado

GET privado `/api/v1/operations/queue`, para owner/manager con acceso comercial y contexto
de sucursal verificado. Sin tabla nueva, escritura, worker, inferencia ni llamada externa.

Cuatro secciones calculadas desde fuentes existentes:

| Fuente | Elegibilidad real | Continuación |
|---|---|---|
| Casos | `open`, `in_progress`, `reopened`. | Vista de atención. |
| Oportunidades | `new`, `contacted`, `proposal`, con próxima acción no vacía. | Revisar oportunidad en CRM. |
| Postventa | Tareas internas pendientes, sin inferir un envío. | Revisar seguimiento existente. |
| Agenda | Recordatorios `pending` disponibles al consultar, de versión vigente de cita `scheduled`. | Revisar cita/recordatorio. |

Respuesta: `generated_at` UTC y secciones con `source`, `items`, `has_more`. Cada item
conserva `source_id`, `title`, `customer_name`, `state`, `version`, `due_at`, `overdue` y `route_key`. La UI construye rutas conocidas; no recibe URLs arbitrarias ni promete abrir el registro individual.
No devuelve notas completas, teléfonos, correos ni importes de ventas en este primer corte.

Máximo: 20 filas por sección, 80 en total. Orden estable por vencimiento, fechas sin
vencimiento al final e ID como desempate. El filtro temporal opcional se dejó fuera de este primer contrato: no
se interpreta “hoy” con zona implícita ni se ocultan pendientes sin fecha. `has_more` conduce a la vista del dominio para consultar el resto,
sin convertir los límites de muestra en un total de pendientes.

Mostrar cuatro secciones conserva el significado de cada estado. No sumar ni fusionar registros
que parezcan describir la misma incidencia: una oportunidad, una tarea y un caso son entidades
independientes hasta que exista un vínculo explícito. No generar prioridades IA, cifras de ahorro,
SLA ni ingresos atribuidos.

## Validación local y aceptación pendiente

El contrato fuente se congeló con DTOs `OperationsQueue*`, sin parámetros de filtrado/paginación.
Cuatro SELECT proyectados consultan 21 filas por sección; se muestran hasta 20 y `has_more` indica
la fila adicional real. Orden por fecha ascendente, null al final e ID como desempate. `overdue`
usa una sola fecha UTC del servidor; null nunca vence. Agenda excluye recordatorios futuros y
versiones obsoletas, conforme a su vista fuente.

- Ocho pruebas focales con psycopg y ocho con pg8000 aprobadas: dos tenants/sucursales, roles,
  billing, datos vacíos, campos mínimos, fechas/versiones, límites y SQL con LIMIT 21.
- Ocho pruebas de runtime workerd aprobadas; incluyen lectura antes/después de resolver un caso
  y otro tenant vacío. OpenAPI conserva estructuralmente sus paths/schemas anteriores.
- La conexión runtime conserva RLS; las consultas filtran tenant/sucursal explícitamente y unen
  clientes por tenant/ID. No incorpora lealtad, exclusiva del dueño.
- No hay tablas, migraciones, grants, escrituras, eventos, worker ni proveedores nuevos. Consultar
  no procesa seguimientos, puntos o recordatorios. Los controles existentes permanecen intactos.

Fuente implementada: `backend/app/operations_queue/`, router en `backend/app/main.py`, pruebas en
`backend/app/tests/test_operations_queue.py` y spec en `specs/operations_queue/`.
La UI aprobó 15 pruebas focales, cuatro recorridos responsivos con axe A/AA y un recorrido real
navegador/API/Postgres con RLS y las cuatro fuentes. La suite frontend completa aprobó 1,102
pruebas en 176 archivos; tsc, ESLint, build SSR/prerender y escaneo de 119 JS aprobados. La
revisión independiente no encontró problemas reproducibles. Los gates finales del release
conservan aceptación separada. No se declara disponibilidad productiva ni
E2E total. [Evidencia y límites](../audits/KOVA-OPERATIONS-QUEUE-2026-10-19.md).
