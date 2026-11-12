# Validación local: Clientes, lealtad y reservas

Fecha: 2026-11-12. Implementación local; sin commit, push, merge, workflow ni despliegue.
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

No se ejecutó toda la matriz del repositorio ni se certifica publicación, hardware físico,
aceptación en el negocio o servicios externos. El alcance autorizado no incluye anticipos,
notificaciones automáticas, sincronización con calendarios ni un portal de cuentas de clientes.
