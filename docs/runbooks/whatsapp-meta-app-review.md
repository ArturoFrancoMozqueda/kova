# Preparar la revisión de la app de WhatsApp

Estado actualizado: 15 de noviembre de 2026. La solicitud de permisos de WhatsApp sigue como
borrador técnico, sin enviar ni aprobar. La renovación anual de acceso a datos es un trámite
separado: ya se envió y sigue en revisión. Complementa el [runbook de alta](whatsapp-embedded-signup.md).

## Alcance que debe revisar Meta

| Permiso | Uso implementado en Kova | Evidencia necesaria |
| --- | --- | --- |
| `whatsapp_business_management` | Verificar que el número seleccionado pertenece a la cuenta autorizada y suscribir esa cuenta al callback de la app. | Dueño autenticado, selección de sucursal, autorización en Meta y conexión verificada. |
| `whatsapp_business_messaging` | Registrar sólo números nuevos, sincronizar coexistencia autorizada y enviar respuestas humanas confirmadas a conversaciones con consentimiento y ventana de atención válida. | Entrada real firmada, respuesta explícita desde Bandeja y recibo de Meta; distinguir aceptado y entregado. |
| `public_profile` | Prerrequisito de acceso avanzado que muestra Facebook Login for Business. No sustituye el login propio de Kova ni se usa para consultar perfiles de Facebook. | Requisito visible en el panel y recorrido del SDK con la autorización de WhatsApp. |

Las operaciones reales están en `backend/app/messaging/signup_provider.py`, `onboarding.py` y
`delivery.py`. El SDK está en `frontend/src/messaging/embeddedSignup.ts`. No solicitar anuncios,
páginas, catálogos ni permisos de eventos de marketing para este flujo. No atribuir a Kova una UI de
plantillas, campañas, llamadas o migración no implementada. El soporte de coexistencia está
publicado con gate apagado; sigue pendiente de aceptación real, como se registra abajo.

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
- Plataforma **Sitio web** agregada, con URL `https://kovasuite.com/`. La cuenta aislada del revisor
  está preparada; el recorrido con WhatsApp todavía requiere conexión y aceptación reales.
- `WHATSAPP_APP_ID`, `WHATSAPP_SIGNUP_CONFIG_ID`, `WHATSAPP_CREDENTIALS_KEY` y
  `WHATSAPP_SIGNUP_ENABLED=false` guardados sellados en el Worker privado
  `kova-native-signup-settings`. Se comprobó antes que no existían; no se rotó una clave anterior.
  La clave nueva se generó aleatoriamente, sin imprimirla ni guardarla en el repositorio.
  Guardar los ajustes no modifica un proceso ya iniciado. Antes de la aceptación, comprobar su
  carga efectiva en el proceso publicado; no se verificó esa carga en esta sesión.

## Acceso aislado para el revisor

Comprobación del 15 de noviembre: correo y login válidos, cero clientes y conversaciones, canal
sin conectar y alta apagada. La renovación anual de Meta exige credenciales activas durante un
año; la prueba hasta el 21 de noviembre no cumplía ese plazo. El titular autorizó la cortesía
permanente existente únicamente para este negocio aislado y la entrega de sus credenciales a Meta
en el formulario privado. La operación verificó identidad, único dueño confirmado y ausencia de
Stripe/datos de clientes, y dejó auditoría. La API normal confirma `reason=complimentary`.
No se cambiaron fechas de prueba ni estados de pago ni suscripciones de otros negocios. La fecha
`valid_until` de la sesión sigue siendo un límite de caché/offline, no vencimiento de la cortesía.

Preparado el 14 de noviembre de 2026 mediante el registro público ordinario de Kova:

- Inicio de sesión: `https://kovasuite.com/login`.
- Negocio propio **Kova — Revisión de Meta**, una sucursal y rol dueño únicamente en ese negocio.
- Correo confirmado por el titular. Login y sesión autenticada comprobados por la API normal.
- Cero clientes y cero conversaciones. No se cargaron ventas, métricas, contactos ni información
  de comercios reales. Las respuestas están apagadas y WhatsApp figura sin conectar.
- Prueba comercial normal de Gestión vigente hasta **2026-11-21 18:02:43 UTC**. No se creó una
  suscripción pagada ni se concedió una cortesía; se conservaron los gates comerciales.
- Credenciales aleatorias guardadas en un archivo local privado fuera del repositorio, accesible
  sólo al usuario del equipo. No pegarlas en este documento, PR, video, logs ni capturas públicas.
  Entregarlas únicamente en los campos privados del formulario de acceso de Meta cuando corresponda.

Antes de entregar el acceso: comprobar nuevamente correo, login, negocio y sucursal, vigencia
comercial suficiente para toda la revisión y conexión real de WhatsApp. Si vence la prueba, resolver
el acceso por el procedimiento comercial autorizado; no renovar fechas ni inventar estados de pago.
El alta de WhatsApp sigue apagada: esta cuenta preparada no demuestra todavía el recorrido de Meta.

Instrucciones base para el formulario privado del revisor, después de aceptar el recorrido real:

> Sign in at https://kovasuite.com/login using the Kova credentials supplied in the private access
> fields. This account belongs only to the isolated review business. Select its main branch, open
> Settings → Channels, then follow the WhatsApp connection and Inbox steps shown in the recording.
> Kova has its own login; these credentials are not Facebook account credentials.

No enviar el expediente mientras el revisor no pueda reproducir realmente ese recorrido. Meta
[requiere acceso a las funciones solicitadas y evidencia reproducible](https://developers.facebook.com/docs/resp-plat-initiatives/app-review/introduction).

## Configuración de Meta comprobada el 15 de noviembre

- Con autorización explícita del titular se activaron `history`, `smb_app_state_sync` y
  `smb_message_echoes`, todos en v25.0, conservando `messages` y `account_update`. El MCP confirmó
  cinco campos suscritos; no se cambió el callback ni el token de verificación.
- El cambio autorizado a modo Activo fue bloqueado por Meta: exige una **Renovación del acceso
  a datos**. Se solicitó la evaluación y apareció la acción correspondiente, con vencimiento el
  14 de enero de 2027. La app **sigue en modo Desarrollo**.
- El titular autorizó certificar `public_profile` y confirmar los proveedores, responsable y
  respuestas de tratamiento anteriores. Esos apartados quedaron completos. Privacidad conserva
  `https://kovasuite.com/privacy`; las instrucciones explican el login propio de Kova, el uso de
  Facebook Login for Business sólo para WhatsApp y el gate público apagado. Con autorización
  adicional del titular se aceptó la certificación final de cumplimiento y se envió la renovación.
  Meta confirmó **En revisión**, sin acciones adicionales, e indica que la mayoría se revisa en
  un plazo de diez días. El nuevo intento de modo Activo sigue bloqueado hasta la aprobación.
  Se entregaron únicamente las credenciales autorizadas de la cuenta aislada con cortesía. El
  formulario no atribuye una conversación de WhatsApp conectada a esa cuenta.
- Comprobación posterior: la renovación continúa **En revisión** y no pide acciones adicionales.
  El propio borrador de permisos deshabilita **Enviar para revisión** con el mensaje «Completa
  los requisitos de renovación del acceso a datos para enviar la app a revisión». Se contrastaron
  sus respuestas precargadas de tratamiento con las que confirmó el titular, sin enviar esa
  solicitud ni aceptar nuevas declaraciones. La renovación bloquea también ese envío.
- Los textos de ambos permisos de WhatsApp se actualizaron en el borrador de App Review para
  explicar coexistencia, importación autorizada y separación entre historial/eco y mensajes en
  vivo. Sin video real ni nuevas certificaciones, ese borrador tampoco se envió.
- El titular eligió **Cafetería Sweet Home / Sucursal principal** para la prueba real. El número
  de WhatsApp Business móvil no se conectó, registró, migró ni importó. Conservar la app móvil.

La admisión del piloto vive en `tenants.feature_overrides.whatsapp_signup_pilot=true`, sólo para
Sweet Home y el negocio aislado del revisor, con auditoría de plataforma. La disponibilidad, inicio
y finalización exigen esa admisión en el negocio autenticado. No se entrega este control al cliente.
El interruptor global sigue apagado. Las conexiones verificadas y sus eventos no se revocan al
retirar la admisión para nuevas altas. No ofrecer el alta pública general durante este piloto.

El primer intento de publicar la restricción mediante un campo nuevo del holder fue detenido
por la protección de identidad del plano de control, antes de cambiar la app. Se comprobó sitio,
API, proxy y base sanos en el mismo SHA anterior. Se conserva intacto el holder de cuatro campos:
la admisión usa la configuración por negocio existente, sin eludir esa protección ni leer secretos.

El titular confirmó que el destino del número real debe seguir siendo **Sucursal principal** y
pidió completar lo pendiente. Se retiró su vinculación vacía del número de prueba anterior de Meta
mediante el procedimiento acotado del runbook de alta: bloqueo de identidad y alcance, cero
conversaciones, mensajes, eventos, credenciales cifradas, sincronizaciones, contactos, lotes y
autorizaciones pendientes, y auditoría en la misma transacción. La consulta posterior confirma cero
vinculaciones/conexiones en esa sucursal y exactamente un registro de retiro. La sesión real del
dueño muestra Sweet Home / Sucursal principal **Sin conectar**. No se eliminó ningún número en
Meta ni se modificó la cuenta móvil del número real.

La sucursal queda libre para una autorización nueva de coexistencia cuando Meta permita continuar.
Una referencia vieja del registro asistido no puede ocultar la conexión nueva verificada; nunca
aporta sus credenciales. El interruptor general continúa apagado y no se conectó ni importó el 3710.

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
acceptance. This permission also supports registration of new verified Cloud API numbers.
For eligible businesses using WhatsApp Business on a phone, Kova supports the owner-authorized
Coexistence flow without registering the number again or changing its PIN. Contacts and permitted
message history are synchronized separately from CRM and contact consent; messages sent from the
mobile app appear in the inbox. Historical messages and mobile-app echoes do not open the Cloud API
customer service window and are never re-sent by Kova.

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

El 14 de noviembre de 2026, el Centro de seguridad y el alta de proveedor muestran el negocio
**Verificado / Aprobado**. Los botones para solicitar acceso avanzado de WhatsApp ya están
habilitados. `public_profile` conserva **Advanced access**; los dos permisos de WhatsApp conservan
**Standard access**. La app sigue en desarrollo y el alta comercial apagada.

Se creó el borrador de App Review `3422272181289072`, con los dos permisos de WhatsApp y la revisión
del permiso existente `public_profile` que Meta incluye en el expediente. Se guardaron las
explicaciones de administración y mensajería limitadas a las capacidades implementadas.
No se aceptaron nuevas declaraciones, no se adjuntó video y no se envió el expediente. El resumen
mantiene **Enviar para revisión** deshabilitado y Tratamiento de datos **Requiere revisión**.
Las respuestas anteriores están precargadas y deben revisarse antes del envío. El indicador genérico
**En revisión** del alta de proveedor no acredita que este borrador se haya enviado.

Las instrucciones del alta exigen un video de envío desde la app y recepción en WhatsApp, y otro
de creación de plantilla para administración. El detalle permite usar **WhatsApp Manager** para
crear y guardar esa plantilla; no hace falta atribuir esa UI a Kova. Las llamadas de prueba pueden
tardar hasta 24 horas en aparecer. El saludo desde el panel no sustituye la evidencia desde Kova.

El diagnóstico del MCP no encontró una cuenta de producción vinculada al portafolio, sólo la cuenta
de prueba. Falta conectar un número autorizado, suscribir su cuenta y comprobar entrada, respuesta
y entrega. El titular confirmó que el número indicado ya envía y recibe mensajes desde la app móvil
WhatsApp Business. No está libre para el alta estándar. No registrarlo por
ese flujo, migrarlo ni eliminar la cuenta móvil. Una búsqueda sin resultados en el MCP no acredita
que el número esté libre.

Meta ofrece [coexistencia con la app móvil](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).
El titular solicitó implementarla el 14 de noviembre. El soporte publicado ya incorpora el evento de
coexistencia, verificación de compatibilidad en Meta sin registro/PIN, contactos/historial y ecos
con cola durable cifrada y controles de ventana/consentimiento. Sigue detrás del gate apagado y
requiere aceptación real. No basta usar el enlace alojado que muestra Meta. Véanse
[contrato](../../specs/integrations/whatsapp-embedded-signup.md) y
[ADR-036](../adr/ADR-036-whatsapp-business-app-coexistence.md).

Antes de enviar el borrador, actualizar sus descripciones y grabaciones para reflejar la coexistencia
realmente publicada y probada. Los textos guardados previamente describen el corte estándar y todavía
no son evidencia de sincronización. No ofrecer el número actual como conectado ni activar los nuevos
campos del webhook sin completar su autorización de configuración. El backend compatible ya está
publicado: [evidencia del release](whatsapp-embedded-signup.md#publicación-de-coexistencia-aceptada-el-14-de-noviembre-de-2026).

La revisión local del documento fiscal aportado por el titular encontró una discrepancia concreta:
la dirección postal de la solicitud no incluía número exterior ni colonia, que sí constan en el
documento. Nombre legal, ciudad, entidad y código postal coincidían. Esa diferencia se corrigió;
no constituye una explicación confirmada por Meta del rechazo. No versionar el PDF, el domicilio ni sus
identificadores personales. El documento no contiene teléfono; su ausencia no acredita por sí sola
el motivo, ya que Meta admite documentos que validen nombre legal y dirección o teléfono.

El titular autorizó completar la dirección fiscal, presentar el documento original y reenviar la
solicitud a Meta. Se comprobó que la dirección corregida persistía al retomar el asistente. Se eligió
correo electrónico y la categoría **Constancia de Situación Fiscal SAT**, recomendada por Meta;
el flujo avanzó del paso de documentos a la confirmación de correo. El titular completó directamente
el CAPTCHA y el código enviado a `verificacion@kovasuite.com`. Tras ello se comprobó **Información
enviada** y, al cerrar con Listo, **En revisión**. La comprobación posterior del mismo día mostró
**Verificado**, como se registra arriba; eso no equivale a habilitación comercial de WhatsApp.
No se modificó el sitio público.

Referencias oficiales consultadas el 14 de noviembre:
[documentos aceptados](https://www.facebook.com/business/help/159334372093366) y
[rechazos de verificación](https://www.facebook.com/business/help/2342133782492969).

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

Antes de enviar el borrador de acceso avanzado, verificar privacidad, eliminación de datos,
acceso del revisor, video real y respuestas del formulario con el comportamiento publicado. La
verificación del negocio por sí sola no acredita esos requisitos ni permite activar comercios.

El aviso en `/privacy` se amplió con los datos efectivamente tratados por la conexión, finalidades,
Cloudflare/Supabase y Meta/WhatsApp, procesamiento fuera de México, controles de acceso, retención,
exportación y una sección específica para solicitar eliminación de datos de WhatsApp y Meta por
soporte. No promete borrar historial al pausar respuestas o retirar permisos. No agrega identidad
personal, domicilio ni identificadores fiscales al sitio ni declara el canal comercial disponible.
Su publicación se verifica con el release y el contenido HTTPS público. Este contenido técnico no
acredita suficiencia jurídica ni aprobación de Meta por sí mismo.

Fuente primaria consultada en sesión autenticada el 12 de noviembre de 2026:
[Implementación de Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/).
La página recomienda la plantilla de token de 60 días y sólo los activos/permisos necesarios.
