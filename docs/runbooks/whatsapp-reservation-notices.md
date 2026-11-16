# Operar avisos automáticos de reservas

Implementación y contrato: [confirmaciones y recordatorios](../../specs/integrations/reservation-notices.md).
La publicación conserva `WHATSAPP_RESERVATION_SENDING_ENABLED=false` por defecto y políticas
inexistentes o desactivadas. No se enviaron mensajes reales ni se modificaron números por este cambio.

## Después de la aprobación de Meta

1. Confirmar acceso avanzado de la app y completar la coexistencia del número autorizado. Verificar
   entrada real y sincronización sin sustituir el número de prueba de otra sucursal por accidente.
2. Crear las cuatro plantillas del contrato en la cuenta autorizada, categoría Utilidad, español
   México, BODY exacto y variables posicionales con muestras ficticias. No añadir cabecera ni botones.
   Esperar `APPROVED`; la aprobación de permisos no aprueba plantillas.
3. Mediante la configuración operativa privada y el workflow de publicación, preparar API y jobs
   con la misma bandera de envíos, cohorte `AUTOMATION_TENANT_IDS` y conexión verificada. El job
   recibe la bandera por su binding privado; la API nativa la recibe por el binding del Worker
   del slot reemplazable (`slot-lifecycle.mjs`), falso si falta o es inválido. Aplicar al proceso
   nuevo mediante el workflow. No modificar `settings-keys.json` ni `SignupSettings`: ambos
   controladores están protegidos por identidad de fuente. El job
   necesita los ajustes de WhatsApp y la clave de descifrado ya usada por la API, suministrados por
   los canales de secretos existentes; nunca en argumentos, logs ni navegador. Jobs conserva sólo
   el rol runtime, sin credenciales de migración. No ampliar el cohorte ni habilitar otros negocios.
4. Comprobar estado de la conexión, importación completa y permiso explícito del destinatario.
   Mantener las políticas apagadas al preparar la plataforma. El dueño activa únicamente la
   sucursal de aceptación desde Canales, reconoce cargos y empieza con límite pequeño.
5. Crear una reserva nueva con destinatario de prueba autorizado. Confirmar template `accepted`,
   recepción real y webhook firmado `delivered`. Revisar recordatorio y cancelación, retiro de
   permiso, convivencia con el celular y que no se liberaron previews anteriores.
6. Ampliar únicamente después de esta aceptación. La bandera de plataforma y la política son
   controles separados; ninguna respuesta de Meta activa envíos por sí sola.

## Pausa, fallos y límites

El dueño puede desactivar su política incluso si la plataforma está bloqueada. Cambiar versión
suprime pendientes anteriores. El operador apaga la bandera en API y jobs para bloquear toda
nueva entrega; un POST ya iniciado puede completar y su recibo debe conservarse.

No reencolar `uncertain`, `failed` o `suppressed` automáticamente. Revisar la bandeja y el
proveedor antes de considerar una acción explícita. `accepted` no acredita entrega. Un límite
alcanzado suprime el aviso, sin acumular deuda para mañana. Plantilla pausada/rechazada o estructura
diferente bloquea el POST; revisar en Meta y crear una reserva futura de aceptación después de corregir.

La revisión de seguridad del SQL se ejecuta con dos negocios y `kova_app` sin bypass. La
validación local usa PostgreSQL desechable, API real y transportes Meta falsos. Los recorridos
responsive y de reprogramación no acreditan coexistencia ni entrega productiva.
