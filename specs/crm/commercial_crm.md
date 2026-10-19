# CRM y consentimiento de contacto

## Resultado

Dueño y gerente registran oportunidades de clientes existentes, asignan responsables y mantienen
su próxima acción. El pipeline es comercial: marcar una oportunidad como ganada no crea una venta,
un cobro, una reserva de inventario ni ingreso en reportes.

La implementación conecta clientes, seguimiento y permisos de comunicación. WhatsApp y correo
permanecen `not_connected`; registrar autorización no envía mensajes ni acredita entrega.

## Datos y autorización

- `crm_opportunities` pertenece a tenant y sucursal; referencia cliente y responsable del mismo tenant.
- Etapas `new`, `contacted`, `proposal`, `won`, `lost`; los cambios conservan versión y auditoría.
- Título, próxima acción y nota interna se muestran como texto; sin HTML ni instrucciones ejecutables.
- Importe estimado MXN decimal, no negativo, máximo dos decimales. No representa ingreso cobrado.
- Vencimiento acepta timestamp con zona horaria; no inventa la zona del navegador.
- El responsable debe ser un miembro activo y tener acceso a la sucursal elegida.
- `customer_contact_consents` separa sucursal, cliente, canal (`whatsapp`, `email`) y finalidad
  (`transactional`, `marketing`). Un teléfono o email registrado nunca implica consentimiento.
- Ambas tablas tienen RLS ENABLE/FORCE, políticas `USING`/`WITH CHECK` y FK compuestas por tenant.
- API requiere sesión de Kova, acceso comercial y `settings.manage`, restringida a owner/manager.
  No se exponen credenciales ni acceso directo a PostgreSQL en el frontend.

## Contrato

- `GET /api/v1/crm?limit=100&offset=0&customer_id=<uuid>`: oportunidades y consentimientos de la
  sucursal. Límite máximo 200; `customer_id` opcional valida pertenencia. Devuelve flags separados
  `opportunities_has_more`/`consents_has_more`. Seleccionar un cliente y offset cero recupera sus
  hasta cuatro combinaciones de consentimiento sin depender de la página del listado general.
- `POST /api/v1/crm/opportunities`: cliente, título, valor estimado y datos opcionales de seguimiento.
- `PATCH /api/v1/crm/opportunities/{id}`: `expected_version` y campos del seguimiento, nunca tenant,
  sucursal ni cliente. Una versión obsoleta devuelve 409 sin sobrescribir el registro.
- `PUT /api/v1/crm/consents`: cliente/canal/finalidad/enabled/expected_version. Versión cero indica
  registro inicial; una combinación existente requiere su versión actual.
- Toda mutación exige `Idempotency-Key`: repetir la misma solicitud reproduce su respuesta sin
  efecto doble; reutilizar clave con otro cuerpo se rechaza. El ledger existente separa sucursales.

## Consentimiento y retirada

El operador registra un consentimiento obtenido explícitamente fuera del sistema y se guarda su
identidad bajo `owner_recorded`. El producto no infiere aceptación ni presenta ese registro como
validación independiente del consentimiento. El canal requiere contacto y cliente activos para
habilitar; retirar sigue siendo posible aunque el cliente esté inactivo o no tenga dirección.

La autorización se liga al hash de la dirección seleccionada. Cambiar teléfono/email invalida su
uso hasta reconfirmación; no transfiere silenciosamente permiso a otra persona. La respuesta
incluye `contact_current` para mostrar esa necesidad, sin exponer el hash. La auditoría sólo
registra identificadores, versión, canal, finalidad y estado; nunca nombres, direcciones o notas.

El helper `contact_allowed` devuelve la autorización actual por combinación y dirección. Cualquier
futuro dispatcher debe consultarlo inmediatamente antes del envío, además de verificar permisos,
billing, conexión, regla habilitada, límites y políticas del proveedor. El helper no autoriza por
sí mismo una comunicación y esta entrega no tiene cola de envíos externos que pueda despachar.

## QA y límites

Pruebas de API con PostgreSQL verifican replay, conflicto de versión, nulidad, importes, zona horaria,
roles, billing, tenant/sucursal, asignación, filtro/paginación, retirada y cambio de contacto. Pruebas
con rol `kova_app` acreditan RLS y rechazo de reasignación de tenant.

Revisión manual esperada: crear cliente, crear oportunidad, cambiar etapa, guardar/revocar permiso,
cambiar teléfono y comprobar el estado de reconfirmación; cambiar sucursal y comprobar aislamiento.
No se acredita disponibilidad en producción ni envío/entrega a WhatsApp o correo.

No incluye firma, cotizador por partidas, agenda, campañas, bandeja conversacional, cobro PSP,
crédito ni atribución causal de ventas. Esos dominios conservan sus gates y contratos separados.
