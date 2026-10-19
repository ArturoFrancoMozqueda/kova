# Atención interna de incidencias

Estado: implementado y validado localmente, 2026-10-19; publicación pendiente de CI y aceptación
del release. El módulo organiza atención humana; no envía mensajes, no aplica descuentos ni
modifica ventas, pagos, stock, puntos o facturas.

Cada caso pertenece a tenant y sucursal y vincula explícitamente un cliente activo. Conserva
título y origen inmutables: venta y/o pedido opcionales. La venta debe ser del cliente y de la
sucursal. Un pedido sólo puede vincularse si una cotización aceptada o una venta ligada demuestra
el cliente; nombres/teléfonos no bastan. Si se eligen ambos orígenes, deben corresponder entre sí.
Se admiten ventas anuladas y pedidos cancelados como evidencia histórica de atención.

Owner/manager crean, asignan, anotan y resuelven. Los responsables deben ser miembros activos,
usuarios activos y tener acceso a la sucursal. No se amplían permisos de empleados ni de caja:
una lista acotada del propio módulo permite elegir responsables sin abrir `/employees` al manager.
Un responsable que después se desactiva permanece identificado y se muestra como no disponible;
no se reasigna silenciosamente el caso.

Los estados activos son `open`, `in_progress` y `reopened`; pueden pasar a en atención, resuelto
o cancelado. Resuelto puede reabrirse, si el cliente sigue activo. Cancelado es terminal. No hay
transición implícita por añadir una nota. Las notas se conservan append-only incluso después
de resolver; cada modificación incrementa versión y agrega evento con autor y snapshots de
estado, asignación y vencimiento. No se editan ni se eliminan notas anteriores.

El vencimiento es una fecha manual opcional con zona horaria. Puede borrarse explícitamente y
puede estar en el pasado: `overdue` se calcula contra el reloj del servidor, únicamente en estados
activos. Resueltos/cancelados no figuran como vencidos. No existe SLA prometido ni alerta externa.

## Contrato privado y permisos

`/api/v1/service-cases` requiere el mismo acceso comercial owner/manager que CRM. GET lista
casos con filtros de estado, cliente, responsable y sólo vencidos; GET `/{id}` devuelve detalle.
POST crea con cliente, título y nota inicial obligatorios. PATCH `/{id}` cambia estado,
responsable y/o fecha; POST `/{id}/notes` agrega una nota. Todas las escrituras requieren
Idempotency-Key; edición/notas requieren `expected_version`. GET `/{id}/events` pagina el
historial en orden de versión descendente. Reintentar una operación cuya respuesta HTTP se perdió
conserva el mismo efecto y respuesta; GET vuelve a calcular los indicadores actuales.

GET `/assignees` pagina miembros/usuarios activos con acceso a la sucursal y sólo expone ID,
correo y rol necesarios para asignar. GET `/references?customer_id=...` ofrece ventas y pedidos
con propiedad de cliente comprobable, con indicadores de paginación independientes. No importa
nombres/teléfonos de un pedido a la identidad de clientes ni muestra referencias ajenas.

`0090_service_cases` agrega `service_cases` y `service_case_events`, con FORCE RLS y FKs tenant/
sucursal/cliente/autor. Runtime conserva SELECT/INSERT en ambas; UPDATE exclusivamente sobre
estado, asignación, vencimiento, versión y fechas de workflow del caso. No hay UPDATE/DELETE de
eventos ni edición de título, cliente u origen. El downgrade rechaza borrar casos/historial.
Exportación y purga incluyen eventos antes de casos y luego sus padres.

Los cambios y el evento correspondiente se guardan en una sola transacción. Un bloqueo de fila
con refresco de estado serializa resoluciones/notas simultáneas. Una versión sólo puede agregar
un evento; el perdedor de una carrera recibe conflicto y debe consultar el caso actualizado.
La auditoría conserva sólo identidad, estado, versión y nombres de campos, nunca notas/títulos.

Este módulo no migra ni elimina las antiguas tareas sencillas de incidencia de `/crm/followups`;
su historial permanece disponible. Los casos nuevos agregan atención estructurada con notas,
asignación, estados y vencimiento. No confundir cerrar un caso con una compensación, reembolso,
comunicación enviada o reseña publicada.

## Evidencia local

Once pruebas API/runtime cubren ciclo completo, cierre/reapertura, reloj de vencimiento,
asignación/desactivación, fuentes de venta y pedido explícitas, referencias y paginación,
privacidad de auditoría, RBAC/billing, aislamiento y carreras reales con `kova_app` para alta
repetida y resolución concurrente. La matriz semántica de migraciones conserva aserciones
exactas de permisos y operaciones con grafos de dos tenants; sólo agrega las tablas nuevas y
sus valores válidos. Pruebas de upgrade poblado/rollback vacío y protección de historial
complementan esa matriz. Las once pruebas también aprobaron con pg8000, usado por Workers.

Con fuente final aprobaron 1,746 pruebas de backend, 25 de migraciones y ocho de workerd.
Frontend: 1,087 unitarias completas y 14 focales; Chromium en 1440/768/390/320 px y recorrido
local real sin mocks con API/Postgres/rol RLS. Compilación, SSR/prerender y escaneo de 118 chunks
JavaScript aprobados. La UI identifica al autor de cada evento y conserva el aviso de responsable
sin acceso incluso si su correo permanecía en caché. Los paths/schemas OpenAPI anteriores
permanecen idénticos; se agregan seis paths.

[Informe de entrega y límites](../../docs/audits/KOVA-SERVICE-CASES-2026-10-19.md).
La validación local no certifica publicación ni comunicación externa.
