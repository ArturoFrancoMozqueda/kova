# ADR-033: solicitudes de llegada a mesas con confirmación humana

Estado: implementado localmente; pendiente de publicación.
Fecha: 2026-11-12.

## Contexto

Sweet Home quiere recibir solicitudes para cinco mesas sin definir duración. El motor de citas
de ADR-032 requiere intervalos para garantizar que no existan cruces; no puede afirmar disponibilidad
de una mesa sin conocer su salida. El usuario eligió que el equipo revise y confirme cada solicitud.

## Decisión

Agregar un modo optativo por sucursal y un tipo de recurso inmutable para mesas. Mantener intacto
el motor de citas con duración, excluyendo las mesas de sus servicios y citas. Los horarios de mesas
sólo definen horas de solicitud, nunca una promesa de disponibilidad automática.

Persistir llegada, cantidad, estado e historial en tablas propias, sin `ends_at`. El equipo revisa
reservas y ocupación, asigna mesa y confirma. El bloqueo de configuración y mesa serializa escrituras;
índices parciales impiden dos confirmaciones para la misma llegada y dos ocupaciones reales simultáneas.
Llegadas distintas en la misma mesa requieren criterio del negocio. La salida se registra al liberar.

Gestión mediante capability de audiencia exclusiva; cambiar una llegada devuelve la reserva a pendiente
y retira la asignación anterior. Identidad confiable reutiliza autorizaciones de reserva, nunca teléfono.
Se conservan CSRF comercial, RBAC, RLS y scope de sucursal. No crea ventas ni comunica por otros canales.

## Consecuencias

No se fabrica duración ni se relajan las garantías de citas. La mesa exige trabajo explícito del equipo:
confirmar, contactar, registrar llegada y liberar. El cliente ve solicitud pendiente hasta la decisión.
El calendario admite eventos de llegada sin fin; el ICS también. Migración aditiva, exportación y purga
con pruebas PostgreSQL. La publicación sigue apagada por defecto y requiere horarios reales.

Contrato: [solicitudes de mesa](../../specs/appointments/table-requests.md).
