# ADR-036: Conservar WhatsApp Business mediante coexistencia

Fecha: 2026-11-14. Estado: implementado localmente, pendiente de publicación y aceptación con Meta.

## Contexto

Los comercios ya atienden con WhatsApp Business en el celular. El alta estándar de un número nuevo
no permite conservar esa app. Meta ofrece coexistencia mediante un flujo de Embedded Signup,
verificación upstream y sincronización inicial. Sus lotes de historial pueden contener miles de
mensajes y no deben convertirse en permiso para contactar al cliente.

## Decisión

- Usar Embedded Signup v4 con `whatsapp_business_app_onboarding` y session logging v3. Aceptar
  `FINISH` y `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`. En el segundo caso el número puede faltar
  en el navegador: resolver uno inequívoco desde la cuenta autorizada y verificar `is_on_biz_app`
  y `platform_type=CLOUD_API` en Meta. No confiar en la variante declarada por el cliente.
- No llamar a `/register` ni crear/cambiar el PIN de un número en coexistencia. Mantener exclusividad
  global del número, ownership por negocio/sucursal, permisos y credenciales cifradas actuales.
- Guardar un registro de sincronización separado de las credenciales. Registrar antes de cada POST
  de contactos/historial y conservar el request ID. Nunca repetir una solicitud incierta. Solicitar
  ambas dentro del plazo de 24 horas; interrupciones requieren revisión, sin desconectar la app.
- Verificar HMAC antes de resolver alcance. Capturar eventos de coexistencia en una bandeja durable
  cifrada, separada por binding. No copiar el cuerpo multinegocio completo a una tabla de un tenant.
  Limitar a 8 MiB y 20,000 eventos cuando el alta esté habilitada; conservar 256 KiB en el piloto.
- Procesar lotes acotados con runtime `kova_app`, FORCE RLS y bloqueo por sucursal. Confirmar cursor
  y mensajes en la misma transacción. Una tarea posterior al HTTP despierta el procesamiento; la
  consulta autenticada de sincronización y el scheduler privado recuperan el mismo cursor.
- Mantener los contactos importados separados de CRM y del consentimiento. Identidades opacas
  quedan diferenciadas de teléfonos y no se muestran como números. No fusionar clientes.
- Identificar mensajes del celular e historial en la bandeja. Deduplicar por binding/message ID
  entre historial, eventos en vivo y ecos. Sólo inbound en vivo abre la ventana de atención;
  historial y ecos no la abren, no otorgan consentimiento ni vuelven a enviarse.
- Bloquear respuestas mientras haya sincronización o revisión pendiente. Un aviso firmado de
  retiro del partner pone la conexión en revisión. El dueño conserva el control de respuestas.
- Incluir contactos y origen de mensajes en exportación; excluir credenciales y payloads internos.
  Purgar lotes/contactos/sincronización antes de los bindings. El downgrade rechaza perder datos.

## Consecuencias y aceptación

No se activa el gate global ni se declara disponibilidad comercial con estas pruebas locales.
Antes de habilitar: suscribir `history`, `smb_app_state_sync` y `smb_message_echoes` además de los
campos actuales, completar permisos/revisión y probar con una cuenta autorizada conservando el
celular, sincronización aceptada/rechazada, eco, respuesta, entrega, reconexión y retiro de acceso.
El scheduler conserva su cohorte autorizada: no se enumeran tenants nuevos por conveniencia.
No se descargan medios ni se incorporan campañas, grupos, edición o revocación del contenido de
mensajes; conservar placeholders de medios y revisar esos alcances por separado.

Fuente primaria consultada el 2026-11-14:
[alta de usuarios de WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).
