# Confirmaciones y recordatorios de reservas por WhatsApp

Para dueños y gerentes: confirmar reservas y reducir ausencias sin volver a capturar datos.
El envío con plantillas está integrado; **permanece desactivado mientras Meta revisa la app**.
Esto no acredita aprobación de plantillas, conexión del número real ni entrega productiva.

## Comportamiento

Las citas y reservas públicas confirmadas preparan una confirmación y un recordatorio 24 horas
antes del inicio. A menos de 24 horas sólo preparan confirmación. Las solicitudes de mesa esperan
la confirmación del recurso. Reprogramar sustituye pendientes; cancelar, llegar o terminar los
retira. Materializar una reserva pública conserva su fuente sin duplicar los avisos.

Avisos y cambios de reserva comparten transacción y bloqueo de recurso. Replay y rollback no
dejan duplicados ni preparaciones huérfanas. La migración no genera avisos históricos. Fechas UTC,
texto en la zona de la reserva. Recibos públicos normalizan instantes UTC para conservar replay.
No se incluyen notas privadas ni títulos de servicios en mensajes.

## Activación y envío

Son requisitos independientes: `WHATSAPP_RESERVATION_SENDING_ENABLED=true` en API y jobs,
negocio admitido en el cohorte privado `AUTOMATION_TENANT_IDS`, conexión exacta verificada y
habilitada, sincronización de coexistencia completa y activación del dueño por sucursal con
aceptación de cargos y límite diario de 1–25 intentos (10 por defecto). La bandera de plataforma
es falsa por defecto; aprobar permisos de Meta no cambia configuración ni activa sucursales.

Sólo reservas nuevas o reprogramadas después de activar capturan la versión de autorización.
Previsualizaciones anteriores conservan versión nula y nunca entran al outbox. Desactivar o
cambiar la configuración revoca pendientes de la versión anterior. Confirmaciones con más de
15 minutos de retraso y recordatorios con más de una hora se suprimen; no se recuperan en lote.

El programador privado recorre únicamente negocios admitidos y sucursales con política. Usa
RLS ordinario, procesa hasta 25 avisos por iteración y comparte el outbox existente. Antes de
cada POST revalida reserva, horario, dueño activo/verificado y alcance, acceso comercial,
cliente activo, destinatario exacto original, consentimiento transaccional de sucursal, canal,
pausa/cierre y límites. Una conversación existente no se reasigna ni se despausa automáticamente.
Si no existe se crea con origen `business`, sin simular una entrada ni abrir ventana de 24 horas.
El texto libre conserva la exigencia de ventana de atención real.

Verifica en Meta la plantilla exacta `APPROVED`, categoría `UTILITY`, idioma `es_MX`, formato
posicional y únicamente BODY con el texto esperado. No sigue enlaces de paginación ni redirects;
respuesta y tiempos acotados. Guarda `sending` antes del POST. Timeout/crash deja `uncertain`,
sin reintento automático. HTTP exitoso sólo es `accepted`; recibos firmados del binding y
destinatario exactos acreditan `delivered`/`read`. Fallos o rechazos requieren revisión.

| Plantilla por cuenta | BODY y parámetros |
| --- | --- |
| `kova_reserva_confirmacion_v1` | Hola {{1}}. Tu reserva en {{2}} está confirmada para el {{3}} a las {{4}}. |
| `kova_reserva_recordatorio_v1` | Hola {{1}}. Te recordamos tu reserva en {{2}} para el {{3}} a las {{4}}. |
| `kova_mesa_confirmacion_v1` | Texto de confirmación seguido de « Te esperamos con tu grupo de {{5}} personas.» |
| `kova_mesa_recordatorio_v1` | Texto de recordatorio seguido de « Te esperamos con tu grupo de {{5}} personas.» |

Parámetros: nombre, negocio, fecha, hora y tamaño del grupo. Las definiciones locales no son
plantillas presentadas o aprobadas por Meta. Alta y aceptación operativa en el
[runbook](../../docs/runbooks/whatsapp-reservation-notices.md).

## API, permisos y experiencia

`GET /api/v1/messaging/reservation-notices?limit=50&offset=0`: sesión, acceso comercial y
`settings.manage`, dueño/gerente. Alcance de negocio/sucursal resuelto en servidor; no-store.
`limit` 1–100. Sólo lista previews vigentes que aún no ingresaron al outbox; `scheduled` y
`prepared` no son estados de entrega. `template_status=not_checked` nunca presume aprobación.
Incluye configuración real, disponibilidad y permiso de administración del dueño.

`GET/PUT /api/v1/messaging/reservation-notices/settings`: mismo alcance; escritura sólo del
dueño, con CSRF, versión esperada y límite. Activar sin plataforma/cohorte, aceptación de costos,
conexión o cuatro plantillas aprobadas falla cerrado. Auditoría de actor, versión y configuración,
sin tokens ni destinatarios. No existe endpoint para enviar una preview individual.

Canales → Ver avisos muestra cuerpo, hora local, consentimiento y enlace a la reserva exacta.
El control de activación está bloqueado mientras plataforma no esté disponible. La bandeja
muestra los resultados del outbox, separados de previews. Carga/error/vacío son estados distintos.
Sin internet se retiran previews vigentes y no se escribe; reconectar consulta de nuevo. Cerrar
el panel o cambiar de negocio descarta respuestas tardías. Nada se encola en el dispositivo.
Invitados requieren vínculo explícito a CRM; teléfono importado o reserva no otorgan consentimiento.

## Datos, escenarios y aceptación

Migración aditiva `0107_reservation_notices`: avisos con una fuente exacta entre cita, reserva
pública y mesa; FKs por negocio/sucursal, unicidad por revisión/tipo y enlace único al mensaje.
Política única por negocio/sucursal y ligada al canal verificado al activarse; reconectar otro
binding requiere nueva autorización del dueño. FORCE RLS, sin DELETE runtime; UPDATE limitado a estado/enlace
del aviso y campos de política. Fuente, horario, destinatario y versión capturada son inmutables.
Exportación omite hashes; purga elimina hijos primero. Downgrade vacío reversible; historial
poblado se conserva. Rollback de aplicación no baja la base.

- Dado el bloqueo apagado, una reserva no resuelve credenciales ni produce llamadas de Meta.
- Dada una reserva anterior a la activación, activar no envía sus previews.
- Dada autorización completa y plantilla vigente, se envía la confirmación y después el recordatorio.
- Dada cancelación, cambio de contacto, falta de permiso, pausa o plantilla retirada, no hay POST.
- Dado un timeout después de intentar POST, repetir el programador no repite el mensaje.
- Dado otro negocio/sucursal o rol sin permiso, no se leen ni modifican sus avisos.

Matriz automatizada: API y dominio con PostgreSQL psycopg/pg8000, reprogramación, materialización,
mesas, rollback, política, consentimiento, recibos, límite diario, scheduler y transporte Workers
falso; migraciones y verbos/RLS reales; componentes, tipos, contrato y build. QA manual local a
390/1440 px y teclado. La aceptación final requiere un envío real autorizado y su recibo después
de aprobación de Meta; estas pruebas no la sustituyen.
