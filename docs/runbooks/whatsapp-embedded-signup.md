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
   `WHATSAPP_SIGNUP_ENABLED=true`. No imprimir ni versionar valores. Los secretos comunes del
   piloto permanecen en `kova-backend`: versión Graph fijada, app secret y verify token.
6. Un release autorizado crea un proceso nuevo con esa configuración. Guardar un Secret no
   cambia la configuración de un proceso que ya estaba arrancado.
7. Ensayar con dueño, negocio y número autorizados: finish, reconexión sin nuevo registro/PIN,
   entrada firmada, respuesta humana explícita y recibos. Registrar aceptado/entregado por separado.
   Sólo esta evidencia permite declarar disponibilidad comercial.

## Operación por comercio

El dueño selecciona la sucursal, pulsa Conectar WhatsApp y Autorizar en Meta. Meta gestiona sus
datos, autorización y número. Kova verifica los activos, intercambia el código, suscribe, registra
un número nuevo y guarda sus credenciales cifradas automáticamente. Los envíos comienzan pausados;
el dueño puede habilitar respuestas cuando haya comprobado la conexión. Cada respuesta requiere
permiso de contacto y confirmación humana. Configurado no acredita entrega ni estado actual de Meta.

La coexistencia con la app móvil requiere un flujo específico y queda fuera de esta versión;
nunca solicitar que elimine su WhatsApp. Las renovaciones usan el mismo binding y conservan el PIN.

## Revisión de un alta interrumpida

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

## Estado de Meta al 12 de noviembre de 2026

- Portafolio Kova Suite seleccionado; el perfil legal y los documentos se enviaron con los datos
  de la persona física titular. El Centro de seguridad muestra **En revisión**, con una estimación
  de dos días laborables. La solicitud enviada no equivale a verificación aprobada.
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
  con el gate apagado. Los botones de acceso avanzado y de envío de revisión siguen deshabilitados.
  El panel exige además acceso avanzado a `public_profile` para Login for Business. Véanse el
  [expediente y las evidencias pendientes](whatsapp-meta-app-review.md), incluidos video real y
  revisión del aviso de privacidad antes de enviar.

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
