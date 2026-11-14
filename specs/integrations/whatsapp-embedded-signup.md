# Alta de WhatsApp desde Kova

Implementación local actualizada, 2026-11-14. Detrás de `WHATSAPP_SIGNUP_ENABLED=false` por defecto.
No acredita publicación, aprobación de Meta, disponibilidad comercial ni recepción/entrega real.
Complementa el piloto asistido; no migra su número ni su registro de Secrets.

## Problema, usuarios y valor

El dueño de un negocio debe poder autorizar su cuenta de WhatsApp desde la sucursal que atenderá,
sin configurar servidores, compartir tokens con soporte o crear otra app de Meta. Kova configura
una sola app y callback; cada dueño conserva la autorización de su cuenta y la verificación de su
número en Meta. Gerentes pueden consultar el estado; sólo el dueño inicia y finaliza el alta o
habilita respuestas. Se conserva el acceso comercial y `settings.manage`.

## Flujo y permisos

1. `GET /api/v1/messaging/readiness` agrega `signup_available`. Sin configuración completa conserva
   el flujo asistido y no carga el SDK ni realiza lecturas nuevas desde el cliente.
2. `GET /api/v1/messaging/onboarding` devuelve disponibilidad, capacidad de administración y estado;
   sólo entrega los IDs públicos del SDK al dueño autorizado. Nunca entrega credenciales.
3. El dueño pulsa **Conectar WhatsApp**. Se carga el SDK oficial sin registro automático de eventos
   y `POST /onboarding/start` prepara una sesión de diez minutos ligada al actor/negocio/sucursal.
4. **Autorizar en Meta** abre Embedded Signup v4 en el gesto explícito del dueño. Sólo se aceptan
   orígenes exactos `https://www.facebook.com` y `https://web.facebook.com`. Código y nonce viven
   únicamente en memoria; no se guardan en navegador, URL, telemetría o auditoría.
5. `POST /onboarding/finish` recibe la sesión, nonce, código y activos elegidos. El servidor verifica
   la app, los permisos otorgados sobre esa cuenta y que el número exacto esté verificado en ella.
   Los IDs del navegador no establecen identidad de tenant ni autorización.
6. Se suscribe la app; en alta estándar se registra el número nuevo y se guarda el binding junto
   con el token y PIN cifrados. En coexistencia el número ya registrado se verifica con Meta y
   **no** se llama a `/register` ni se genera/cambia su PIN. Renovar la autorización del mismo binding conserva el PIN y no vuelve a registrar el
   número. Nunca reasigna un número ya vinculado ni sustituye una conexión del piloto.
7. Los envíos empiezan pausados. `PATCH /connection/sending` permite al dueño habilitar o pausar
   respuestas humanas. Mantiene consentimiento, destinatario exacto, ventana de atención, outbox,
   confirmación por mensaje y límite diario conservador del adaptador. No activa campañas.

CRM y el control del negocio consultan el mismo estado de configuración para una sucursal; no
conservan un "sin conexión" fijo después del alta. Una vista de varias sucursales indica consultar
por sucursal, sin atribuir la conexión de una a todo el negocio. Configurado no acredita entrega.

Una cuenta sin número compatible, migración y variantes distintas de `FINISH` o
`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` requieren revisión. No se eliminan cuentas ni se
habilitan llamadas o crédito ajeno. Meta solicita los datos del negocio y las autorizaciones.

## Conservar WhatsApp Business en el celular

El SDK v4 solicita `whatsapp_business_app_onboarding` y session logging v3. La finalización de
coexistencia puede entregar sólo WABA: el servidor resuelve un único número autorizado e inequívoco
con `is_on_biz_app=true`, `platform_type=CLOUD_API` y verificación vigente. Si hay varios candidatos
sin selección explícita, no escoge uno automáticamente. El alta estándar rechaza números que Meta
identifique como pertenecientes a la app móvil. La conexión continúa siendo exclusiva por sucursal.

Después de persistir el binding se solicitan contactos e historial una sola vez mediante
`/smb_app_data`. Se registra `requesting` antes de cada POST y el request ID tras aceptarlo. Timeout,
error o interrupción requieren revisión: nunca se repite automáticamente el POST ni se desconecta
el celular. La reconexión conserva las solicitudes ya registradas. El dueño puede rechazar compartir
su historial en Meta; `2593109` se respeta como `declined`, sin crear mensajes ficticios.

Los campos `history`, `smb_app_state_sync` y `smb_message_echoes` pasan por HMAC y routing exacto.
Se captura una bandeja durable cifrada con sólo los eventos del binding; nunca se guarda el cuerpo
multinegocio completo en una tabla de un tenant. Alta habilitada permite hasta 8 MiB/20,000 eventos;
el piloto conserva 256 KiB y los mensajes ordinarios conservan su límite de 100 eventos.
Procesamiento posterior al HTTP, scheduler autorizado o `POST /onboarding/sync` del dueño avanzan
un cursor acotado con los mensajes en la misma transacción bajo runtime RLS. El payload cifrado se
retira al terminar; un lote inválido queda en revisión sin importación parcial.

`GET /onboarding` agrega `coexistence`, `sync_status` y `sync_progress`, sin IDs ni request IDs.
La UI consulta el procesamiento cada cinco segundos mientras esté online y sincronizando; cancela
la consulta al desmontar/cambiar alcance y permite consultar el estado. Las respuestas quedan
bloqueadas mientras haya importación o revisión pendiente. El progreso no equivale a entrega.

Contactos importados viven separados de CRM y consentimiento, con cambios ordenados por fecha y
baja conservada para evitar resurrección por eventos atrasados. Los mensajes se deduplican por
binding/message ID entre historial, ecos y eventos en vivo. La bandeja identifica `whatsapp_app`
y `history`; nunca vuelve a enviar esos mensajes. Sólo inbound auténtico en vivo abre la ventana:
un evento en vivo posterior a su copia histórica también la actualiza. Historial y ecos no otorgan
consentimiento ni extienden esa ventana. Los ecos no consumen el límite de intentos por API de Kova.

Un `account_update` firmado de retiro del partner pone la sincronización en revisión y bloquea
respuestas; no se elimina la cuenta. Nombres importados pueden mostrarse en la conversación sin
vincular automáticamente un cliente. Identidades opacas se diferencian de teléfonos y no se muestran
como números. Medios continúan como placeholders sin descarga; grupos, edición/revocación de
contenido y campañas quedan fuera del alcance.

Migración aditiva `0106_whatsapp_coexistence`: origen inmutable de mensaje, sincronización,
contactos y cola cifrada, todos con FORCE RLS. Runtime conserva SELECT-only en credenciales y
bindings; sólo modifica columnas necesarias de metadatos/importación. Exportación incluye contactos
y origen; purga elimina los hijos antes del binding y downgrade rechaza pérdida de datos.
[Decisión y aceptación](../../docs/adr/ADR-036-whatsapp-business-app-coexistence.md).

## Datos, seguridad y fallos

Migración aditiva `0102_whatsapp_signup`: `messaging_signup_sessions` registra estados y hashes;
`messaging_channel_connections` conserva credenciales cifradas con clave de plataforma separada,
ligadas criptográficamente al tenant, sucursal, cuenta y número. Ambas tablas tienen FORCE RLS.
Runtime sólo tiene SELECT en estas tablas y en bindings. Las escrituras se limitan a rutas
privilegiadas explícitas después de resolver sesión, rol, acceso comercial y sucursal con runtime.
Una reserva SQL única por número, sólo después de verificarlo con Meta, serializa altas entre
negocios antes de suscribir o registrar. Tras adquirirla se comprueba otra vez el propietario:
un alta que haya terminado durante la espera tampoco permite cambiar el número ajeno.

Cada paso externo se registra antes de ejecutarse. Repetir una autorización completada devuelve
el estado; no repite I/O. Errores/interrupciones en suscripción o registro requieren revisión y no
reenvían códigos ni vuelven a registrar automáticamente. Se conservan credenciales cifradas para
investigación. El downgrade impide borrar conexiones o efectos externos no resueltos.

El webhook verifica HMAC antes de buscar pares exactos cuenta/número en la plataforma; después
valida los envelopes y escribe mediante sesiones ordinarias con RLS. No enumera todas las
credenciales ni comparte tokens entre negocios. Mantiene deduplicación y límites existentes.
Exportación excluye sesiones/credenciales y purga las elimina antes de sus bindings.

Errores visibles son fijos en español. Auditoría registra inicio/finalización de conexión y cambio
de permiso de respuestas, sin códigos, nonce, PIN, tokens, contenido ni IDs de Meta. Sin conexión
a internet no se administra el canal. Cambio de sucursal cierra la escucha del flujo anterior.

## Criterios y pruebas

```gherkin
Escenario: dueño autoriza un número verificado para su sucursal
  Dado un negocio con acceso comercial y un dueño autenticado
  Cuando Meta acredita la app, permisos, cuenta y número seleccionados
  Entonces Kova guarda la conexión de esa sucursal con los envíos pausados
  Y repetir el código no ejecuta nuevas llamadas a Meta

Escenario: dueño conserva el número de WhatsApp Business en el celular
  Dado que Meta acredita un número autorizado de la app y Cloud API
  Cuando finaliza la coexistencia y acepta o rechaza compartir historial
  Entonces Kova nunca registra de nuevo el número ni cambia su PIN
  Y sincroniza únicamente los datos autorizados sin duplicar ni volver a enviar mensajes
  Y el historial no abre una ventana de atención ni concede consentimiento

Escenario: cambia el negocio o sucursal durante la autorización
  Cuando se intenta completar una sesión creada en otro alcance
  Entonces se rechaza antes de llamar a Meta

Escenario: se pierde la respuesta al registrar el número
  Entonces el alta queda en revisión y no se vuelve a registrar automáticamente

Escenario: número ya vinculado a otro negocio
  Entonces se conserva su propietario y no se realizan cambios externos
```

Pruebas con Meta simulado: happy path, cifrado, scopes, CSRF, replay, renovación, incertidumbre,
ingreso firmado, roles/grants y aislamiento SQL con `kova_app`; migración upgrade/downgrade/upgrade.
Cliente: eventos oficiales/adversariales, expiración, limpieza al desmontar y preparación antes
del gesto que abre Meta. QA a 390 y 1440 px, teclado y offline. La aceptación real requiere el
[runbook](../../docs/runbooks/whatsapp-embedded-signup.md), perfil y permisos aprobados por Meta.

Fuentes oficiales consultadas el 2026-11-11:
[implementación v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
y [alta como proveedor de tecnología](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/).


Fuente oficial de coexistencia consultada el 2026-11-14:
[usuarios de WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).
