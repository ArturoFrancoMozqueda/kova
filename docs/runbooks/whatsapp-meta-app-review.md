# Preparar la revisión de la app de WhatsApp

Estado observado: 12 de noviembre de 2026. Este expediente es un borrador técnico, no una solicitud
enviada ni una aprobación de Meta. Complementa el [runbook de alta](whatsapp-embedded-signup.md).

## Alcance que debe revisar Meta

| Permiso | Uso implementado en Kova | Evidencia necesaria |
| --- | --- | --- |
| `whatsapp_business_management` | Verificar que el número seleccionado pertenece a la cuenta autorizada y suscribir esa cuenta al callback de la app. | Dueño autenticado, selección de sucursal, autorización en Meta y conexión verificada. |
| `whatsapp_business_messaging` | Registrar el número autorizado y enviar respuestas humanas confirmadas a conversaciones con consentimiento y ventana de atención válida. | Entrada real firmada, respuesta explícita desde Bandeja y recibo de Meta; distinguir aceptado y entregado. |
| `public_profile` | Prerrequisito de acceso avanzado que muestra Facebook Login for Business. No sustituye el login propio de Kova ni se usa para consultar perfiles de Facebook. | Requisito visible en el panel y recorrido del SDK con la autorización de WhatsApp. |

Las operaciones reales están en `backend/app/messaging/signup_provider.py`, `onboarding.py` y
`delivery.py`. El SDK está en `frontend/src/messaging/embeddedSignup.ts`. No solicitar anuncios,
páginas, catálogos ni permisos de eventos de marketing para este flujo. No atribuir a Kova una UI de
plantillas, campañas, llamadas, coexistencia o migración que no está implementada.

## Configuración preparada

- App Kova Social Automation, del portafolio Kova Suite.
- Facebook Login for Business agregado. El creador personalizado sólo mostraba la variante
  General; se usó la plantilla oficial recomendada por la documentación de Embedded Signup v4.
- Configuration ID público: `1478484207472135`. Variante **Registro insertado de WhatsApp**,
  token de usuario del sistema con caducidad de 60 días, activo **Cuentas de WhatsApp** y únicamente
  `whatsapp_business_management` / `whatsapp_business_messaging`. No es un token ni un permiso
  concedido sobre cuentas de clientes.
- Ajustes OAuth guardados: cliente y web activos, HTTPS y modo estricto activos, navegador integrado
  y SDK JavaScript activos. Dominio del SDK: `https://kovasuite.com`; retornos permitidos:
  `https://kovasuite.com/` y `https://kovasuite.com/settings/channels`. Sin dominios de preview,
  comodines, acceso de dispositivos ni conexión con Messenger.
- Meta aceptó en su validador `https://kovasuite.com/settings/channels`. En configuración básica
  se guardaron `kovasuite.com`, categoría **Negocios y páginas**, privacidad `/privacy`, términos
  `/terms` e instrucciones de eliminación `/privacy`. Se comprobó HTTP 200 en esas páginas y en
  Canales. No se configuró una URL ficticia para callbacks POST de eliminación o desautorización.
- Ícono publicado a partir del SVG existente `frontend/public/icons/pwa-512.svg`, renderizado a
  PNG de 1024 × 1024 y revisado visualmente. No se rediseñó la marca ni se utilizó una imagen ajena.
- Plataforma **Sitio web** agregada, con URL `https://kovasuite.com/`. Las instrucciones y el acceso
  de prueba del revisor aún deben completarse con un entorno y recorrido realmente aceptados.
- `WHATSAPP_APP_ID`, `WHATSAPP_SIGNUP_CONFIG_ID`, `WHATSAPP_CREDENTIALS_KEY` y
  `WHATSAPP_SIGNUP_ENABLED=false` guardados sellados en el Worker privado
  `kova-native-signup-settings`. Se comprobó antes que no existían; no se rotó una clave anterior.
  La clave nueva se generó aleatoriamente, sin imprimirla ni guardarla en el repositorio.
  No se reinició el controlador. Un proceso nuevo mediante workflow deberá cargar esos ajustes.

## Texto base para los formularios de Meta

Adaptar al campo exacto del formulario cuando quede habilitado. No marcar evidencia aún pendiente
como completada. Los siguientes textos describen la implementación; el video debe acreditar el
funcionamiento externo antes del envío.

### WhatsApp Business Management

Kova is a multi-tenant point-of-sale and business management service for small businesses in Mexico.
The business owner chooses a branch in Kova and authorizes their own WhatsApp account through Meta
Embedded Signup. Kova exchanges the authorization code on the server, verifies the app and granted
account permissions, checks ownership and verification of the selected phone number, and subscribes
that account to the app's webhook. This permission is required to complete and verify the owner's
requested connection. Kova does not request access to ad accounts, Pages or product catalogs.
Credentials are encrypted on the server and isolated by business and branch. Sending starts paused.

### WhatsApp Business Messaging

Kova enables authorized business staff to reply to customer conversations from its inbox. Incoming
events must pass Meta signature verification and are routed using the exact authorized account and
phone number. A human must confirm each reply. The server checks business access, staff permissions,
contact consent and the customer service window before sending. Retries use an outbox and
idempotency controls. The implementation does not activate bulk messaging, marketing campaigns,
calling or customer WhatsApp app migration. Delivery statuses are processed separately from API
acceptance. This permission also supports registration of the owner's verified Cloud API number.

## Recorrido para grabar cuando sea posible

1. Usar un negocio de aceptación y destinatarios autorizados, sin mostrar datos reales de otros
   clientes. El actor debe tener el rol dueño y acceso comercial válido; no omitir los gates.
2. Entrar con la auth propia de Kova, elegir la sucursal y abrir `/settings/channels`.
3. Mostrar Conectar WhatsApp, Autorizar en Meta, cuenta y número elegidos, permisos y finalización.
   No capturar códigos, tokens, PIN ni secretos en la grabación.
4. Mostrar el estado conectado con respuestas inicialmente pausadas y su habilitación explícita.
5. Desde el celular autorizado, enviar un mensaje real; mostrarlo en `/inbox`, redactar y confirmar
   una respuesta humana, y comprobar su recepción en el celular. Registrar aceptado y entregado.
6. Grabar también la reconexión del mismo número sin volver a registrar ni cambiar su PIN.
7. Si Meta exige administrar plantillas, describir el límite actual y resolver ese requisito con
   una demostración real autorizada o una ampliación de producto revisada. No simular una UI ni
   afirmar que existe un administrador de plantillas en Kova.

Las capturas locales de QA con Meta simulado y el saludo enviado desde el panel no sustituyen
este video. No crear una cuenta de revisor con acceso a negocios reales ni publicar sus credenciales
en este documento. Preparar acceso de aceptación cuando Meta indique su mecanismo y alcance.

## Bloqueos observados y siguiente paso

El Centro de seguridad muestra **En revisión**. En Permisos y funciones, los botones Solicitar
acceso avanzado de ambos permisos de WhatsApp están deshabilitados. La página de alta como proveedor
también deshabilita configuración, carga de video y envío de revisión. No se intentó eludir esos
controles. La app permanece en desarrollo y el alta comercial apagada.
`public_profile` muestra **Advanced access** tras completar la declaración de uso permitido,
el formulario de tratamiento de datos y la reautenticación directa del titular, con su autorización
expresa. Se comprobó la fila del permiso y la acción **Volver al acceso estándar** en el panel real.
La fila conserva **Verificación obligatoria**; el Centro de seguridad sigue **En revisión**.
Este nivel de acceso no acredita la aprobación del negocio ni la de los dos permisos de WhatsApp,
que conservan **Standard access** y sus botones de solicitud deshabilitados.

Para preparar los proveedores se comprobó la región real del proyecto de producción de Supabase
(`us-west-1`) mediante metadatos del proyecto, sin consultar datos ni credenciales. Se declararon
Estados Unidos y Singapur para alojamiento y operaciones de Supabase. Para Cloudflare se usó la
cobertura de 132 países y territorios de su red global publicada, excluyendo China continental:
es el alcance posible de la red sin restricciones regionales, no evidencia de que una solicitud
haya pasado por cada ubicación. Las respuestas sobre prácticas del titular se obtuvieron de éste;
no se declararon procesos que todavía no aplica.

Fuentes de los proveedores consultadas el 12 de noviembre de 2026:
[red de Cloudflare](https://www.cloudflare.com/network/),
[tratamiento global y separación de China](https://www.cloudflare.com/en-gb/trust-hub/appi/),
[residencia y transferencias de Supabase](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq)
y [subencargados de Supabase](https://supabase.com/legal/subprocessor-list/October-12-2026.pdf).

Tras la resolución, comprobar nuevamente estos controles y solicitar el acceso avanzado de los dos
permisos de WhatsApp. Antes de enviar, verificar privacidad, eliminación de datos,
acceso del revisor, video real y respuestas del formulario con el comportamiento publicado. La
verificación del negocio por sí sola no acredita esos requisitos ni permite activar comercios.

El aviso público actual explica exportación, eliminación de cuenta y solicitudes de derechos por
soporte. Antes de la revisión comercial debe comprobarse que describa de forma explícita los datos
de WhatsApp y Meta que efectivamente trata esta integración, sus finalidades y las instrucciones
para solicitar su eliminación. Guardar su URL en Meta no acredita suficiencia jurídica ni aprobación.

Fuente primaria consultada en sesión autenticada el 12 de noviembre de 2026:
[Implementación de Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/).
La página recomienda la plantilla de token de 60 días y sólo los activos/permisos necesarios.
