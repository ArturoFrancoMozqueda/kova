# Preparación del canal oficial de WhatsApp

Estado al 2026-10-18: implementación local de preparación, sin conexión, envío ni recepción activa.
Usar WhatsApp Business en el celular, Meta Business o un dominio no acredita acceso a Cloud API.
La confirmación del propietario sobre su app no se convierte en configuración de todos los tenants.

## Contrato de disponibilidad

`GET /api/v1/messaging/readiness` requiere owner/manager, sesión y acceso comercial con
`settings.manage`. Devuelve `provider=whatsapp_cloud_api`, `status=not_connected`,
`setup_status=setup_required`, `account_mode=not_verified`, `send_enabled=false`,
`webhook_enabled=false`, `tenant_mapping_verified=false` y checklist en es-MX.
No lee ni expone secretos, identificadores de cuentas, teléfonos o datos de otros negocios.
`supported_message_types` describe sólo el adaptador preparado; no disponibilidad de envíos.

El checklist distingue app y API, revisión de coexistencia, WABA/Phone Number ID, aplicación/permisos,
binding del tenant, HTTPS/firmas/recibos, consentimiento/plantillas y aceptación controlada/costos.
Esta entrega no contiene endpoint de envío, webhook público, cambio de número ni alta de cuenta.

## Adaptador y límites

`app.messaging.whatsapp.WhatsAppCloudAdapter` requiere transporte HTTP explícitamente inyectado,
token sólo del servidor, Phone Number ID numérico y versión Graph validada y fijada. No tiene
versión predeterminada ni lee variables de entorno. El host es exclusivamente
`https://graph.facebook.com`, ruta `/{version}/{phone-number-id}/messages`; token en header Bearer,
sin redirects, proxy ambiental ni reintentos propios. Sólo se usa con MockTransport en las pruebas.

Soporta payload de texto sin vista previa de enlaces y plantillas con parámetros textuales de
cuerpo. No permite payloads arbitrarios, media ni URLs suministradas como destino del transporte.
Son límites locales conservadores, no una implementación completa del catálogo de capacidades Meta.

Un resultado HTTP exitoso con `wamid` indica `accepted`; no indica `delivered` o `read`. Timeouts,
fallos de transporte, errores 5xx/408 y respuesta 2xx inválida conservan resultado ambiguo; nunca
se repite el envío automáticamente. Errores contienen códigos fijos/estatus y no contenido externo.

Antes de uso real, un servicio de dominio debe verificar binding exclusivo, permisos y billing,
consentimiento vigente ligado al contacto actual, ventana de atención, plantilla aprobada, baja,
atención humana, topes, outbox durable y reconciliación. El adaptador no autoriza esas decisiones.

## Webhook preparado

`app.messaging.webhooks` comprueba challenge con verify token separado y HMAC SHA-256 sobre bytes
exactos mediante comparación constante. Verifica firma antes de JSON y rechaza cuerpos mayores a
256 KiB, formas inválidas, claves JSON repetidas y constantes numéricas no válidas.

El parser exige WABA y Phone Number ID esperados de un binding confiable, y rechaza cuentas
distintas aunque la firma sea válida. Proyecta mensajes entrantes y recibos sent/delivered/read/failed;
ignora perfiles, adjuntos, errores descriptivos y metadatos no necesarios. Los textos/identidades
son datos no confiables, se excluyen de repr y no se registran. No descarga adjuntos.

Las claves de deduplicación sólo identifican eventos; no sustituyen un ledger persistente ni la
protección contra replay entre solicitudes. No deduce cliente, tenant, consentimiento o ventana
autorizada desde el contenido. No se monta una ruta pública mientras falte esa infraestructura.

## Configuración futura y activación

No se añaden secretos requeridos ni se configura una cuenta con esta entrega. Si se aprueba la
integración, considerar `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_APP_SECRET` y
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` como configuración global opcional sólo del servidor; no usar
prefijo `VITE_`. Los tokens de acceso, WABA y Phone Number ID deben pertenecer a una conexión
verificada/cifrada por tenant; no compartir una credencial global entre negocios. No pedir tokens
por chat ni introducirlos en la UI cliente.

Conservar app, número e historial exige revisar elegibilidad y el flujo oficial de coexistencia
antes de tocar el número. No prometer elegibilidad, migrar, borrar cuentas, sincronizar historial ni
registrar números automáticamente. No fijar costos o capacidad sin comprobar la cuenta y tarifa.

## Fuentes y validación

- [Política oficial WhatsApp](https://whatsappbusiness.com/policy/), actualización visible
  2026-09-23: permiso previo y bajas, plantillas para iniciar o fuera de la ventana de 24 horas y
  una vía de atención humana. Se verificó directamente; no se presuponen tarifas.
- [Colección oficial de Meta en Postman](https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text):
  endpoint Graph versionado y envío de plantilla.
- [Referencia oficial del SDK Meta archivado](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/):
  challenge y firma `X-Hub-Signature-256`. Se usa como referencia de protocolo; no se instala el SDK.
- [Coexistencia en documentación Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users):
  la consulta directa devolvió 429 en esta revisión. La elegibilidad actual de la cuenta y sus pasos
  detallados quedan sin acreditar; se mantiene revisión requerida.

Pruebas locales cubren payloads, host/ruta, redirects, secretos y PII en errores, timeout sin retry,
aceptación distinta de entrega, HMAC/challenge, límites y formas adversariales, replay dentro de un
envelope y rechazo de binding ajeno. Son pruebas de protocolo con transporte simulado, sin tráfico
a Meta; no acreditan alta, permisos, plantilla aprobada, entrega ni operación E2E del proveedor.
