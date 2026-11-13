# Solicitudes de mesa sin duración

Estado: implementación y validación local; pendiente de release y configuración del negocio.

## Problema, usuarios y valor

Una cafetería recibe solicitudes de llegada y confirma personalmente la mesa. No conoce de antemano
cuánto tiempo permanecerán sus clientes. Owner y manager pueden configurar y atender estas solicitudes
desde Agenda, con los permisos comerciales actuales. El cliente no necesita cuenta ni anticipo.

## Configuración y recorrido

La publicación por sucursal elige citas con duración (valor anterior) o solicitudes de mesa. El nuevo
modo exige al menos una mesa activa con horarios explícitos; todas las mesas activas comparten zona
horaria. No crea servicios ficticios. Las personas/espacios anteriores conservan su tipo; cada mesa
se crea explícitamente como tal y no admite citas con duración ni servicios de citas.

Se reutilizan horarios semanales y excepciones por fecha. Valores editables: 30 días hacia adelante,
anticipación de dos horas, llegadas cada 15 minutos y gestión pública hasta 24 horas antes.
El horario de cierre excluye nuevas llegadas a esa hora; no representa una salida obligatoria.

Cliente: día → llegada dentro del horario → cantidad de personas, nombre y teléfono → solicitud
pendiente de confirmación. Las opciones son horas para solicitar, sin prometer una mesa disponible.
El equipo elige mesa, revisa sus otras llegadas confirmadas y visitas aún ocupadas, y confirma o rechaza.
Debe contactar al cliente por sus medios: Kova no envía mensajes automáticos.

Dos reservas no pueden confirmar la misma mesa para exactamente la misma llegada. Distintas llegadas
requieren juicio del equipo: no se calcula una disponibilidad por duración inexistente. Registrar
llegada ocupa la mesa; sólo una visita puede estar ocupándola. Al retirarse el cliente, el equipo
libera la mesa y termina la visita. No se libera automáticamente por el reloj.

## Estados e identidad

`requested` → `confirmed` o `declined`; pendientes/confirmadas admiten cancelación.
Confirmadas → `seated` o `no_show`; ocupadas → `completed`. Llegada y ausencia se registran a partir
de la hora acordada. El calendario muestra un punto de llegada sin fin inventado, con enlace exacto
`tableId` a su detalle, historial y acciones. Listado con filtro de estado y paginación.

Identidad automática exclusivamente mediante autorización válida de reserva de la membresía o enlace
personal vigente. Nombre/teléfono coincidentes nunca vinculan ni actualizan clientes. La ficha muestra
la solicitud reconocida. No se crean citas internas, pedidos, ventas ni clientes a partir de solicitudes
de mesa; cobrar se realiza por separado con los permisos y asociación explícita de Caja.

## Gestión y seguridad

El enlace privado lleva audiencia propia `kova-table-manage`, ID, versión revocable y expiración de
400 días después de la llegada. Viaja en fragmento/memoria y cuerpos POST, nunca en consultas ni
storage. Respuestas mínimas no-store/no-referrer/noindex; origen confiable y límites de solicitudes.
La sesión comercial conserva CSRF y RBAC. Scope derivado del enlace validado, tenant/sucursal/RLS.

Dentro del límite público, cancelar o solicitar otra llegada. Reprogramar una reserva confirmada
retira su mesa y vuelve a pendiente; el negocio debe confirmar de nuevo. Se conservan cantidad y
datos declarados. Fuera del límite se indica contactar al negocio. Pausar el enlace impide nuevas
solicitudes/reprogramación, conserva consulta y cancelación dentro del plazo. Revocar impide gestión.
Sólo reservas confirmadas/ocupadas ofrecen ICS con llegada y UID estable, sin DTEND ni credenciales.

## Persistencia y contratos

Migración 0104 aditiva: tipo en personas/espacios, modo de publicación y tablas separadas
`table_reservations`/`table_reservation_history`. FKs tenant/sucursal, RLS forzado, grants mínimos,
índices parciales para llegada confirmada y ocupación, exportación y purga. Downgrade vacío reversible;
rechaza descartar mesas, configuración o solicitudes. El ledger histórico es append-only.

Operaciones con versiones e idempotencia. Orden de bloqueos: configuración, mesas ordenadas, solicitud.
No se adquiere capacidad de cobrar ni de consultar otra reserva con la credencial pública.

API privada: `/api/v1/appointments/table-reservations`, `/{id}`, `/{id}/review`, `/{id}/action`.
Pública: `/api/v1/public/bookings/table-arrivals`, `table-requests`, `table-manage/read`,
`table-manage/arrivals`, `table-manage`. Contexto y calendario existentes incluyen el modo/fuente nuevos.
El modo de citas y sus contratos internos permanecen disponibles.

## Aceptación

- Solicitar no confirma, no ocupa, no cobra y no asocia por teléfono; reintentar no duplica.
- Confirmaciones simultáneas para la misma llegada/mesa tienen un ganador. Dos visitas no ocupan
  simultáneamente la misma mesa; una liberación explícita permite registrar la siguiente.
- Reprogramar exige nueva confirmación; token ajeno, vencido o revocado no autoriza.
- Horarios semanales/excepciones y zonas horarias reutilizan la conversión DST de las citas.
- Sin horario no se publica; una mesa no admite servicios ni citas que inventen duración.
- Tenant/sucursal, RBAC, CSRF, exportación/purga y migraciones se verifican con PostgreSQL real.
- Navegador a 390/1440 px, teclado, accesibilidad, estados de carga/error/desconexión y borrador.

Pruebas: `test_table_reservations.py`, `test_customer_continuity.py`, `test_account_lifecycle.py`,
`test_0104_table_reservations.py`, `TableReservations.test.tsx`, `table-reservations-real.spec.ts`.

Sin conexión se conserva el formulario en memoria y no se confirma ni encola la solicitud. Errores
muestran reintento separado del estado vacío; conflictos conservan los datos y permiten consultar el
estado vigente. Las acciones del equipo generan auditoría con actor, acción y versión, sin contacto
ni credenciales; las públicas conservan origen público en el historial.

```gherkin
Escenario: Una solicitud no es una confirmación
  Dado que el negocio publicó mesas con horarios reales
  Cuando un invitado solicita una llegada con nombre y teléfono
  Entonces queda pendiente de confirmación sin mesa asignada ni hora de salida

Escenario: Dos llegadas no ocupan la misma mesa
  Dadas dos reservas confirmadas de una mesa para distintas llegadas ya transcurridas
  Cuando el equipo registra ambas llegadas simultáneamente
  Entonces sólo una visita ocupa la mesa hasta que el equipo la libera

Escenario: Cambiar una llegada requiere revisión
  Dada una reserva confirmada dentro del plazo de gestión
  Cuando el cliente solicita otra hora mediante su enlace privado
  Entonces la reserva vuelve a pendiente sin mesa asignada y conserva su historial
```
