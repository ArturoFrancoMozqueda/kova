# ADR-032: reservas públicas separadas y edición atómica de lealtad

Estado: implementado localmente; pendiente de publicación y aceptación productiva.
Fecha: 2026-11-12.

## Contexto

La agenda interna exige cliente conocido y actor miembro. La reserva pública debe confirmar un
horario con datos declarados sin inferir identidad por teléfono ni atribuir acciones al dueño.
La configuración de lealtad distribuye puntos, recompensa y altas entre escrituras independientes.

## Decisión

Persistir reservas públicas en un dominio separado, con historial propio y cliente opcional.
Compartir exactamente el bloqueo por tenant/sucursal/persona o espacio y la comprobación de cruces
con citas internas. La disponibilidad resta ambas fuentes. Un calendario privado las reúne.

Cuando el equipo confirma el cliente y continúa la atención, crear la cita interna y vincularla
atómicamente; desde ese momento solo ella cuenta como ocupación. El registro público conserva
contacto declarado, origen y cambios desde su capability. No modificar contratos internos para
aceptar invitados ni reutilizar un miembro como actor público.

Identidad automática solo mediante autorización de reserva de audiencia propia: enlace personal
revocable por publicación/revisión del cliente o intercambio de una membresía HttpOnly válida.
Ningún dato de contacto, QR de socio o capability de lectura acredita identidad. Gestión pública
por credencial revocable específica; no se crean pagos, mensajes externos o acceso al historial.

Agregar guardado agregado de lealtad bajo su bloqueo existente, con versiones de todos sus bloques,
revisiones append-only e idempotencia. Apariencia separada por sucursal y presentación compartida.
Preservar endpoints anteriores, ledger y cálculo Decimal.

## Consecuencias

Migración aditiva con RLS forzado, grants acotados y grafo explícito de exportación/purga.
Publicación por sucursal comienza apagada. Hace falta configurar disponibilidad real; no se
preconfiguran horas laborales ni se supone integración con calendarios. Las validaciones locales
no autorizan publicación ni acreditan aceptación productiva.

Contratos: [reservas](../../specs/appointments/public-booking.md) y
[programa visual](../../specs/loyalty/program-designer.md).
