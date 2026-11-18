# Entregabilidad de correo — Kova

Evidencia acumulada al 17 de noviembre de 2026. Las comprobaciones históricas conservan su fecha y
alcance; no certifican automáticamente las seis plantillas de la versión actual.

## Decisión vigente de soporte — reenvío y respuestas desde Gmail

El dueño eligió conservar `soporte@kovasuite.com` como dirección pública de recepción y
`posprojectsupport@gmail.com` como remitente de las respuestas manuales, sin contratar Workspace.
Se confirmó la regla exacta Active de Cloudflare Email Routing. En Gmail se seleccionó su
dirección original como predeterminada y se retiró la identidad SMTP `Soporte Kova`; tras
recargar, sólo quedó el remitente Gmail. No se modificaron los MX ni las rutas de verificación
y DMARC. El transporte transaccional de Resend conserva su configuración.

Esta elección usa reenvío entrante y correo nativo de Gmail, por lo que no depende del Enviar como
externo que [Google retira en enero de 2027](https://support.google.com/mail/answer/17101213?hl=es).
No se envió otro correo para este ajuste. Las pruebas de recepción y salida del dominio que
siguen abajo conservan su carácter histórico; el envío manual desde el dominio ya no es la
configuración elegida. Quedan por acordar responsable, cobertura y aceptación con cada piloto.

## Dirección pública de soporte — 17 de noviembre de 2026

La dirección pública cambia a `soporte@kovasuite.com`. Cloudflare Email Routing confirmó la
regla exacta activa hacia el Gmail de soporte existente, ya verificado. Se conservan las
reglas de verificación y DMARC, sus DNS y el catch-all deshabilitado. No se creó un buzón de
pago ni se cambiaron las credenciales o los remitentes transaccionales de Resend.

Frontend, páginas legales, ayuda, JSON-LD prerenderizado y `Reply-To` de las seis plantillas
comparten la nueva dirección. El Gmail sigue siendo destino privado y cuenta de operación;
las referencias históricas a esa cuenta no deben reemplazarse como si se hubiera migrado.

Esto habilita recepción y respuestas a los avisos transaccionales de Kova. No configura por
sí solo el `From` de respuestas manuales de Gmail. La revisión de Gmail mostró únicamente
su identidad original. [Google anuncia](https://support.google.com/mail/answer/17101213?hl=es)
que retirará Enviar como para identidades externas en enero de 2027 y puede restringir nuevas
configuraciones antes. No se añadió una identidad SMTP, no se guardaron credenciales ni se
contrató una cuenta de pago. La configuración de respuestas manuales con remitente del
dominio queda pendiente de escoger una vía compatible y completar su autenticación.

Evidencia local: regla activa observada en Cloudflare; 37 pruebas de ayuda/facturación,
14 contratos OPS, build de producción y 12 escenarios Playwright de facturación aprobados.
Después, con autorización explícita del dueño, se envió un único correo de prueba desde
el remitente verificado de Kova a `soporte@kovasuite.com`, con Reply-To al mismo alias.
El envío se creó a las 01:30:58 UTC del 18 de noviembre (19:30:58 CDMX del 17 de noviembre)
y Resend lo confirmó como `delivered`. La búsqueda del asunto exacto en el Gmail del destino mostró un
único mensaje en Inbox a las 19:31 CDMX. Esto acredita la recepción y el reenvío extremo
a extremo para esa prueba; no acredita envío manual desde el alias ni todos los proveedores.

## Preparación de respuestas manuales con el dominio

Tras aprobar el dueño también las respuestas con dominio, se habilitó Email Sending para
`kovasuite.com` en la cuenta Cloudflare existente. El Dashboard confirmó Sending Enabled y
DNS Configured. Una consulta pública independiente confirmó MX y SPF en `cf-bounce.kovasuite.com`
y la clave pública DKIM en `cf-bounce._domainkey.kovasuite.com`. Los tres MX de recepción del
dominio raíz y su DMARC existente permanecen sin cambios:

`v=DMARC1; p=quarantine; rua=mailto:dmarc@kovasuite.com; pct=100; adkim=s; aspf=s`

Se preparó en Gmail el alias `Soporte Kova <soporte@kovasuite.com>` con:

| Parámetro | Valor |
|---|---|
| Servidor | `smtp.mx.cloudflare.net` |
| Puerto | `465` |
| Cifrado | SSL / TLS implícito |
| Usuario | `api_token` (literal, no una clave) |
| Contraseña | Token Cloudflare con permiso `Email Sending: Edit`; sólo lo introduce el dueño |

La preparación del formulario no acredita una identidad confirmada. El dueño debe crear la
credencial y copiarla directamente al campo de contraseña de Gmail; el agente no la lee,
registra ni recibe por chat. Después debe completar la verificación de dirección de Google.
No se debe marcar el envío manual como terminado sin comprobar el alias confirmado y el
remitente de un correo nuevo expresamente autorizado.

### Confirmación de la identidad en Gmail

La conexión SMTP aceptó la credencial introducida directamente por el dueño. La ventana
inicial sólo confirmaba el servidor y la autenticación; Gmail aún mostraba `unverified`.
Se abrió el correo oficial de confirmación sin copiar su código ni URL privados y se
completó la confirmación de `soporte@kovasuite.com`. Google mostró Confirmation Success
y el alias dejó de aparecer como no verificado.

Se seleccionó `Soporte Kova <soporte@kovasuite.com>` como remitente predeterminado.
La política existente de responder siempre desde la dirección predeterminada quedó
apuntando al alias de Kova; se comprobó su radio seleccionado. Se guardó también el
Reply-To con la misma dirección pública sin leer ni modificar la credencial SMTP.
Un nuevo borrador mostró automáticamente el remitente del dominio.

Con una segunda autorización explícita del dueño se envió un único correo de salida desde
ese alias hacia el Gmail de soporte, con asunto «Kova — prueba de envío con dominio» y
referencia `soporte-salida-20261117`. Gmail mostró Message sent y el mensaje apareció en
Inbox a las 20:19 CDMX del 17 de noviembre. El detalle visible del mensaje confirmó
`From: Soporte Kova <soporte@kovasuite.com>` y `mailed-by: kovasuite.com`.

El Activity log de Cloudflare Email Sending mostró un único registro del mismo asunto,
remitente y destinatario con resultado Delivered. Esto acredita que pasó por el SMTP de
Cloudflare y fue recibido, además de la prueba anterior de recepción por Email Routing.
No se enviaron correos a clientes, no se leyó la clave SMTP ni se alteró el transporte
transaccional de Resend. No se declara un PASS DKIM a partir de un campo que Gmail no mostró;
la evidencia es el remitente observado, la llegada a Inbox y la entrega del proveedor.

El [SMTP oficial](https://developers.cloudflare.com/email-service/api/send-emails/smtp/)
acepta sólo el puerto 465 con TLS implícito. No se debe utilizar un MX de recepción como
servidor de salida. El [plan Workers Paid existente](https://developers.cloudflare.com/email-service/platform/pricing/)
incluye 3,000 envíos mensuales por cuenta y cobra USD 0.35 por cada 1,000 adicionales;
no se contrató otra suscripción. La recepción conserva su reenvío al Gmail original.

Esta integración con Enviar como de Gmail es transitoria: Google anuncia su retirada para
identidades externas en enero de 2027. El dominio y su autenticación SMTP se pueden conservar
con un cliente compatible; antes de esa fecha se debe elegir una vía de respuesta admitida.
No se modificaron el remitente ni las claves de Resend que usa la aplicación.

## Revisión funcional del 14 de noviembre

La consulta de Resend confirmó el dominio verificado, envío habilitado y seguimiento de aperturas
y clics apagado. Los doce envíos recientes consultados figuran como `delivered`, incluida la
verificación de la cuenta aislada del revisor. Gmail web conserva en Inbox las seis muestras QA
del 2 de noviembre; se inspeccionaron los enlaces de verificación e invitación, que siguen
apuntando al dominio canónico con tokens deliberadamente inválidos. No se enviaron mensajes nuevos.

Se corrigieron dos problemas observados en el código:

- El recibo llamaba **Próximo cargo** al final del periodo de la factura. Ahora dice **Periodo
  facturado hasta**: esa fecha no confirma renovación, cobro futuro ni acceso vigente.
- La página de verificación conservaba respuestas y redirecciones de un enlace anterior y podía
  consumir dos veces el token durante el replay de efectos. Cada enlace ahora tiene estado y
  petición propios; salir cancela la redirección. Los fallos temporales permiten reintentar y sólo
  un HTTP 400 marca el enlace inválido. Un enlace vencido lleva a iniciar sesión y pedir otro desde
  el aviso de la cuenta, en vez de indicar volver a registrarse. Los estados se anuncian a lectores
  de pantalla y el título de pestaña identifica la tarea.

Validación: 117 casos de backend con PostgreSQL desechable (transporte, plantillas, startup gate,
carga diferida del SDK, bienvenida, recibo, recordatorios, auth, invitaciones y orden de eventos de
facturación) y 40 de frontend (verificación, recuperación, invitaciones y aviso de verificación).
Las regresiones nuevas reproducen la etiqueta incorrecta, respuestas de enlaces anteriores,
reintentos y ciclo de redirección. Build y lint enfocado aprobados.

Las seis plantillas actuales se renderizaron localmente con datos QA a 390 y 1440 px, sin
desbordamiento horizontal; se comprobaron sus destinos y el texto alternativo. La página de
verificación también se revisó sobre el build con servicio temporalmente inaccesible, reintento y
enlace incompleto. No se cambió ninguna contraseña ni se crearon cuentas, invitaciones, compras o
suscripciones en producción. Esta revisión local y la consulta de entrega no acreditan un recibo
nuevo disparado por un pago real, el enlace privado de Stripe, clientes móviles nativos, modo
oscuro ni Outlook/Hotmail/iCloud. Esas aceptaciones permanecen pendientes.

## Recepción para la verificación de Meta

El 12 de noviembre se habilitó en Cloudflare Email Routing la regla exacta
`verificacion@kovasuite.com` → `posprojectsupport@gmail.com`, cuyo destino ya estaba verificado.
La consulta posterior confirmó la regla habilitada. Se conserva la ruta de DMARC y no se habilitó
un catch-all ni se creó un buzón de pago. Este alias recibe y reenvía; no configura correo saliente.

El dueño completó directamente el código y el envío de documentos en Meta. El Centro de seguridad
mostró **En revisión**, con un plazo estimado de dos días laborables. No se copiaron códigos ni
documentos fiscales al repositorio. Esta evidencia corresponde al trámite de Meta; no sustituye
las comprobaciones de entregabilidad de los avisos transaccionales descritas abajo.

## Avisos tras la compra live de aceptación

La compra Esencial autorizada del 9 de noviembre aprobó factura pagada, activación y cancelación
programada sin perder acceso. El buzón QA y Resend mostraron únicamente verificación; bienvenida
y recibo no se enviaron. La fila de pago confirmó conciliación autoritativa de una factura con
`billing_reason=subscription_create`. Los eventos iniciales llegaron en el mismo segundo y el
handler omitía avisos en ese camino, aunque el pago y el plan se hubieran confirmado correctamente.

La corrección conserva firma, modo, propietario, precedencia temporal, estado y capacidades.
Un pago procesado emite su recibo también después de conciliación. Una factura inicial confirmada
con estado activo puede emitir la bienvenida, aun si Checkout llega después de una marca temporal
más reciente. El filtro de plan desconocido sigue bloqueándola. Una renovación ordinaria no crea
esta bienvenida adicional. El recibo confirma el pago sin afirmar que el acceso siga activo cuando
se lea posteriormente.

El transporte añade una clave de idempotencia a los avisos de facturación, derivada del contenido
exacto y destinatario mediante SHA-256; no exporta esos datos en la clave. Conciliación y webhook
pueden confirmar el mismo mensaje sin duplicarlo dentro de la retención de idempotencia del
proveedor. No equivale a un outbox durable ni a una garantía de entrega exactamente una vez.
Los fallos del proveedor conservan su clasificación fija sin cuerpo, dirección ni credenciales.

Las regresiones cubren los seis órdenes de los eventos iniciales, repetición del mismo evento,
importe real del fixture e idempotencia separada por destinatario/contenido. Fallan contra la
implementación anterior y pasan con la corrección. Esas regresiones no acreditan por sí solas
la recepción real; el alcance comprobado en producción se registra a continuación.

## Bienvenida verificada en producción

El 9 de noviembre de 2026 a las 21:13 CDMX (10 de noviembre 03:13:42 UTC), el backend publicado
`4aeaa973044d` generó la bienvenida del negocio QA mediante
`POST /api/v1/billing/checkout/reconcile`, usando el Checkout live que el dueño ya había pagado.
La consulta previa confirmó que faltaba su referencia local de Checkout y que no había un envío
reciente de bienvenida. Se autenticó al propietario verificado por las rutas normales de Kova,
con cookies y CSRF; la sesión temporal se cerró al terminar.

- Dos confirmaciones consecutivas del mismo Checkout respondieron HTTP 200 y generaron un solo
  envío. Resend registró un único `POST /emails` HTTP 200 del SDK del backend y estado `delivered`.
  No se envió una plantilla manual con el conector ni se reinyectaron eventos fabricados.
- Gmail web mostró «Tu plan Kova está activo» en Inbox, recibido aproximadamente un segundo
  después. Se revisaron el remitente de Kova, logo, texto en español y destinos visibles de
  «Ir al panel», «Suscripción» y soporte; la versión de texto contiene las mismas acciones.
- «Mostrar original» confirmó SPF, DKIM para `mail.kovasuite.com` y DMARC en PASS.
- La suscripción conservó Esencial, MXN 399.00, acceso activo y renovación cancelada al cierre
  del período del 9 de diciembre de 2026 a las 13:40 CDMX. La referencia de Checkout quedó
  registrada. No se creó otra suscripción, Checkout ni cargo y no se reactivó la renovación.

Esto verifica transporte y entrega real de la bienvenida disparada por recuperación de Checkout
en la versión publicada. No acredita una compra nueva posterior a la corrección, el primer
webhook de esa compra, un recibo corregido, ni Gmail móvil/oscuro u otros proveedores de buzón.
La repetición de esta confirmación no equivale a entrega exactamente una vez fuera de esa ventana.
No hizo falta modificar código, desplegar ni ejecutar drills de Stripe/restauración.

## Evidencia histórica

Comprobación de sólo lectura del 29 de octubre de 2026: Resend mantiene el dominio verificado y el
envío habilitado. Las seis pruebas de plantillas del 27 de octubre a las 01:05 UTC, incluida
invitación, figuran como `delivered` a Gmail; el recibo del 26 de octubre a las 23:05 UTC también.
Esto confirma aceptación por el servidor receptor, no Inbox, render, enlaces ni el origen de cada
envío en el backend. El logo público responde HTTP 200 con PNG. Siguen pendientes Outlook/Hotmail,
móvil y modo oscuro.

El 29 de octubre de 2026 a las 20:50 CDMX (30 de octubre 02:50 UTC) se solicitó un
restablecimiento desde `https://kovasuite.com/api/v1/auth/password-reset/request` al buzón QA
designado por el dueño. La API publicada en `49d96f4bb994` respondió HTTP 200 con el mensaje
anti-enumeración y sin token de desarrollo. Resend registró el nuevo correo de recuperación como
`delivered` a las 02:50:28 UTC. Esto acredita el recorrido frontend proxy → backend Cloudflare
actual → proveedor → servidor receptor para recuperación. No se leyó el token ni se cambió la
contraseña. El buzón QA no está conectado a las herramientas de lectura: Inbox, render y uso del
enlace real siguen sin verificarse; tampoco se acredita con este envío el disparador de las otras
cinco plantillas.

Tras publicar el rediseño de las seis plantillas en `aa9c856e8f11`, se repitió la solicitud desde el
proxy el 30 de octubre a las 08:48 CDMX. La API respondió HTTP 200, sin token de desarrollo, y
Resend confirmó `delivered` a las 14:48:57 UTC. Sitio, API directa y proxy reportaron la misma
versión; health y health/db aprobaron. El [release](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40998664640)
terminó correctamente. No se leyó el enlace ni se cambió la contraseña; Inbox/render de este
rediseño todavía requiere aceptación del buzón QA.

Las seis plantillas comparten una presentación de carta editorial sobre fondo blanco, sin tarjeta
ni recuadros, con encabezado de marca y una acción principal en tinta. Los resúmenes de recibo y fin
de prueba aparecen antes del botón, entre separadores discretos; el enlace alternativo describe la
acción y evita mostrar tokens largos en el cuerpo. La versión de texto conserva la URL completa.
Las tablas y estilos inline conservan un baseline sin hojas externas; los ajustes de móvil son una
mejora progresiva. El texto alternativo conserva acciones, importes, fechas y Unicode. La QA local
cubre 320/390/800 px y ausencia de estilos adaptables, sin equivaler a render en Gmail u Outlook.

La consulta de sólo lectura del 2 de noviembre confirma el dominio verificado, envío habilitado y
el reset del 30 de octubre a las 18:32:33 UTC (`4b14f2ca6659`, diseño editorial) como `delivered`.
Esa consulta no envió correo ni leyó el token. Al iniciar no estaba conectado el Gmail QA;
posteriormente el dueño abrió su sesión y autorizó la revisión por navegador. No hay otro buzón
Outlook/Hotmail identificado para la matriz actual.

Posteriormente, a las 16:14 UTC (10:14 CDMX), se envió un lote limitado de seis muestras del diseño
editorial al buzón QA designado. Resend confirmó `delivered` en las seis: verificación, bienvenida,
recibo, fin de prueba, invitación y reset. Se renderizaron con las funciones de aplicación de esta
revisión y se enviaron mediante el conector de Resend, con prefijo QA, aviso visible, datos
ficticios y tokens deliberadamente inválidos. No se crearon cuentas, suscripciones ni cargos;
el recibo omitió el enlace opcional de Stripe. Esto acredita las plantillas y aceptación del
receptor, no los disparadores del backend publicado, enlaces reales ni Outlook/Hotmail.

Con la sesión abierta por el dueño se comprobó después que las seis muestras están en **Inbox de
Gmail web**. Se abrieron e inspeccionaron las seis: logo, encabezados, copy, importe del recibo QA
y acciones legibles en escritorio; el pie de bienvenida y su enlace de soporte también se revisaron.
«Mostrar original» de la muestra de reset confirma SPF PASS, DKIM PASS para `mail.kovasuite.com`
y DMARC PASS. Sólo se consultaron mensajes QA con tokens inválidos; no se cambiaron contraseñas.
Las capturas permanecen fuera de git. Esta aceptación es de Gmail web, no de Gmail móvil, modo
oscuro, Outlook/Hotmail, del enlace opcional de recibo Stripe ni de los disparadores reales restantes.

## 1. Configuración de producción

- [x] Dominio `mail.kovasuite.com` verificado en Resend.
- [x] Remitente efectivo: `Kova <no-reply@mail.kovasuite.com>`.
- [x] `RESEND_API_KEY` presente en producción: el startup gate bloquea el arranque si falta. Desde
      el 2026-10-19 vive como secreto sellado del backend en Cloudflare; la verificación original
      de agosto se hizo en Fly.io, ya retirado.
- [x] `EMAIL_FROM` configurado con el dominio verificado. El startup gate rechaza
      `onboarding@resend.dev` en producción.

No copies valores de secretos a tickets, logs, documentos o comandos locales. Para comprobar su
presencia usa únicamente los nombres de las variables o el startup gate.

## 2. DNS publicado en Cloudflare

Los siguientes valores son los que Resend asignó a este dominio; no los sustituyas por ejemplos
genéricos de otros proveedores.

### SPF y return path

- [x] `TXT send.mail.kovasuite.com`:
      `v=spf1 include:amazonses.com ~all`
- [x] `MX send.mail.kovasuite.com`, prioridad `10`:
      `feedback-smtp.us-east-1.amazonses.com`
- [x] Ambos registros aparecen como verificados en Resend y responden en DNS público.

### DKIM

- [x] `TXT resend._domainkey.mail.kovasuite.com` publicado con la clave entregada por Resend.
- [x] Estado `Verified` en Resend y resolución confirmada en DNS público.

### DMARC

- [x] `TXT _dmarc.kovasuite.com`:
      `v=DMARC1; p=quarantine; rua=mailto:dmarc@kovasuite.com; pct=100; adkim=s; aspf=s`
- [x] La misma política está publicada en `_dmarc.mail.kovasuite.com` para el subdominio remitente.
- [x] Cloudflare Email Routing está habilitado.
- [x] `dmarc@kovasuite.com` reenvía a `posprojectsupport@gmail.com`.
- [ ] Mantener el buzón y los reportes bajo observación durante 14 días antes de considerar
      `p=reject`. El cambio requiere cero fallos legítimos sostenidos y una revisión explícita.

## 3. Evidencia de entrega

El 12 de agosto de 2026 se envió una prueba controlada desde el backend entonces desplegado en Fly.io a
`dmarc@kovasuite.com`, usando la configuración real de producción. Resultado:

- [x] Resend: `delivered`.
- [x] Cloudflare Email Routing: mensaje reenviado al destino operativo.
- [x] Gmail web: llegó a Inbox en aproximadamente un segundo.
- [x] Remitente visible: `Kova <no-reply@mail.kovasuite.com>`; sin `via resend.dev`.
- [x] Gmail “Show original”: `SPF: PASS`, `DKIM: PASS` para `mail.kovasuite.com` y
      `DMARC: PASS` con política `quarantine`.
- [x] Transporte al buzón final mediante TLS.

También se enviaron las cinco plantillas reales, prefijadas con `[QA Kova]` y con tokens inválidos
deliberadamente. No se crearon cuentas, cobros, suscripciones ni datos de cliente.

| Plantilla | Resend | Gmail web |
|---|---|---|
| Verificación | `delivered` | Inbox; asunto y texto en español correctos |
| Bienvenida | `delivered` | Inbox; asunto y texto en español correctos |
| Recibo de pago | `delivered` | Inbox; marcado como QA, sin cargo real |
| Fin de prueba | `delivered` | Inbox; asunto y texto en español correctos |
| Restablecimiento de contraseña | `delivered` | Inbox; token QA inválido |

La primera prueba visual confirmó que Gmail elimina SVG embebido. La plantilla base ahora usa el
isotipo PNG público `https://kovasuite.com/email/kova-mark.png`, mantiene el wordmark textual como
fallback y fija sus dimensiones para evitar saltos de layout.

### QA todavía pendiente

- [ ] Repetir las cinco plantillas en buzones de prueba Outlook/Hotmail e iCloud.
- [ ] Revisar render y modo oscuro en Gmail iOS/Android, Outlook web/desktop e iCloud.
- [ ] Abrir enlaces QA en una sesión privada y confirmar destino `https://kovasuite.com` sin usar
      tokens reales ni disparar cobros.
- [ ] Hacer revisión humana final de copy y contraste en cada cliente.

Usar buzones de QA, tokens deliberadamente inválidos y el registro sin PII de
[`runbooks/ops-beta-gate.md`](runbooks/ops-beta-gate.md). Un estado `delivered` del proveedor no
equivale a Inbox. OPS-1 permanece en curso hasta documentar Outlook y Hotmail; esta revisión tampoco
autoriza migrar el canal de soporte.

## 4. Monitoreo

- [ ] Revisar Resend y los reportes DMARC diariamente durante las primeras dos semanas.
- [ ] Mantener bounce rate por debajo de 2% y complaint rate por debajo de 0.1%.
- [ ] Ante un rebote permanente, corregir el destinatario y conservar la supresión; no reintentar
      repetidamente una dirección inexistente.
- [ ] Si aumenta el bounce rate, pausar mensajes no transaccionales y revisar la higiene de la lista.

La muestra actual es demasiado pequeña para inferir una tasa estable de entregabilidad.

## 5. Recordatorio de fin de prueba

- [x] GitHub Actions ejecuta `uv run python scripts/send_trial_reminders.py` diariamente a las
      `06:00 UTC` (`00:00` en Ciudad de México).
- [x] El job es idempotente por tenant mediante `trial_reminder_sent_at`.
- Los recordatorios excluyen cortesías permanentes sin Stripe. Una falla de transporte deja el
  job en rojo después de intentar el lote; las aceptaciones confirmadas conservan su marca y los
  pendientes pueden recuperarse en otra ejecución antes del vencimiento. No hay cola durable ni
  garantía de entrega única del proveedor ante una caída entre aceptación y commit.
- [x] Los diez runs programados más recientes al 29 de octubre de 2026 terminaron correctamente;
      último [run 40870140304](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40870140304).
- [ ] Confirmar que la retención de logs operativos cubra al menos 30 días.
