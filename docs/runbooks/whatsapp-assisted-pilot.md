# Primer negocio con WhatsApp en Kova

Fecha: 2026-10-23. Estado: implementación local; conexión y aceptación real pendientes.

Este corte permite recepción firmada, vinculación explícita de cliente, catálogo como borrador,
respuesta humana confirmada y recibos de entrega. Alta asistida por plataforma, hasta 50
conexiones exclusivas por sucursal; no es todavía Embedded Signup de autoservicio. No se deben
vender campañas, respuestas de IA ni avisos automáticos de postventa como parte de este corte.

## Lo que prepara Arturo

1. Registrar la cuenta de desarrollador en [Meta for Developers](https://developers.facebook.com/).
2. Crear una aplicación con el caso de uso de WhatsApp, siguiendo el flujo que muestre Meta.
   Asociar el portafolio empresarial cuando lo solicite. Los nombres del panel pueden variar.
3. En la configuración inicial de WhatsApp, usar el número de prueba proporcionado por Meta
   y agregar/verificar su propio celular como destinatario autorizado para la prueba.
4. Conservar el número de WhatsApp Business actual. La elegibilidad de coexistencia se revisa
   antes de registrar, migrar o cambiar cualquier número real; el piloto no migra historial.
5. Preparar los identificadores de la cuenta de WhatsApp Business (WABA) y del número
   (Phone Number ID). No son el número telefónico. El token de acceso y el secreto de la app
   van al almacén de secretos del servidor: nunca al chat, git, capturas ni variables VITE.

Kova necesita por separado la preparación/aprobación que Meta exija para servir a otros negocios.
Un piloto con activos de la propia plataforma no acredita esa aprobación ni la elegibilidad
de los números de futuros clientes.

## Configuración del operador

No se leen secretos desde UI, no se solicitan por formularios y no se imprimen diagnósticos
con su contenido. El runtime conserva SELECT-only sobre `messaging_channel_bindings`.

| Configuración de servidor | Uso |
| --- | --- |
| `KOVA_WHATSAPP_ENABLED` | Interruptor global, falso por defecto. |
| `WHATSAPP_GRAPH_API_VERSION` | Versión explícita verificada en el panel/documentación de Meta. Sin valor por defecto. |
| `WHATSAPP_APP_SECRET` | Secret de la aplicación para comprobar HMAC del cuerpo original. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Valor aleatorio distinto para el challenge de suscripción. |
| `WHATSAPP_CONNECTIONS` | Secret JSON con la lista de conexiones autorizadas por plataforma. |

Cada entrada del último Secret contiene `tenant_id`, `branch_id`, `binding_id`, `waba_id`,
`phone_number_id`, `access_token`, `send_enabled` y opcionalmente `daily_send_limit`.
Los tres primeros son UUID: el operador verifica el negocio/sucursal con el dueño y genera
un binding nuevo. Nunca se deduce propiedad de un dato del formulario o de un evento entrante.
Cada número y cada sucursal tienen una vinculación exclusiva. El token pertenece a esa cuenta;
no se usa un token global para enviar en nombre de todos los negocios.

`send_enabled` empieza falso. El límite conservador es 25 intentos diarios por sucursal,
ajustable entre 1 y 1000; contabiliza estados con posible I/O, incluyendo fallidos e inciertos.
El periodo se reinicia a medianoche UTC. Los recibos pueden hacer que mensajes anteriores
cuenten de nuevo: el control es conservador, no es facturación del proveedor ni una tarifa.

Con el entorno del operador cargado de forma segura, comprobar sin escribir:

```sh
cd backend
python scripts/provision_whatsapp.py --binding-id <UUID-del-binding> --authorized-by <UUID-del-dueño-o-gerente>
```

El script consulta por HTTPS los números de la WABA y exige el Phone Number ID exacto. No
envía mensajes. Tras autorización del dueño y comprobación del negocio, repetir con `--apply`
usando la conexión de operador; guarda la vinculación, sin otorgar escrituras al rol runtime.
Comprueba que quien autorizó siga activo y tenga acceso a la sucursal, y registra auditoría sin
credenciales ni identificadores de Meta.
No suscribe por sí mismo webhooks, registra números en Meta ni completa una revisión de la app.

Publicar el código requiere los gates habituales de release. Después habilitar el interruptor
para el piloto controlado, configurar el callback HTTPS:

`https://kovasuite.com/api/v1/messaging/webhooks/whatsapp`

Verificar el challenge en Meta, suscribir los eventos `messages` y la aplicación a la WABA
según el flujo oficial. La URL anterior describe la ruta del candidato; no afirma que esté
publicada. El gateway/proxy y el proceso nativo deben preservar el cuerpo y la firma originales.
Confirmar que el proceso nuevo recibe la configuración; no rotar secretos de otros módulos.

La ruta POST admite hasta 256 KiB y verifica `X-Hub-Signature-256` antes de interpretar datos.
El scope se obtiene exclusivamente del registro del servidor y se confirma contra el binding
de PostgreSQL. Un lote puede contener varias cuentas: se procesa cada una con una sesión
runtime y RLS propios. Cuentas desconocidas se reconocen sin guardar contenido ni revelar tenants.
Un fallo parcial puede provocar reentrega; el ledger impide duplicar los eventos ya guardados.

## Aceptación con destinatario autorizado

1. Con envío aún pausado, el celular autorizado escribe al número de prueba. Comprobar que
   el mensaje llega una vez a Bandeja, sin cliente creado/asociado automáticamente.
2. Registrar o elegir un cliente con ese teléfono exacto. Vincularlo explícitamente y asignarse
   la conversación. Registrar el permiso transaccional que se haya obtenido; no inferir marketing.
3. Publicar el catálogo de la misma sucursal. `Preparar enlace del catálogo` guarda un borrador
   del enlace actual del servidor; revisar el texto y su destino antes de enviar.
4. Habilitar `send_enabled` únicamente para esta conexión y con el límite acordado. Confirmar
   un envío real autorizado desde Bandeja, dentro de la ventana permitida. Aceptado no significa
   entregado: verificar el recibo correspondiente y la recepción en el celular.
5. Repetir la misma petición idempotente y comprobar un único mensaje. Revocar el permiso y
   comprobar bloqueo; retirar el consentimiento marketing debe seguir siendo independiente.
6. Revisar entrega, fallo, conexión revocada, ventana vencida y timeout. `uncertain` nunca se
   reenvía automáticamente. Una caída tras `sending` requiere recuperación/consulta del proveedor;
   el scheduler existente de automatizaciones recupera ese estado si el tenant está en su cohorte
   explícita. Conservar esa admisión si se necesita recuperación programada del piloto.
7. Abrir la ficha de cliente desde la conversación y preparar pedido. Confirmar/cobrar/entregar
   mediante los módulos existentes; seguir inventario y venta reales. No se interpretan mensajes
   como órdenes de cobro, inventario ni instrucciones para herramientas.

Hoy sólo se envía texto transaccional con confirmación humana y dentro de la ventana de atención.
Marketing, plantillas y avisos automáticos fuera de ventana están bloqueados, aunque el adaptador
de transporte pueda construir un payload de plantilla. La atención humana puede permanecer
activada: sólo el autor del borrador que sigue asignado puede confirmar su respuesta. El
scheduler no recibe credenciales ni se convierte en dispatcher externo con este cambio.

## Pausa y retirada

Pausar envíos poniendo `send_enabled=false` en el Secret. Para detener también recepción,
deshabilitar la vinculación por operador y retirar la entrada; retirar/revocar el acceso en
Meta cuando corresponda. El interruptor global detiene ambas direcciones. No borrar mensajes
ni el ledger de intentos para simular una conexión nueva. Cuenta/exportación/purga mantienen
su inventario existente: no se agregan tablas ni columnas en este corte. Al eliminar una cuenta
se debe retirar además su entrada del almacén de secretos.

## Lo que falta para completar la visión

- Alta de negocios en autoservicio mediante Embedded Signup, aprobación necesaria de Meta,
  custodia escalable de credenciales y revocación desde producto. La lista del piloto es asistida.
- Plantillas aprobadas y política de costos/frecuencia para pedido listo y postventa fuera de
  ventana; dispatcher durable programado con aceptación propia. No activar envíos sólo por
  completar una tarea interna ni porque exista el teléfono del cliente.
- Conectar explícitamente las tareas de reseña/recompra con sus mensajes, sus bajas y su resultado.
  Verificar venta real, consentimiento adecuado y atribución sin confundir entregas con ingresos.
- Aceptación en la cuenta real, coexistencia si procede y validación de fallos del proveedor.

Fuentes de protocolo: [colección oficial de Meta](https://www.postman.com/meta/whatsapp-business-platform/overview),
[mensajes](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages),
[challenge y firma del SDK de Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
y [política de WhatsApp](https://whatsappbusiness.com/policy/).
