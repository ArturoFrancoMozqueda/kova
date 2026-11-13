# Agenda visual y reservas públicas

Estado: citas publicadas en PR #349; la activación permanece a elección de cada sucursal.
El modo opcional de [solicitudes de mesa](table-requests.md) conserva los contratos de citas.

## Problema, usuarios y valor

El dueño necesita organizar servicios, personas o espacios y horarios sin mezclar configuración
con atención diaria. El cliente puede reservar desde un calendario público sin cuenta ni anticipo.
Owner y manager conservan el acceso comercial y RBAC de Agenda; Caja mantiene sus propios permisos. Ver, cancelar y reprogramar reservas ya recibidas y el calendario también están disponibles para cashier y staff (`appointments.operate`, detalle en `internal-agenda.md`); la configuración sigue siendo owner/manager.

## Operación

La agenda muestra calendario semanal en escritorio, diario en móvil y alternativa de lista.
El calendario consulta citas internas y reservas públicas; una reserva materializada aparece una vez.
Los enlaces exactos usan `appointmentId` o `bookingId`. Recursos significa personas o espacios en
la interfaz; cada uno admite una cita a la vez. La consulta histórica conserva fechas y paginación.
Si el calendario excede 1000 resultados por fuente, avisa y pide acotar el período; no afirma completitud.

Configuración separada: servicios con duración de 5–1440 minutos y personas/espacios habilitados;
horarios semanales con varios intervalos por día; excepciones por fecha que reemplazan el horario.
No existen horarios publicados de muestra. La zona de cada persona o espacio continúa inmutable.

## Publicación y reserva

El enlace por sucursal inicia apagado. Configuración inicial: 30 días hacia adelante, anticipación
mínima de 120 minutos, inicios cada 15 minutos y gestión hasta 24 horas antes; el negocio los edita.
La reserva ocupa una sola persona o espacio. El servicio no fija precios ni crea productos POS.

Cliente: servicio → persona o espacio → día → horario → nombre y teléfono → confirmación.
El servidor calcula el fin, comprueba servicio/asignación/disponibilidad actuales y descuenta
citas internas y reservas públicas. Bloqueo transaccional por tenant/sucursal/recurso, idéntico al
interno, impide cruces. Revalidar al enviar; conflicto conserva el formulario y vuelve a consultar.
No existe retención de horario durante el llenado. Cada confirmación usa UUID de operación;
el mismo cuerpo y clave recuperan la misma reserva, nunca duplican clientes ni ocupación.

Confirmación en pantalla, archivo ICS sin credenciales y enlace privado de gestión. No implica
pago, correo o WhatsApp enviados, sincronización externa ni consentimiento de marketing.

## Identidad y gestión

Nombre y teléfono públicos son datos declarados, no credenciales. Nunca buscan, actualizan o unen
clientes anteriores. Sin identidad autorizada se confirma como invitado. El equipo puede seleccionar
cliente existente o crear una ficha, y confirmar la asociación antes de registrar atención/cobro.

Un enlace personal emitido por el equipo usa audiencia `kova-booking-customer`, revisión del cliente,
sucursal, publicación vigente y expiración de 30 días. Desde una membresía de lealtad se intercambia
su cookie HttpOnly, en su ruta original, por una autorización de reserva de 15 minutos de esa audiencia.
Se revalida miembro/cliente/autorizante. El QR de socio y las capabilities de lectura no autentican
reservas. Las credenciales permanecen en memoria/fragmento, nunca en storage ni consultas de URL.

Las reservas viven en `public_bookings`. Continuar con cliente genera una cita interna una sola vez,
atribuida al miembro que confirma la acción; preserva el registro público y libera su doble cómputo.
La ficha del cliente incluye reservas reconocidas todavía no materializadas. Los cambios públicos
se registran como tales; no se atribuyen al dueño ni sobrescriben el historial del equipo.

El enlace de gestión usa audiencia exclusiva `kova-booking-manage`, ID y revisión revocable;
expira a los 400 días de la reserva. Permite únicamente leer esa cita, consultar horarios y cancelar
o reprogramar antes del límite. Versiones incluyen cambios de la cita interna vinculada. El plazo
se revalida en servidor; el equipo puede cancelar invitados y revocar enlaces. Pausar publicación
impide nuevas reservas/reprogramaciones públicas y conserva consulta/cancelación vigentes.
La reprogramación conserva la duración reservada, aunque después se edite el servicio.

## Datos, API y seguridad

Migración aditiva 0103: `booking_pages`, `booking_services`, `booking_service_resources`,
`booking_availability`, `public_bookings`, `booking_history`. Tenant/sucursal, FKs compuestas,
RLS forzado, grants acotados y exportación/purga explícitas. Historial y snapshots de contacto
inmutables. Downgrade vacío reversible; rechaza descartar registros. Citas internas no cambian DTO.

Privadas bajo `/api/v1/appointments`: `booking-page`, `services`, `availability/{id}`, `calendar`,
`booking-invites`, `bookings/{id}` y acciones `customer`, `reschedule`, `cancel`, `revoke`. Escrituras con sesión,
CSRF, permisos y claves de idempotencia salvo emisión de un enlace personal de lectura/autorización.
`POST booking-preview` (mismos permisos que la configuración) devuelve el contexto público y los horarios
que vería un cliente con ajustes o disponibilidad sin guardar, aplicando las reglas de `slots` y las citas ya
agendadas. Es de solo lectura: no guarda, no publica y no crea reservas.
Públicas bajo `/api/v1/public/bookings`: `context`, `slots`, POST raíz, `manage/read`,
`manage/slots`, `manage`. Intercambio de membresía en
`/api/v1/public/loyalty/membership/booking-grant`, con su cookie original y origen confiable.

Scope derivado de firma verificada con runtime/RLS, sin conexión privilegiada ni tenant del navegador.
Mutaciones/lecturas con credencial por POST exigen origen confiable; CSRF comercial sigue aplicando
si viajan cookies del comercio. Respuestas públicas no-store/no-referrer/noindex, sin contacto,
historial comercial ni credenciales de otras reservas. Rate limit por IP. No precargar la PWA
comercial en las rutas públicas. Sin conexión no se confirma ni se encola una reserva.

## Aceptación y escenarios

- Dado horario publicado, al reservar un intervalo libre, confirmar una sola reserva sin cobro.
- Dadas dos confirmaciones concurrentes, una gana y otra obtiene conflicto; igual contra cita interna.
- Dado reintento con misma clave/cuerpo, recuperar el resultado sin segunda ocupación.
- Dado teléfono igual a un cliente existente, confirmar invitado; una autorización válida sí vincula.
- Dada asociación del equipo, conservar origen y mostrar una sola cita en calendario.
- Dado enlace revocado, ajeno, alterado o vencido, impedir gestión sin divulgar información.
- Dado cambio fuera de plazo, pedir contacto con el negocio. Con plazo válido, reprogramar/cancelar
  también la cita materializada, conservar historial y suprimir/regenerar recordatorios internos.
- Dado horario inexistente por DST, no ofrecerlo; un horario ambiguo identifica cada offset real.
- Validar teclado, 390/1440 px, carga, vacío, error, desconexión, identidad/sucursal, RLS y migración.

Pruebas: `test_public_bookings.py`, `test_appointments.py`, `test_customer_continuity.py`, migración
0103 y `clients-booking-real.spec.ts`. El navegador usa API y PostgreSQL/RLS locales reales.
