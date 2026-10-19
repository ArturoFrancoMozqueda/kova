# Propuesta: cola de pendientes internos

Fecha: 2026-10-19. Estado: propuesta de siguiente corte pequeño sin cuentas externas; **no
implementada**. Complementa [atención postventa](../audits/KOVA-SERVICE-CASES-2026-10-19.md).

## Problema y beneficio

El dueño/gerente consulta por separado oportunidades, seguimiento, citas y casos. Cada módulo ya
conserva su estado, pero todavía falta una consulta común de lo que exige atención. Reunir estos
pendientes permite abrir el flujo correcto sin volver a capturar datos ni inventar otra lista de tareas.

## Contrato candidato

GET privado propuesto `/api/v1/operations/queue`, para owner/manager con acceso comercial y contexto
de sucursal verificado. Sin tabla nueva, escritura, worker, inferencia ni llamada externa.

Cuatro secciones calculadas desde fuentes existentes:

| Fuente | Elegibilidad propuesta | Continuación |
|---|---|---|
| Casos | Estados activos, con responsable/vencimiento reales. | Abrir caso existente. |
| Oportunidades | Etapas abiertas y próxima acción registrada. | Revisar oportunidad en CRM. |
| Postventa | Tareas internas pendientes, sin inferir un envío. | Revisar seguimiento existente. |
| Agenda | Recordatorios pendientes de la versión vigente de una cita programada. | Revisar cita/recordatorio. |

Respuesta propuesta: `generated_at` UTC y secciones con `source`, `items`, `has_more`. Cada item
conserva `source_id`, título, estado y fecha opcional reales, indicador de vencimiento según su
fuente y una clave de ruta permitida. La UI construye rutas conocidas; no recibe URLs arbitrarias.
No devuelve notas completas, teléfonos, correos ni importes de ventas en este primer corte.

Máximo propuesto: 20 filas por sección, 80 en total. Orden estable por vencimiento, fechas sin
vencimiento al final e ID como desempate. Un filtro temporal opcional exige offset explícito; no
se asume la hora de otra sucursal. `has_more` conduce a la vista del dominio para consultar el resto,
sin convertir los límites de muestra en un total de pendientes.

Mostrar cuatro secciones conserva el significado de cada estado. No sumar ni fusionar registros
que parezcan describir la misma incidencia: una oportunidad, una tarea y un caso son entidades
independientes hasta que exista un vínculo explícito. No generar prioridades IA, cifras de ahorro,
SLA ni ingresos atribuidos.

## Aceptación y QA antes de implementar

- Confirmar con el contrato de cada fuente los estados elegibles y los campos mínimos; resolver
  qué hacer con tareas sin fecha antes de congelar DTOs prefijados `OperationsQueue*`.
- Comparar respuestas con las vistas fuente para mismo tenant/sucursal/rol. Ningún estado debe
  cambiar al consultar o abrir un enlace; las acciones siguen en sus endpoints originales.
- Probar dos tenants y sucursales, owner/manager/cashier, billing bloqueado y datos vacíos.
  No incluir lealtad, que es exclusiva del dueño, dentro de una consulta compartida con gerente.
- Probar empates, fechas y límites; `has_more` real y ninguna métrica total inventada desde muestras.
- Verificar SQL acotado e índices existentes, pg8000 y workerd; no abrir conexiones privilegiadas.
- UI es-MX accesible y móvil, con identidad/sucursal y cancelación de solicitudes tardías iguales
  a los módulos actuales. Recorrido local navegador/API/Postgres antes de considerar release.

Áreas previstas: nuevo router/servicio de consultas operativas, composición de vistas frontend y
pruebas de integración. Cambios de contratos, rutas, fuente o permisos sólo después de revisión.
No activa notificaciones, campañas, compensaciones ni proveedores. No declara cerrado el E2E.
