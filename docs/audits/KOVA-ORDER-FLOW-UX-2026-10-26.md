# Pedido, seguimiento y operación sin recaptura

Fecha: 2026-10-26. Implementado y validado localmente; posteriormente
[publicado y aceptado en producción](KOVA-PRODUCTION-ORDER-FLOW-2026-10-26.md).
Riesgo: comportamiento frontend, copy, continuidad operativa y lectura privada de datos.

La [revisión posterior por rol](KOVA-ROLE-UX-REVIEW-2026-10-26.md) amplía este corte y
registra la regresión completa de frontend/backend y los recorridos adicionales.

## Evidencia del recorrido real

Se utilizó la sesión existente del propietario en la pestaña de Codex de `kovasuite.com`.
Se revisaron panel, Pedidos, detalle, continuación a Caja, solicitudes y menú público.
Las operaciones completas con cambios se hicieron en un negocio efímero local, con API,
PostgreSQL y rol runtime sin privilegios de propietario ni BYPASSRLS. No hubo cobros de
proveedor, mensajes externos ni cambios de datos productivos.

## Fricción encontrada y corrección

- El envío terminaba en una tarjeta que exigía encontrar otro enlace. Los pedidos con
  seguimiento devuelto por el backend abren directamente `/seguimiento#…`, reemplazando
  la entrada del formulario en el historial. Se valida la ruta interna; las consultas,
  respuestas antiguas y negocios sin seguimiento conservan su confirmación en el menú.
- El cliente debía pulsar Actualizar. Los pedidos activos se consultan cada 30 segundos;
  se pausa con pestaña oculta/sin conexión, se retoma al volver y se evita superponer
  peticiones. Entrega, cancelación y rechazo detienen la consulta periódica. Un enlace
  vencido o una lectura fallida retiran los datos anteriores y ofrecen reintento.
- Se puede copiar el enlace por acción explícita del cliente; si el navegador no lo
  permite, se explica cómo conservar la dirección. La capability sigue sólo en fragmento
  y cuerpo POST, sin cookies ni referrer y sin guardarse en almacenamiento del navegador.
- Dar de alta a un cliente obligaba a abandonar la revisión. Un formulario dentro del
  diálogo permite guardar y elegir al cliente, conserva productos/precios y exige revisar
  antes de crear el pedido. El contacto público no se interpreta ni vincula automáticamente.
  Se mantienen CSRF, identidad esperada, sucursal, permisos y clave estable en reintentos.
- Las solicitudes eran difíciles de descubrir desde Pedidos. Dueño y gerente disponen
  de un acceso directo; el cajero conserva su acceso operativo existente.
- Las indicaciones del visitante quedaban en la solicitud, separadas de la preparación.
  El campo opcional privado `CustomerOrderResponse.menu_request_message` devuelve el texto
  original completo, sin parsing ni recorte, desde la solicitud vinculada por tenant,
  sucursal y pedido. Aparece en revisión y detalle; también lo ve el cajero con permiso
  de lectura del pedido. No concede acceso comercial ni aparece en el seguimiento público.
  El contrato OpenAPI se actualiza de forma aditiva y no necesita migración.
- La nota generada mostraba un UUID. Las nuevas notas dicen «Pedido desde el menú digital»;
  el detalle presenta de esa manera también la antigua nota generada exacta. Las notas
  escritas por personas se conservan.
- Al cobrar un pedido aparecía el recorrido general de primera venta. Ese contexto ahora
  omite el recorrido sin marcarlo como visto ni cambiar su comportamiento en Caja normal.
- Se sustituyeron explicaciones técnicas repetidas por instrucciones sobre la siguiente
  acción en menú, publicación, solicitudes, revisión y Caja. Un pedido listo sin cobrar
  explica que el cobro en Caja permite marcarlo entregado; conserva esa restricción.

## Archivos

- `frontend/src/storefront`: envío, navegación, textos del menú y publicación.
- `frontend/src/orderTracking`: lectura periódica, conservación del enlace y estados.
- `frontend/src/crm`: alta de cliente en la revisión y continuidad de solicitudes.
- `frontend/src/customerOrders`: descubrimiento, notas originales y siguiente acción.
- `frontend/src/i18n/messages.ts`: ayuda del carrito vacío.
- `frontend/src/onboarding/FirstUseTour.tsx`: cobro de pedidos sin interrumpir con el recorrido.
- `backend/app/crm/order_intake.py`, `backend/app/customer_orders/{service,schemas}.py`:
  nota legible y proyección privada del mensaje original.
- `specs/openapi.json`: propiedad opcional del detalle.
- Pruebas focales de estas áreas y `frontend/e2e/{order-intake-real,order-intake-tracking,customer-orders}.spec.ts`.

## Validación

- 173 pruebas frontend aprobadas en 17 archivos.
- 50 pruebas backend aprobadas: captura/aceptación/seguimiento, pedidos, identidad y rutas
  entre tenants. La prueba de notas se revalida además con rol cajero y rechazo de acceso
  comercial/otro negocio. El mensaje largo conserva sus saltos y contenido normalizado.
- 30 recorridos de navegador focales aprobados en el build, incluyendo 320/390/768/1440 px,
  teclado, axe, cancelación, lectura sin conexión, estados vencidos y permiso de cajero.
  Se acota la aserción de recepción a la región de seguimiento: la URL puede cambiar antes
  de que termine de renderizar la ruta; se conserva la comprobación de estado recibido.
- Tres integraciones reales aprobadas: pedido hasta entrega con cliente creado dentro del
  diálogo, notas y stock 5→3; Caja con teclado sin venta accidental; agenda/lealtad con
  ventas, devolución y canje. Las APIs no se interceptan en estas integraciones.
- TypeScript/build/SSR/prerender, ESLint focal, Ruff, contrato OpenAPI y revisión de bundle
  sin patrones de secretos aprobados. No se repite la suite completa de todo el repositorio.

La prueba manual adicional en el navegador de Codex envía una unidad de $45, abre
automáticamente el seguimiento, conserva «Sin calentar, por favor», revisa y confirma
el pedido, lo prepara, lo marca listo, registra el cobro con su recibo y completa la entrega.

Las primeras pruebas backend se ejecutaron por error sobre la base que conservaba pedidos
E2E; dos aserciones globales contaron esas operaciones. Se repitió el set en otra base nueva
sin modificar esas expectativas. Se corrigieron los fallos de los tests nuevos de esta tarea.

## Referentes de producto

Se tomó como referencia la continuidad hacia la página de estado documentada por
[Shopify](https://help.shopify.com/en/manual/fulfillment/setup/order-status-page/order-confirmation-numbers)
y la gestión de preparación/entrega desde la operación documentada por
[Square](https://squareup.com/help/us/en/article/8454-manage-orders-with-square).
Se aplican como criterios de navegación y claridad, sin adoptar servicios ni prometer sus
capacidades en Kova.

## Hallazgos productivos y límites

En Caja, clientes y pedidos existen registros persistidos con nombres de QA/prueba. Son
información guardada, no copy del frontend; ocultarlos por nombre falsearía la operación.
Su depuración necesita una decisión del dueño y conservar trazabilidad financiera.
El menú público conserva el título genérico configurado por el negocio; puede personalizarse
con el editor existente. No se modifica configuración productiva durante esta auditoría.

La revisión visual y este corte local no acreditan aceptación de Stripe live, hardware,
mensajería ni pruebas con clientes reales. El release autorizado y su aceptación de pedidos
posteriores están registrados en la evidencia productiva vinculada.
