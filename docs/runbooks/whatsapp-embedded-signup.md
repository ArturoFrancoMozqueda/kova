# Activar Embedded Signup de WhatsApp

Código local preparado, sin aceptación productiva. Los pasos de plataforma son una vez para Kova;
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

## Evidencia local del 12 de noviembre de 2026

- PostgreSQL desechable: 108 casos de mensajería, entrega, alta, ciclo de cuenta y migración.
  Incluyen RLS con rol sin bypass, escrituras restringidas, renovación y colisiones entre negocios
  antes de efectos externos. No se aplicaron migraciones a producción.
- Contenedor/controlador nativo: 89 pruebas; gateway: 28 pruebas JS y RPC bajo workerd.
  La suite adicional del backend Python en Workers no arrancó por faltar su bundle Pyodide local;
  no se presenta esa suite como aprobada. La API productiva usa el contenedor nativo.
- Publicación: 73 pruebas enfocadas aprobadas, una omitida por plataforma. La suite más amplia
  previa aprobó 237 y omitió 13 por plataforma; no es evidencia de un release real.
- UI: 28 pruebas unitarias de alta, canales y CRM; tipos, lint, build y contrato OpenAPI compatibles.
  Dos recorridos Playwright sobre el build a 390/1440 px, teclado, offline y revisión de capturas.
  Meta está simulado explícitamente; no se enviaron mensajes ni se otorgaron permisos externos.
- Sigue pendiente publicar por PR/workflow autorizado, completar el perfil legal y gates de Meta,
  verificar challenge e ingreso firmado real y aceptar entrega desde la bandeja. El gate de alta
  continúa apagado por defecto hasta cumplir esos requisitos.
