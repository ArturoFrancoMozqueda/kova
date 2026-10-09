# Alta fiscal administrada por Kova

## Experiencia del negocio

1. El owner guarda los datos fiscales del negocio en Kova.
2. Activa facturación: Kova crea una organización dedicada y obtiene llaves Test/Live internas.
3. Carga su CSD (.cer, .key, contraseña) desde Kova. Los archivos sólo pasan por memoria.
4. Firma la carta manifiesto en el módulo embebido del proveedor. La e.firma se maneja allí.
5. Consulta el estado. Sólo el proveedor, RFC coincidente y CSD vigente habilitan emisión Live.

Test conserva etiqueta sin validez fiscal. Las ventas/solicitudes permanecen disponibles si
el proveedor está caído o la plataforma todavía no está configurada. No se cambia precio,
plan ni Stripe del negocio, ni se inventan folios disponibles o una autorización fiscal.

## Configuración de plataforma (una vez, no por tenant)

Crear/usar la cuenta Facturapi administrada por Kova y completar su acuerdo/suscripción para
operar en Live. El proveedor documenta que los folios de la cuenta pueden consumirse por sus
organizaciones: https://docs.facturapi.io/api/ . El costo y la política comercial de Kova se
resuelven por separado; este cambio no activa suscripciones del proveedor por cada negocio.

Configurar `KOVA_FACTURAPI_USER_KEY` en el almacén de secretos del backend Fly. No enviarla
al chat, no ponerla en variables VITE, repositorio, base de datos ni comandos que impriman
valores. Mantener `KOVA_CFDI_CREDENTIALS_KEY` existente y `KOVA_CFDI_ENABLED=true`; rotar la raíz
requiere el procedimiento previo de descifrado/re-cifrado, nunca sustituirla para esta entrega.
Si falta la cuenta/llave o el cifrado, `GET /setup` devuelve `available:false` y el producto
muestra configuración pendiente de Kova, sin pedir llaves al negocio.

El backend debe migrar hasta `e9f2d5d835e6` antes de servir la nueva UI. La tabla
`cfdi_enrollments` tiene FORCE RLS y sólo grants runtime necesarios; nunca acceso anon/browser.
Aplicar el provisionamiento normal de `kova_app` si se recrea el rol. No desactivar RLS.

## Recuperación y conexiones históricas

La reserva se confirma antes del POST al proveedor. Nombre externo inmutable `Kova <tenant UUID>`
permite buscar el intento perdido; no se adopta una organización por RFC o nombre comercial.
Un timeout de creación produce `unknown`: consultar el estado busca coincidencia exacta,
rechaza resultados ambiguos y nunca crea automáticamente otra organización si no encuentra una.
Una operación concurrente se rechaza mientras mantiene una reserva con lease de cinco minutos.
Una organización confirmada se guarda antes de obtener sus llaves. Repetir alta no duplica
organización ni llaves guardadas. Una llave Live cuya respuesta se pierde puede quedar huérfana
en el proveedor; el siguiente intento puede crear otra llave para esa misma organización,
sin emitir documentos ni invalidar llaves existentes. La llave desconocida se revoca mediante
soporte del proveedor cuando se pueda identificar sin afectar conexiones activas.

No reemplazar el RFC ni una organización que ya pertenece al journal. Conexiones manuales
anteriores continúan emitiendo con su organización; la UI indica migración asistida. La migración
requiere revisar propiedad/acceso al proveedor y documentos existentes; no se automatiza adopción
con una credencial de otra cuenta. Exportación incluye sólo metadatos de alta, nunca llaves/CSD.
Purge de cuenta incluye el journal local; la baja de recursos de proveedor necesita operación
separada acorde con conservación fiscal, y no se afirma que el purge local los elimine.

## Verificación antes de activar Live

Probar alta y reintento con proveedor Test real; emisión, reconciliación, XML/PDF y cancelación
conservan el flujo existente. Confirmar cookies/CSRF/billing/roles y dos tenants con RLS.
Verificar móvil/desktop, inputs vacíos tras enviar CSD, iframe cargado bajo CSP y fallos visibles.
Para la firma/revisión final se requieren datos/CSD reales y consentimiento del emisor; ningún
fixture o stub demuestra timbrado ante SAT. Fuente de configuración:
https://docs.facturapi.io/docs/getting-started/organization-onboarding/ .

Las mutaciones de alta/CSD se serializan con la reserva de emisión mediante lock del tenant:
una configuración en curso bloquea nuevas emisiones; CFDI Live con resultado pendiente o
incierto, incluida otra sucursal, bloquean cambios de configuración hasta su reconciliación.
Documentos emitidos/cancelados/rechazados no bloquean una renovación posterior del CSD.
