# Cola operativa interna: alcance y evidencia local

Fecha: 2026-10-19. Estado: backend y UI implementados, congelados y validados localmente.
CI, publicación y aceptación del release conservan sus gates propios. Este
informe no acredita una sesión autenticada en producción ni completa la automatización E2E.

## Entrega

GET privado `/api/v1/operations/queue` concentra cuatro proyecciones de fuentes reales: casos
activos, oportunidades abiertas con próxima acción, tareas pendientes de seguimiento y
recordatorios pendientes disponibles de citas programadas con versión vigente. Devuelve cuatro
secciones, incluso vacías, y una fecha UTC `generated_at` para interpretar vencimientos.

Cada sección devuelve hasta 20 registros y `has_more` a partir de una consulta de 21 filas. El
máximo son 80 items, sin contar totales ni inferir prioridades, ahorro, ingresos o SLA. Orden por
fecha ascendente, null al final e ID como desempate; null nunca está vencido. No hay parámetros
ni filtro implícito de “hoy”. Recordatorios futuros y versiones obsoletas quedan fuera conforme
a la consulta de la agenda.

Las proyecciones contienen IDs, títulos, nombre del cliente, estado, versión, fecha y clave de
ruta. Excluyen notas, próxima acción completa, contactos, consentimientos e importes. La UI usa
claves enumeradas para abrir vistas fuente conocidas; no recibe URLs ni un contrato de apertura
automática del registro individual. Acciones y versiones permanecen en los módulos originales.

## Invariantes

- `require_crm` conserva sesión, permiso de dueño/gerente, billing y sucursal verificada. No admite
  seleccionar tenant/sucursal mediante parámetros ni incluye lealtad, exclusiva del dueño.
- Usa la conexión runtime con RLS y cuatro SELECT proyectados, con tenant/sucursal explícitos.
  Los joins validan tenant del cliente y tenant/sucursal/versión de la cita correspondiente.
- No agrega tablas, migraciones, grants, escrituras, eventos, worker, notificaciones ni proveedores.
  Consultar no procesa tareas ni modifica estados, puntos, ventas, inventario o pagos.
- Los controles/auditorías existentes de auth y billing se mantienen; no hay nueva auditoría de
  dominio por consultar. La respuesta conserva `private, no-store, max-age=0`.
- No combina entidades por similitud. Un caso, oportunidad y tarea siguen siendo registros
  independientes sin un vínculo explícito.

## Validación local del backend

| Comprobación | Resultado y alcance |
|---|---|
| Backend completo antes del ajuste de imports opcionales | 1,755 pruebas, cero errores/fallos/omitidas; 135.8 s. |
| API con psycopg | 8/8 aprobadas. |
| API con pg8000 | 8/8 aprobadas. |
| Runtime workerd | 8/8 aprobadas; incluye cola antes/después de resolver un caso y otro tenant vacío. |
| OpenAPI | Sólo agrega `/api/v1/operations/queue` y DTOs `OperationsQueue*`; paths/schemas anteriores estructuralmente iguales. |
| Estático | Ruff y diff-check aprobados para el backend entregado. |

Las pruebas focales cubren vacíos, campos reales sin contactos/notas/importes, estados/versiones,
recordatorios futuros/obsoletos, límite real con `has_more`, empates, fechas null/iguales al reloj,
dos negocios y sucursales, dueño/gerente/cajero, billing y falta de sesión. La prueba RLS ejecuta
con rol `kova_app` frente a datos existentes de ambos tenants. La captura de SQL verifica cuatro
SELECT acotados con LIMIT 21; la consulta autorizada no crea auditorías de dominio, claves de
idempotencia ni eventos de casos.

La evidencia procede de datos sintéticos locales aislados. No se usaron credenciales de cuentas
del negocio ni se realizaron mensajes o transacciones reales. Estos resultados no sustituyen
los checks de CI, publicación y aceptación del release.

## Validación local del frontend

- Suite completa: 1,102 pruebas aprobadas en 176 archivos.
- 15 pruebas focales aprobadas; TypeScript y ESLint aprobados.
- Cuatro recorridos Chromium a 320, 390, 768 y 1440 px con axe A/AA, control de overflow y errores
  JavaScript. Capturas de 320/1440 inspeccionadas sin hallazgos.
- Un recorrido real navegador/API/Postgres con rol runtime y RLS: las cuatro fuentes se muestran;
  abrir atención, resolver en su módulo original y volver a consultar hace desaparecer el caso.
- Build SSR/prerender aprobado y escaneo de 119 JS sin patrones prohibidos.
- Revisión independiente sin hallazgos reproducibles: remount por identidad/sucursal/rol,
  cancelación y descarte de respuestas tardías, descarte offline/error, enlaces permitidos,
  zona empresarial validada y fallback UTC explícito, sin totales o vencimientos inferidos.

No se realizaron pruebas ni escrituras en producción. Estos resultados locales no acreditan la
publicación de casos ni cola. El release de infraestructura aceptado a las 16:42:01 UTC corresponde
al commit `527c75d46f35891a56b5f0184196ced0be1b1263` (PR #216), con verificación pública de SHA;
publica los cortes previos de agenda/lealtad, pero todavía no incluye atención postventa ni cola.
Ambos módulos se preparan juntos en PR #217; su publicación/aceptación sigue pendiente.

## Fuentes y pendientes

La QA pública del release previo detectó coste de arranque frío: una sesión y su renovación
secuencial podían superar 30 segundos; peticiones posteriores bajaron a unos 0.1 segundos.
El corte final difiere `openpyxl` hasta procesar XLSX y `boto3`/Config hasta seleccionar S3 nativo.
Conserva el guard ZIP, excepciones, R2, dependencias y autenticación. Veintiocho pruebas focales
aprobaron; en workerd aprobaron API (8), compatibilidad (2) y tareas aisladas (1). La primera
respuesta local observada pasó de 2.8 a 2.3 segundos; es una medición local, no un SLA ni evidencia
de mejora productiva. La QA posterior a publicación registra el resultado público.

Contrato y aceptación: [plan actualizado](../plans/PLAN-COLA-OPERATIVA-INTERNA.md) y
[spec](../../specs/operations_queue/internal_queue.md). Implementación:
`backend/app/operations_queue/`, registro de router en `backend/app/main.py`, pruebas en
`backend/app/tests/test_operations_queue.py` y prueba runtime en
`deploy/cloudflare-backend/runtime.test.mjs`.

La UI conserva cancelación/descarte de respuestas al cambiar identidad/sucursal, rutas
permitidas, estados vacíos y copy es-MX sin totales inferidos. Publicar
no activa proveedores ni resuelve las dependencias externas de WhatsApp/Meta, correo, PSP o PAC.
