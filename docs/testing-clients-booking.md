# Validación local: Clientes, lealtad y reservas

Fecha: 2026-11-12. Evidencia local y de CI del PR #349.
Las reservas públicas inician desactivadas por sucursal. Los negocios de prueba las habilitaron
explícitamente en PostgreSQL desechable; no se modificaron negocios o suscripciones productivos.

## Resultado

| Verificación | Resultado |
| --- | --- |
| Backend de agenda, reservas, lealtad, recompensas, membresías, continuidad y ciclo de cuenta | 130 pruebas aprobadas, sin omitidas |
| Migración 0103 | Upgrade → downgrade vacío → upgrade; RLS/grants privados; rechazo de downgrade con datos |
| Frontend: Bookings, Loyalty, LoyaltyCard, Customers, Appointments, CRM, ServiceCases, Messaging y Layout | 295 pruebas aprobadas |
| Navegador sobre build con APIs interceptadas | 25 escenarios aprobados |
| Navegador con API/PostgreSQL/RLS reales | 8 escenarios aprobados, incluidos recorridos a 390 y 1440 px |
| Build, tipos, lint y contrato API | Aprobados; lint conserva una advertencia previa en WhatsAppSignupPanel |
| Ruff y diff whitespace | Aprobados |

La primera ejecución de CI amplió la revisión al inventario de Workers, la matriz completa de
permisos y las suites de navegador existentes. Se añadieron los modelos/DTO de reservas al
inventario y las siete tablas a la matriz SQL real de dos tenants, incluidos permisos por columna.
Las tres pruebas de esa matriz y las cuatro del límite de snapshot aprobaron localmente.

Se restauró la proporción de la tarjeta pública y se repitieron sus tamaños 320/390/768/1440 px.
La prueba de enlaces exactos ahora espera sólo animaciones visibles: el detalle de actividad
plegado retiene su animación hasta abrirse. Sus comprobaciones de registro, recarga y axe se
conservan; ambas suites completas aprobaron, 22 escenarios adicionales.

La matriz completa de migraciones aprobó 45 pruebas. También aprobaron tres recorridos reales
adicionales de automatización, ciclo de pedido/venta/atención y cola operativa, adaptados a abrir
las secciones plegadas y cerrar la ficha modal mediante Escape antes de continuar por el menú.
Se conservaron todas sus comprobaciones financieras, de inventario y separación entre negocios.

La primera ejecución amplia del navegador real aprobó 7 de 8 escenarios. El restante encontró
un selector ambiguo porque «Cancelada» ahora aparece en calendario y detalle. Se acotó al detalle
y se repitió junto con los dos escenarios públicos: 3 de 3 aprobados. No se modificó ningún
resultado financiero esperado. Las pruebas anteriores se adaptaron a los nombres, diseñador
agregado y apertura explícita de configuración/detalle solicitados.

El backend de navegador corre con `APP_DATABASE_URL` del rol `kova_app`, sin BYPASSRLS. Base de
navegador separada de la de pytest. No se usaron proveedores de mensajes, cobros o producción.

## Historias verificadas

- Color, acumulación y recompensa en vista previa; guardado único y atómico del programa.
- Contraste mínimo 4.5:1 para la escala completa de grises y colores de prueba; logo propio
  del negocio únicamente mediante su endpoint de carga, con representación visual compartida.
- Edición inválida o versión obsoleta no publica parcialmente; reintentos no duplican revisiones.
- Persona/espacio, servicio y disponibilidad configurados por el operador, publicación explícita,
  reserva como invitado y confirmación inmediata sin anticipo.
- Nombre/teléfono coincidentes no vinculan un cliente. Una autorización personal o intercambio
  válido de membresía sí vincula; otro programa, cliente editado o enlace revocado no autorizan.
- Dos reservas públicas concurrentes, y reserva pública contra cita interna, producen un solo
  ganador usando conexiones runtime reales. RLS impide lecturas sin tenant o de otro tenant.
- El equipo vincula explícitamente al cliente; una sola cita ocupa el calendario y continúa en
  Caja. También puede reprogramar un invitado sin crear un cliente.
- Reprogramación, cancelación, control de versiones/plazo y revocación de enlace privado.
- Exportación ICS en UTC, UID estable, escape y plegado de líneas; sin capability en el archivo.
- Horas inexistentes/ambiguas de Tijuana y offsets explícitos. Excepciones por fecha, pausa de
  publicación, origen ajeno y token alterado.
- Regresión de acumulación, ajustes, devolución, canje, recibo, asociación de venta y alta pública
  de tarjeta con backend y datos reales locales.

## QA de interfaz

Inspección visual de capturas finales a 390 y 1440 px: diseñador con tarjeta al lado/en móvil,
calendario y página pública. Se corrigió la compresión de filtros móviles y se acotó la lista de
horarios; al elegir, se muestra el horario y se enfoca la sección de datos.

Los escenarios comprueban ausencia de desplazamiento horizontal. Los ocho escenarios compartidos
de experiencia verifican formularios/teclado/carga y los controles existentes; los escenarios
públicos ejecutan axe sobre el formulario con WCAG 2 A/AA y 2.1 AA, con movimiento reducido.
Errores de conexión no se muestran como vacío ni contienen excepciones crudas. Un conflicto de
horario conserva nombre y teléfono. La confirmación permanece deshabilitada sin conexión y no
se encola una reserva offline. La sesión administrativa offline conserva su bloqueo existente.

## Archivos principales

- Interfaz: `frontend/src/customers/`, `frontend/src/appointments/`, `frontend/src/bookings/`,
  `frontend/src/loyalty/ProgramWizard.tsx`, `frontend/src/loyaltyCard/CardFace.tsx` y pantalla pública.
- Claridad y continuidad: navegación/Layout, mensajes, CRM, seguimiento, conversaciones y casos.
- Backend: `backend/app/bookings/`, `backend/app/loyalty/program.py`, integración con agenda,
  actividad del cliente, plan policy, registro de rutas, RLS y exportación/purga.
- Datos: `backend/alembic/versions/0103_booking_and_loyalty_design.py`, inventario/grants runtime.
- Pruebas: nuevas suites de reservas/programa/migración/componentes; `clients-booking-real.spec.ts`
  y adaptación de las suites existentes al recorrido nuevo.
- Contratos: OpenAPI, specs de reservas/programa/ficha, ADR-032 y estado actual.

## Comandos y límites

Backend: `uv run ruff check .`; pytest acotado a los once archivos de agenda/lealtad/continuidad/
ciclo de cuenta/migración, con PostgreSQL real y reporte JUnit. Frontend: `npm run typecheck`,
`npm run lint`, `npm run check:api-contract`, Vitest de los diez dominios afectados y
`npm run build`. OpenAPI regenerado mediante `scripts/export_openapi.py`.

Playwright sobre build: `business-operations.spec.ts`, `experience-consistency.spec.ts`,
`loyalty-rewards.spec.ts`, `automations-crm.spec.ts`, `engagement.spec.ts`; y con API real
`clients-booking-real.spec.ts`, `business-operations-real.spec.ts`, `connected-owner-real.spec.ts`,
`loyalty-enrollment-real.spec.ts`, `loyalty-reward-real.spec.ts`.

La validación local fue acotada; después se ejecutó la matriz completa de CI descrita abajo.
No se certifican hardware físico, aceptación en el negocio o servicios externos. El alcance no incluye anticipos,
notificaciones automáticas, sincronización con calendarios ni un portal de cuentas de clientes.

## CI y publicación

El [CI completo del PR #349](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/43340459274)
terminó con `success` para `5e822b735aba67cbfa1a71b63693a06e5ffa2230`:

- FastAPI/PostgreSQL: 2,925 pruebas aprobadas y seis subtests; también aprobó la matriz con pg8000.
- Frontend: 1,775 pruebas en 230 archivos.
- Navegador sobre build: 195 + 195 escenarios, sin reintentos.
- API/PostgreSQL/RLS con navegador real: 34 escenarios aprobados.
- Migraciones, inventario/grants, contratos, seguridad de dependencias, parser aislado,
  contenedor reproducible y aceptación del backend nativo: aprobados.

Se fusionó como `e76f997921fe3e46f19914242b221909a2b0a5ad`, con el mismo árbol validado.
El [workflow de publicación](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/43341276814)
terminó con `success`, incluida la aceptación del release, sin recuperación en este intento.

La comprobación independiente del 13 de noviembre a las 01:12 UTC (12 de noviembre, CDMX)
confirmó sitio accesible, `/version.json` con `e76f997921fe`, API y proxy con el SHA completo,
y `/health/db` accesible directamente y por proxy. No se modificaron secretos ni se disparó
un despliegue manual.

QA autenticado en producción:

- Búsqueda de un cliente existente, ficha con actividad/compras y acciones por contexto; foco en
  encabezado y cierre con Escape, sin crear ni cambiar registros.
- Diseñador con logo real y vista previa arriba/en columna lateral a 390/1440 px. La regla
  `5 puntos por cada $100.00` se actualizó en el borrador, que se descartó tras su aviso.
  La automatización del navegador integrado no confirmó el evento del selector nativo de color;
  el cambio de color y su persistencia sí tienen aceptación en Chromium con API real dentro de CI.
- Calendario semanal en escritorio y diario en móvil, filtros sin desplazamiento horizontal,
  secciones de servicios/disponibilidad y estado «Reservas públicas desactivadas».
- Enlace de reserva inválido: respuesta pública mínima y recuperable, sin disponibilidad ni datos,
  también a 390 px. No se habilitó la publicación ni se reservaron citas reales.
- Oportunidades, Conversaciones, Casos de atención y Seguimiento después de la venta cargaron
  sin alertas de error. Conversaciones conservó el canal configurado y los envíos pausados.
- Sin errores de consola de la app durante la revisión. Se restauró el tamaño del navegador y se
  cerraron las pestañas temporales; la pestaña original del usuario se conservó.

El guardado atómico, las reservas concurrentes, la vinculación, reprogramación/cancelación,
ICS, puntos y ventas se aceptaron en las bases desechables de local/CI. Esta revisión productiva
fue de lectura y borradores descartados; no repitió esas escrituras sobre datos reales.
