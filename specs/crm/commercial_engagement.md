# Captación y seguimiento internos

Estado: implementación local, 2026-10-18. La integración externa y el envío de mensajes permanecen separados.

## Catálogo → solicitud → oportunidad

`POST /api/v1/public/catalog/{token}/requests` recibe `submission_id` UUID, nombre, contacto,
mensaje y hasta veinte productos actualmente publicados y activos. Verifica origen del frontend,
rate limit compartido (diez por minuto), firma y versión revocable, negocio activo y billing.
No exige sesión y no utiliza cookies como autorización del catálogo. El frontend envía sin cookies.
La respuesta pública contiene exclusivamente `receipt_id` y `status=received`; el replay nunca
revela asignación, cliente, notas ni oportunidad posteriores. La referencia se deduplica por
catálogo y tenant; reutilizarla con otro contenido produce conflicto.

Los textos externos son datos no confiables: no ejecutan herramientas ni instrucciones y no
entran a auditoría. No se crean clientes por similitud de nombre/teléfono, consentimientos,
pedidos, reservas, ventas ni pagos.

`GET /api/v1/crm/requests` devuelve la cola privada por sucursal, paginada y owner/manager.
`POST /api/v1/crm/requests/{id}/resolve` requiere Idempotency-Key y expected_version.
Una solicitud nueva puede descartarse o convertirse seleccionando explícitamente un cliente
activo del negocio. Conversión crea una oportunidad de importe estimado cero y próxima acción
para revisar/cotizar, y conserva `customer_id` y `opportunity_id` en el registro de origen.
El importe cero es un estimado comercial desconocido, no un precio/cobro. La estimación se edita
mediante el contrato CRM existente; precios de una futura cotización vienen del catálogo real.

## Venta → tareas de postventa

`GET /api/v1/crm/followups` expone política y tareas privadas de la sucursal.
`PUT /api/v1/crm/followups/policy` comienza desactivada y requiere versión e idempotencia.
Habilitar registra el actor y el comienzo de vigencia. Genera únicamente tareas para ventas
completadas con cliente activo registradas por el servidor desde esa habilitación; no toma
ventas históricas ni deduce clientes de teléfonos. Rehabilitar comienza una vigencia nueva.

`POST /api/v1/crm/followups/process` y el scheduler privado llaman al mismo servicio acotado.
Revalida negocio activo, acceso comercial y miembro owner/manager activo con acceso a la
sucursal. Bloqueo de política serializa procesamiento/edición. Cada pasada examina hasta cien
ventas sin efectos completos, ordenadas por fecha/ID, y crea como máximo doscientas tareas.
Las anti-joins y la restricción venta/tipo impiden duplicados y permiten avanzar por lotes.
No considera ventas anuladas o con devoluciones. Fechas de vencimiento son fecha de registro
más demora configurada: reseña de 1 a 30 días, recompra de 2 a 365 días.

La solicitud de reseña es neutral y se genera independientemente de incidencias/satisfacción.
Una tarea no representa mensaje enviado, autorización marketing, resultado de venta ni reseña
publicada. Completar confirma trabajo humano interno. Ningún destino externo o enlace de
reseñas se activa aquí. Desactivar política descarta los pendientes automáticos y conserva
incidentes e historial. Las tareas existentes no se recalculan al cambiar demoras.

`POST /api/v1/crm/followups` registra una incidencia interna con cliente, responsable opcional,
fecha y nota; una venta vinculada debe ser completada, de ese cliente y de la sucursal.
Hay como máximo una incidencia vinculada por venta; las incidencias sin venta pueden ser varias.
`PATCH /api/v1/crm/followups/{id}` asigna/reprograma/anota o resuelve un pendiente con versión e
idempotencia. Los cerrados conservan su historial y no se reabren silenciosamente.

## Datos y límites

Migración aditiva `0086_commercial_engagement`: `crm_catalog_requests`,
`crm_followup_policies`, `crm_followup_tasks`. FORCE RLS por tenant, relaciones de propiedad,
ningún grant a PUBLIC/anon/authenticated/service_role. Runtime SELECT/INSERT y UPDATE sólo
sobre campos de workflow; texto público y vínculos de venta/cliente de tareas son inmutables.
Los downgrades rechazan borrar historial. Exportación y purga deben incluir los tres dominios.

Las tareas son internas y requieren canal/consentimiento/políticas de frecuencia válidos antes
de cualquier comunicación posterior. Este módulo no publica campañas, mide entregas externas,
atribuye ingresos a mensajes ni estima margen sin costos. El scheduler mantiene admisión de
cohorte explícita. Validación local no acredita carga, runtime workerd ni aceptación productiva.
