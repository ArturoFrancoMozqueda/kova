# Bandeja privada y outbox de comunicación

Actualización 2026-10-23: el [piloto asistido](../../docs/runbooks/whatsapp-assisted-pilot.md)
agrega ingreso HTTPS firmado y envío humano explícito, desactivados por defecto. La descripción
del 18 de octubre que sigue documenta el corte anterior; ya no describe toda la superficie HTTP.
El alcance automático de plantillas, campañas y postventa externa continúa pendiente.

## Contrato adicional del piloto asistido

- `GET /api/v1/messaging/connection`: estado real de configuración de la sucursal, sin tokens ni IDs Meta.
- `GET /readiness`: conserva la guía y agrega estados `connected`/`configuration_error` según
  registro de plataforma y binding DB. Configurado no afirma salud actual de Meta ni entrega.
- `GET /conversations`: agrega `send_enabled` y amplía `channel_status` con esos estados;
  la conversación expone `contact_phone` sólo a dueño/gerente autorizados para su sucursal.
- `GET /conversations/{id}/messages?latest=true`: página reciente en orden cronológico;
  offset sigue contando desde lo más reciente. Sin ese parámetro conserva el contrato anterior.
- `POST /conversations/{id}/catalog-draft`: `expected_version`, Idempotency-Key; genera el
  enlace desde el catálogo publicado de la sucursal, sin aceptar un destino del navegador.
- `POST /messages/{id}/send`: `expected_version`, Idempotency-Key y confirmación humana.
  Debe ser el autor del borrador y continuar asignado; no requiere quitar la pausa humana.
  Revalida cuenta, sucursal, rol, billing, cliente exacto, consentimiento, ventana y fuente.
  Envía sólo una vez; replay devuelve el estado durable actual, incluido `uncertain`.
- `GET/POST /webhooks/whatsapp`: callback de Meta, límite de cuerpo, rate limit, challenge
  y firma raw; el POST es la única excepción CSRF nueva y no usa cookies como autorización.

No agrega migraciones ni grants. Runtime no puede provisionar, habilitar ni reasignar bindings.
Registro/credenciales viven en Secrets de plataforma; aprovisionamiento asistido verifica el
número ante Meta antes de guardar usando la conexión de operador. El primer tenant todavía
requiere configurar Meta y aceptar entrega real antes de declarar el canal disponible.

Entrega local, 2026-10-18. Complementa la [preparación de WhatsApp](whatsapp-cloud-preparation.md).
No crea cuentas ni conexiones externas y no publica un webhook o dispatcher HTTP.

## Comportamiento

Owner/manager con acceso comercial y sucursal vigente puede abrir una conversación manual
para un cliente activo, asignarla a un miembro activo autorizado, cerrarla/reabrirla y pausar
la automatización para atención humana. Al abrir manualmente, comienza pausada. La bandeja
conserva borradores de texto privado con finalidad explícita, aunque no exista cuenta del canal.
Un borrador jamás se presenta como enviado. El contenido se conserva como snapshot: para
corregirlo, cancelar y crear otro. Las escrituras requieren Idempotency-Key y versiones.

`GET /api/v1/messaging/conversations` y `GET /conversations/{id}/messages` devuelven paginación
acotada. `POST /conversations`, `PATCH /conversations/{id}` y `POST /conversations/{id}/messages`
operan sólo en el negocio/sucursal autenticados. `POST /messages/{id}/transition` autoriza la cola
o cancela un draft/queued. Nunca permite afirmar entrega manualmente ni reintentar inciertos.

La preparación pública de conexión sigue mostrando `not_connected`: no existe aún onboarding
operativo para provisionar cuentas verificadas. Un registro de vinculación no contiene secretos;
se establece exclusivamente mediante un futuro proceso de plataforma verificado, fuera de los
permisos runtime. El servicio interno exige scope autenticado/configurado antes de interpretar
cuentas del webhook; firma raw, WABA y Phone Number ID deben coincidir. Los eventos firmados
se guardan por clave única, con bloqueo de decisiones por tenant/sucursal.

Un mensaje entrante crea una conversación pausada sin asociar automáticamente un cliente.
El operador debe vincular explícitamente el contacto exacto a un cliente activo; no se fusionan
números similares ni se ejecutan instrucciones del texto. Mensajes multimedia no se descargan.
Recepción auténtica actualiza la ventana desde la fecha del proveedor; replay no la extiende.
Se rechazan fechas futuras mayores a cinco minutos. El caller hace commit/rollback del lote.

## Envío interno preparado y desactivado

`dispatch_one(..., provider=None, enabled=False)` no hace nada por defecto. Un futuro worker
conector debe resolver por servidor el proveedor de una vinculación exclusiva y exponer su
`binding_id`; un adaptador de otra cuenta se rechaza. Ni la API ni el scheduler actual lo activan.
Sólo se permite texto transaccional dentro de 24 horas de un inbound auténtico, con contacto
vigente, consentimiento, acceso comercial, actor autorizado y atención humana despejada.
Marketing requiere plantillas aprobadas y queda bloqueado en este corte.

Al autorizar se fija el fingerprint del contacto; al ejecutar se revalidan las condiciones.
Cambiar contacto, revocar consentimiento o acceso, cerrar/pausar conversación o vencer la ventana
suprime el envío. Cierre, handoff y nueva vinculación suprimen queued inmediatamente.
Una cancelación sólo es segura antes de I/O. El worker confirma `sending` antes de llamar al
proveedor; una caída/timeout termina visible como `uncertain`, sin reencolado. Se conserva un
intervalo de concurrencia inevitable entre la revalidación y el efecto externo; una revocación
no puede retirar una solicitud que el proveedor ya recibió.

Aceptado por API no es entregado. Los recibos de sent/delivered/read/failed son independientes,
firmados, deduplicados y sólo corresponden al message ID de esa cuenta y destinatario exacto.
Un recibo anterior a la respuesta se conserva y reconcilia al registrar aceptación. Recibos
fuera de orden no degradan delivered/read; una falla no borra evidencia de entrega. Si se pierde
la respuesta sin message ID, el estado incierto requiere investigación humana/proveedor.

## Datos y seguridad

Migración aditiva `0085_messaging_inbox`: cuatro tablas privadas con FORCE RLS y FKs compuestas.
Runtime sólo puede leer bindings. Ledger de eventos es append-only; contenido/dirección/actor
del mensaje no reciben UPDATE. Sólo estados y metadatos de entrega son mutables. Cuerpo, teléfono,
IDs del proveedor y secretos no se añaden a auditoría. Exportación/purga se integran en su inventario
central. La API requiere cookies/CSRF y conserva gating owner/manager/billing.

## Evidencia y pendientes

Pruebas locales de API, scopes, borradores, replay, firma y dedupe, handoff, revocación, binding,
ventana, incertidumbre y recibos fuera de orden; aislamiento SQL/grants con rol real sin bypass.
Se prueba con proveedor simulado explícito, nunca envío real.

Falta onboarding/verificación de cuentas y credenciales, ingreso HTTPS productivo y sus límites,
plantillas aprobadas/ventanas y tarifas vigentes, integración del dispatcher con transporte Workers,
aceptación de entrega real y operación/reconciliación ante proveedor. Estos límites requieren trabajo
y aceptación adicionales, no sólo colocar claves.

## Puente explícito desde automatizaciones

`POST /api/v1/messaging/drafts/from-automation` recibe `automation_run_id`,
`expected_run_version` y `conversation_id`; no acepta texto libre ni un destinatario externo.
El operador selecciona ambos registros. Sólo se admiten tareas pendientes `order_ready` y
`order_fulfilled` con regla vigente, actor autorizado y versión/estado del pedido aún válidos.
El cliente vinculado a la conversación debe estar activo y coincidir exactamente en teléfono
normalizado con el snapshot del pedido; si varios clientes activos comparten ese teléfono,
se rechaza como ambiguo. No se asocia automáticamente a nadie por teléfono.

El servidor redacta un aviso determinista con el folio real y guarda únicamente un borrador
transaccional, sin marcar tarea completa ni presumir envío. `source_run_id` es inmutable, único
y tiene FK por tenant/sucursal. Otra clave idempotente devuelve el mismo borrador en la misma
conversación; no crea un segundo efecto. Una segunda conversación para la misma tarea se rechaza.
Regla, tarea, pedido y contacto se revalidan de nuevo antes de encolar y de ejecutar. Una cancelación,
cambio de versión o revocación deja el borrador sin autorización o suprime la cola. El puente
funciona sin cuenta del canal; la entrega sigue requiriendo preparación y aceptación externas.

Validación final focal de este módulo: **54 pruebas aprobadas**, incluyendo 36 de protocolo
anteriores, bandeja/outbox, matriz SQL real y tres regresiones del puente de automatizaciones. La recuperación del worker incluye
sucursales secundarias con mensajes sending aun cuando no tengan reglas ni política comercial,
sin llamar a proveedor ni alterar borradores de otras sucursales.
