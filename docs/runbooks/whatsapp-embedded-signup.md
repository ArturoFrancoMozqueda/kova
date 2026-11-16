# Activar Embedded Signup de WhatsApp

Alta implementada, todavía sin aceptación comercial con Meta. Los pasos de plataforma son una vez para Kova;
los comercios sólo autorizan su cuenta y verifican su número en Meta desde Canales del negocio.
No pedir tokens ni claves a los comercios por chat o formularios de Kova.

## Plataforma, una vez

1. Completar el perfil legal y la verificación de Kova en Meta. No inventar los datos legales.
   Obtener alta como proveedor de tecnología, revisión y acceso avanzado a los permisos necesarios.
2. Configurar el callback HTTPS único de WhatsApp y suscribir los campos `messages` y
   `account_update`. Verificar challenge, firma y recepción con la cuenta autorizada.
3. Configurar Facebook Login for Business para Embedded Signup **v4**, dominios HTTPS permitidos
   y retorno válido de Kova. Solicitar únicamente cuentas WhatsApp y sus permisos de administración
   y mensajes; no catálogos, páginas ni anuncios. Conservar el Configuration ID público.
4. Publicar por PR y workflow autorizado. La migración es aditiva. El release prepara
   `kova-native-signup-settings`, sin URL pública ni contenedor, que delega las credenciales comunes
   al holder existente. Nunca se reinicia el controlador de producción para agregar estos ajustes.
5. En ese Worker privado, configurar `WHATSAPP_APP_ID`, `WHATSAPP_SIGNUP_CONFIG_ID`,
   `WHATSAPP_CREDENTIALS_KEY` (Fernet aleatorio, separado de otros secretos) y, al cumplir los gates,
   `WHATSAPP_SIGNUP_ENABLED=true`. Para aceptación limitada, admitir primero los negocios
   autorizados con `tenants.feature_overrides.whatsapp_signup_pilot=true` mediante una operación
   de plataforma auditada. Comprobar que otro negocio no vea el alta ni pueda iniciarla/finalizarla.
   La admisión ausente o no booleana mantiene el alta apagada aun con el interruptor global activo.
   No imprimir ni versionar secretos. Los secretos comunes del
   piloto permanecen en `kova-backend`: versión Graph fijada, app secret y verify token.
6. Un release autorizado crea un proceso nuevo con esa configuración. Guardar un Secret no
   cambia la configuración de un proceso que ya estaba arrancado.
7. Ensayar con dueño, negocio y número autorizados: finish, reconexión sin nuevo registro/PIN,
   entrada firmada, respuesta humana explícita y recibos. Registrar aceptado/entregado por separado.
   Sólo esta evidencia permite declarar disponibilidad comercial.

## Operación por comercio

### Activación del piloto por publicación

El workflow **CI and release** admite en un dispatch explícito sobre `main` la opción
`whatsapp_signup=enable` o `disable`; por defecto conserva `preserve`, sin tocar ajustes.
Después de validar CI y capturar producción, modifica únicamente el booleano
`WHATSAPP_SIGNUP_ENABLED` del delegado privado y publica un proceso nuevo mediante el release
normal. No lee credenciales ni cambia el holder original. El gate de admisión por negocio sigue
siendo obligatorio: encenderlo no abre el alta a otros comercios. Si falla la publicación, se cierra
el gate para procesos posteriores y el flujo conserva su recuperación de aplicación habitual.
No atribuir efecto al proceso que ya servía antes: comprobar la disponibilidad del dueño en Kova
después de la aceptación del release. Deshabilitar nuevas altas no revoca conexiones existentes.

La operación de recurso usa la CLI fijada desde la raíz del checkout, con Worker explícito.
No debe ejecutarse desde `deploy/cloudflare-native`: allí la CLI evalúa la configuración de la
imagen nativa y exige un SHA de build ajeno a la modificación de este booleano. El primer intento
se detuvo en ese dry run, antes de modificar el gate o publicar una aplicación. La comprobación
pública posterior confirmó API/frontend/controlador/arranque en `811a957a564afe037b7b391bf7c963b5be100418`,
sitio/proxy/base sanos y privacidad sin nombre personal; no se reintentó ese workflow sin corregirlo.

La renovación anual de Meta ya muestra **Completada** y el MCP confirmó la app **Activa** el
15 de noviembre de 2026. Esto libera esos dos requisitos; no acredita todavía el acceso avanzado
de WhatsApp ni la aceptación real de coexistencia.

La prueba real del 16 de noviembre alcanzó el flujo Phone Number First, pero Meta devolvió
**3441107** al detectar el número de la app móvil: falta la habilitación de la app del socio.
No repetirlo como alta estándar ni pedir que se elimine la cuenta. Los permisos de WhatsApp
siguen estándar y su borrador no fue enviado. Primero completar la evidencia alternativa que
Meta admite para App Review y su aprobación; después volver a probar coexistencia. Véase el
[expediente actualizado](whatsapp-meta-app-review.md#bloqueo-real-de-coexistencia-y-evidencia-de-revisión).

### Autorización del dueño

El dueño selecciona la sucursal, pulsa Conectar WhatsApp y Autorizar en Meta. Meta gestiona sus
datos, autorización y número. Kova verifica los activos, intercambia el código, suscribe, registra
un número nuevo y guarda sus credenciales cifradas automáticamente. Los envíos comienzan pausados;
el dueño puede habilitar respuestas cuando haya comprobado la conexión. Cada respuesta requiere
permiso de contacto y confirmación humana. Configurado no acredita entrega ni estado actual de Meta.

El soporte de coexistencia está publicado para el piloto admitido; todavía requiere
aceptación real. Meta debe confirmar compatibilidad y el dueño autorizar su cuenta.
Nunca solicitar que elimine su WhatsApp. En coexistencia no se registra ni cambia PIN; renovaciones
usan el mismo binding y no repiten las solicitudes de importación iniciales.

Antes de activarla, suscribir también `history`, `smb_app_state_sync` y `smb_message_echoes`.
El backend compatible ya está publicado; las tres suscripciones se activaron en v25.0 el 15 de
noviembre de 2026. La renovación de acceso a datos ya se completó y la app está Activa; esto todavía
no acredita recepción de producción. El flujo
importa contactos separados de CRM e historial autorizado, refleja mensajes del celular y permite rechazar
compartir historial. Mantener la app abierta durante sincronización; explicar cambios de dispositivos
vinculados y limitaciones de Meta antes de autorizar. Probar lote grande, reconexión y retiro de acceso.
Los payloads se capturan cifrados y se procesan en lotes; la consulta de sincronización del dueño y
el scheduler con cohorte autorizada permiten recuperar una interrupción sin repetir POSTs a Meta.
No agregar negocios al scheduler sin su admisión normal. Véase
[ADR-036](../adr/ADR-036-whatsapp-business-app-coexistence.md).

## Revisión de un alta interrumpida

### Retiro de una vinculación de prueba vacía

Es una operación de plataforma, nunca una función de reasignación automática del alta. Requiere
que el titular elija esa misma sucursal para un número diferente y que el operador compruebe que
la vinculación anterior corresponde al número de prueba de Meta, no al teléfono del negocio.

1. Capturar identidad exacta de negocio, sucursal, vinculación, WABA y número de prueba, sin tokens.
2. En una transacción privilegiada explícita, bloquear sucursal y vinculación. Abortar si existe
   cualquier conversación, mensaje, evento, conexión cifrada, sincronización, contacto o lote
   importado; también ante una autorización pendiente para ese alcance. No purgar esos datos.
3. Retirar sólo esa vinculación vacía y registrar auditoría de identidad/alcance y motivo. No
   eliminar ni desregistrar el número en Meta, no cambiar PIN y no editar Secrets compartidos.
4. Confirmar sin conectar, iniciar una autorización nueva y verificar con Meta el número real.
   Una entrada antigua de configuración del piloto sólo se usa si conserva su vinculación exacta
   habilitada. Si ya fue retirada, se consulta la conexión cifrada nueva, que debe verificar el
   mismo negocio y sucursal; sin ella, sigue sin conectar. La propiedad no cambia automáticamente.

Este procedimiento no sirve para reemplazar un canal con historial. En ese caso se requiere una
migración y revisión específicas; no borrar historial ni mover la vinculación a otra sucursal.

### Estados de autorización

`exchanging`, `subscribing` o `registering` persistidos no se repiten. La UI pasa a revisión después
de dos minutos. Consultar las evidencias de Meta con un operador autorizado y comparar la sesión,
cuenta y número exactos; no reasignar ni reemplazar credenciales globalmente. Los tokens y PIN de
una sesión en revisión están cifrados y nunca deben copiarse a logs ni tickets. La resolución
requiere un procedimiento revisado específico; no editar estados para forzar otro POST.

## Bloqueo de publicación por drenado

El release conserva el drain gate y los dos procesos anteriores. Si el slot inactivo no está
libre, puede usar **un único** `kova-api-recovery` cuando el snapshot v2 haya capturado tanto su
Worker como su aplicación ausentes y una segunda consulta confirme la ausencia. No sobrescribe
un namespace, no fuerza cierres ni elude identidades. Si el espacio adicional existe u ocurre
deriva, falla cerrado. Este respaldo también debe acreditarse sano (BD/oferta/SHA/proceso) antes
de mover tráfico. La recuperación sólo restaura el gateway exacto.
El paso al delegado privado de ajustes admite sólo el binding `SETTINGS` y las identidades/SHA
capturados de un slot drenado. Otros servicios y recursos conservan el comparador estricto.
Un recovery ya existente conserva sus cuatro identificadores comerciales públicos sin cambios.

No reintentar un `RECOVERY_BLOCKED`; atender como incidente. Un release recuperado permanece rojo.
Los candidatos nuevos limpian respuestas que llegan después de la desconexión del cliente y
propagan la señal de cancelación; no fijan una caducidad para cortar respuestas legítimas. Hay una
prueba de regresión que falla con el controlador anterior y pasa con la corrección, además del
modelo del pipeline SDK bajo workerd. La prueba no certifica el estado privado del proceso antiguo.
La versión anterior sólo informa `replaceable`; el código nuevo agrega `active_responses` e
`idle_ms` acotados para distinguir contadores de la concesión. La causa exacta del bloqueo anterior
no se presupone a partir del booleano. Ver [ADR-031](../adr/ADR-031-bounded-native-recovery-slot.md).

## Estado de Meta al 14 de noviembre de 2026

- Portafolio Kova Suite seleccionado; el perfil legal y los documentos se enviaron con los datos
  de la persona física titular. Tras un rechazo sin motivo específico visible, se corrigió una
  discrepancia de dirección al comparar el formulario con el documento fiscal. La nueva solicitud
  se presentó el 14 de noviembre con autorización del titular. Posteriormente, el Centro de seguridad
  mostró **Verificado** y el alta de proveedor **Aprobado**. El titular completó el CAPTCHA y la
  confirmación del correo directamente. No se atribuye la diferencia de dirección al rechazo
  como causa confirmada. La aprobación del negocio no concede los permisos de WhatsApp.
- Registro iniciado como proveedor de tecnología independiente con autorización expresa del
  titular para aceptar las condiciones. La revisión de permisos de la app sigue pendiente;
  la app permanece en desarrollo.
- `verificacion@kovasuite.com` reenvía al destino operativo ya verificado en Cloudflare.
  El titular completó el código directamente. [Alcance del correo](../email-deliverability.md).
- El saludo de prueba de Meta llegó al celular autorizado. Eso acredita ese envío desde el panel,
  no ingreso firmado ni respuestas desde la bandeja de Kova, ni disponibilidad para otros negocios.
- Facebook Login for Business agregado, ajustes HTTPS/SDK y URLs públicas guardados. Se creó la
  configuración `1478484207472135` desde la plantilla oficial de WhatsApp con token de 60 días y
  sólo los dos permisos de WhatsApp. Los cuatro ajustes del delegado privado ya están sellados,
  con el gate apagado. Los botones de solicitud de acceso avanzado ya están habilitados y se creó
  un borrador con ambos permisos; todavía no se envió. `public_profile` conserva **Advanced access**.
  Faltan videos reales de mensajería y creación de plantilla (Meta permite WhatsApp Manager), revisión
  de las declaraciones y conexión de un número autorizado. El titular confirmó que su número ya
  está en la app móvil: debe usar coexistencia, cuyo soporte está publicado pero sin aceptación real.
  Véanse el
  [expediente y las evidencias pendientes](whatsapp-meta-app-review.md).

## Publicación aceptada el 12 de noviembre de 2026

Los PRs [#343](https://github.com/ArturoFrancoMozqueda/kova/pull/343) y
[#344](https://github.com/ArturoFrancoMozqueda/kova/pull/344) están fusionados. El
[release 43279827960](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/43279827960)
aceptó `3be0dac411e4f3de85fa55e228d616b13140b2fb`: 25 contratos nativos, oferta y proceso objetivo
coincidentes; la comprobación pública independiente confirmó API/frontend, sitio, proxy y base.
La migración aditiva se aplicó mediante el workflow, sin revertir la base durante la recuperación
del intento anterior. [Detalle del incidente y su resolución](../despliegue.md#recuperación-verificada-el-12-de-noviembre-de-2026).

Meta aceptó el challenge real de
`https://kovasuite.com/api/v1/messaging/webhooks/whatsapp`; el token se guardó sellado y no forma
parte de esta evidencia. El endpoint público rechazó con HTTP 403 un cuerpo vacío de evento
sin firma. Guardar el callback y rechazar solicitudes sin firma no acreditan ingreso firmado
ni entrega de eventos de una cuenta real.
La lectura posterior de Meta confirmó únicamente `messages` y `account_update` suscritos;
ambos selectores del panel muestran `v25.0`, alineados con el contrato fijado por Kova. Los eventos
adicionales que el panel activó automáticamente al guardar el callback quedaron desactivados.
El alta comercial sigue apagada hasta cumplir todos los gates de plataforma y la aceptación.

## Evidencia local del 12 de noviembre de 2026

- PostgreSQL desechable: 108 casos de mensajería, entrega, alta, ciclo de cuenta y migración.
  Incluyen RLS con rol sin bypass, escrituras restringidas, renovación y colisiones entre negocios
  antes de efectos externos. Estas comprobaciones se hicieron sobre una base desechable;
  la publicación productiva posterior se registra arriba.
- Contenedor/controlador nativo: 89 pruebas; gateway: 28 pruebas JS y RPC bajo workerd.
  La suite adicional del backend Python en Workers no arrancó por faltar su bundle Pyodide local;
  no se presenta esa suite como aprobada. La API productiva usa el contenedor nativo.
- Publicación: 73 pruebas enfocadas aprobadas, una omitida por plataforma. La suite más amplia
  previa aprobó 237 y omitió 13 por plataforma; no es evidencia de un release real.
- UI: 28 pruebas unitarias de alta, canales y CRM; tipos, lint, build y contrato OpenAPI compatibles.
  Dos recorridos Playwright sobre el build a 390/1440 px, teclado, offline y revisión de capturas.
  Meta está simulado explícitamente; no se enviaron mensajes ni se otorgaron permisos externos.
- Sigue pendiente completar los gates de Meta, verificar ingreso firmado real y aceptar entrega
  desde la bandeja. El gate de alta continúa apagado por defecto hasta cumplir esos requisitos.

## Validación local de coexistencia del 14 de noviembre de 2026

- 129 pruebas de backend y migración aprobadas sobre PostgreSQL desechable con pgvector. Incluyen
  RLS con `kova_app`, grants inmutables, upgrade/downgrade/upgrade, importación interrumpida,
  firma, lote mayor a 256 KiB, identidades opacas, baja de contactos, historial rechazado,
  recibos anteriores al eco y retiro de acceso entre autorización y envío. Meta está simulado.
- 21 pruebas de interfaz del módulo; lint, tipos, build y contrato OpenAPI compatibles.
- Cuatro recorridos sobre el build a 390/1440 px: número nuevo y coexistencia con SDK/API simulados,
  teclado, offline, progreso, habilitación posterior y origen del historial/eco en bandeja.
  Revisión visual de las capturas, sin desbordamiento horizontal ni secretos en pantalla.
- No se conectó ni modificó el número del titular, no se aceptaron nuevos términos y no se
  habilitó el gate global. Esta evidencia no equivale a coexistencia aceptada por Meta.


## Publicación de coexistencia aceptada el 14 de noviembre de 2026

El [PR #366](https://github.com/ArturoFrancoMozqueda/kova/pull/366) se fusionó tras `CI required`
aprobado. El [release 43643721609](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/43643721609)
terminó correctamente con `e8b33d5e4a2fb78b748b53a29890cdc4c0bc4e8e` en frontend y backend.
La verificación pública independiente confirmó sitio, API, proxy y base accesibles, y ambos headers
de controlador/arranque coincidentes por API directa y proxy.

CI detectó inicialmente que la matriz global de seguridad no enumeraba las tres tablas nuevas.
Se amplió con verbos exactos, columnas mutables y datos de dos tenants, sin ampliar permisos de
producción. La suite completa de 49 migraciones pasó localmente y la segunda ejecución de CI aprobó;
también pasaron 23 pruebas adicionales de RLS. No se relajaron controles ni se omitió el check.

Publicado no equivale a activado: el gate conserva su configuración apagada. Siguen pendientes los
tres campos adicionales del webhook, acceso avanzado/revisión de la app y prueba real con el número
autorizado, sin eliminar ni desregistrar su WhatsApp Business del celular.
