# Alta de WhatsApp desde Kova

Implementación local, 2026-11-11. Detrás de `WHATSAPP_SIGNUP_ENABLED=false` por defecto.
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
6. Se suscribe la app, se registra el número nuevo y se guarda el binding junto con el token y PIN
   cifrados. Renovar la autorización del mismo binding conserva el PIN y no vuelve a registrar el
   número. Nunca reasigna un número ya vinculado ni sustituye una conexión del piloto.
7. Los envíos empiezan pausados. `PATCH /connection/sending` permite al dueño habilitar o pausar
   respuestas humanas. Mantiene consentimiento, destinatario exacto, ventana de atención, outbox,
   confirmación por mensaje y límite diario conservador del adaptador. No activa campañas.

CRM y el control del negocio consultan el mismo estado de configuración para una sucursal; no
conservan un "sin conexión" fijo después del alta. Una vista de varias sucursales indica consultar
por sucursal, sin atribuir la conexión de una a todo el negocio. Configurado no acredita entrega.

Una cuenta sin número, coexistencia, migración y variantes de flujo distintas de `FINISH` requieren
revisión. No se eliminan cuentas, no se migra historial y no se habilitan llamadas ni crédito ajeno.
Meta solicita los datos del negocio, su número y, cuando aplica, el método de pago.

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
