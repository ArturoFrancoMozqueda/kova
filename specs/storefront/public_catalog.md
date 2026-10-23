# Catálogo público por sucursal

Estado: catálogo y enlaces legibles publicados; experiencia de menú digital implementada localmente, pendiente de publicación.

El dueño o gerente selecciona productos activos, nombre, descripción y WhatsApp público opcional.
Publicar exige acceso comercial, al menos un producto y confirmación mediante Guardar publicación.
El catálogo usa precios actuales de backend y disponibilidad descontando reservas de la sucursal.
No expone costos, márgenes, cantidades exactas, datos de clientes ni catálogo no seleccionado.

## Contrato y seguridad

- `GET/PUT /api/v1/storefront/settings` usa sesión, permiso `settings.manage`, sucursal y billing.
- PUT exige `Idempotency-Key`, `expected_version` y selección explícita; el primer guardado usa versión cero.
- `GET /api/v1/storefront/qr` genera PNG privado del origen configurado y enlace vigente.
- `GET /api/v1/public/catalog/{token}` acepta el nombre legible reservado del negocio.
  `public_catalog_links` sólo permite consultar metadatos de ruta del slug exacto solicitado,
  mediante RLS y contexto transaccional. Después se establece el tenant y se validan publicación,
  versión, negocio activo y billing con el rol runtime, sin conexión privilegiada.
- Los nombres se normalizan sin acentos; colisiones y reemplazos agregan un contador numérico.
  Las rutas se reservan mientras exista la cuenta; la purga de cuenta las elimina junto con sus datos. Cambiar el título no cambia la URL. La migración asigna
  rutas a publicaciones existentes. Las capabilities firmadas anteriores siguen funcionando hasta
  la rotación de su versión, para conservar los QR ya impresos.
- Ningún enlace autentica sesiones ni autoriza otras APIs. Respuesta de proyección estricta,
  sin caché compartida; la ruta pública limita consultas por IP mediante el limitador existente.
- Despublicar retira acceso inmediatamente; reemplazar enlace invalida el anterior. Producto inactivo,
  tenant desactivado y billing no vigente ocultan los datos. El enlace no es una credencial de sesión.
- `public_catalogs` y `public_catalog_items`: RLS ENABLE/FORCE, FK compuestas y grants sólo runtime.
  La exportación y purga de cuenta incluyen publicaciones, productos y rutas, hijos antes del padre.

## Experiencia

`/settings/public-catalog` permite seleccionar productos, publicar/retirar y descargar QR.
`/catalogo/:token` presenta un menú digital, con fotografías reales cuando existen, búsqueda sin
acentos por nombre/descripción y filtro de disponibilidad. Los productos agotados se muestran,
pero no pueden agregarse. No se inventan categorías, fotografías, horarios ni formas de entrega.

El visitante puede armar una solicitud de pedido con cantidades (1–99 por producto, hasta 20
productos distintos), revisar un subtotal estimado en MXN e indicar si pide a distancia o está
en el negocio. Puede añadir notas, por ejemplo una referencia de mesa; esto no administra mesas.
El subtotal se calcula en centavos con los precios públicos recibidos del backend. Es una
estimación del cliente, nunca el precio autorizado de una orden ni evidencia de pago.
En móvil y tablet el encabezado es compacto y el menú usa tres columnas de tarjetas con fotografía 4:3
a todo el ancho. Nombre y precio permanecen visibles, con acciones
de al menos 44 px bajo la fotografía para no cubrir el producto. Los controles de cantidad
se editan desde «N en pedido», que abre el detalle con botones de 44 px, sin comprimirlos dentro
de la tarjeta. Escritorio conserva sus controles directos. Agotados se identifican y no permiten agregar.
Tocar la fotografía abre el detalle: imagen grande con el encuadre guardado, descripción completa,
precio y controles. El diálogo compartido conserva foco, teclado, Escape y retorno al disparador.
Las fotos proceden exclusivamente de la proyección pública del backend; ausencia/error se
indican sin sustituirlas por productos ajenos. No se agregan fotos de muestra a datos del negocio.
El formulario no ocupa espacio en la exploración:
«Mi pedido» o la barra inferior abren una vista de revisión, sin modal ni formulario duplicado.
«Volver al menú» restaura posición y foco, conservando cantidades, contacto y notas en memoria.
«Hacer una consulta» abre directamente la modalidad de consulta, también con menú vacío.
En escritorio el resumen sigue visible junto al menú. La navegación entre vistas no envía datos.

El envío usa el contrato existente `POST /api/v1/public/catalog/{token}/requests`, sin cookies:
nombre, contacto, IDs de productos, UUID de envío y mensaje legible con cantidades, origen,
subtotal estimado y notas. No se agregan campos ni se cambia el esquema de datos. El mensaje
completo respeta el límite de 1,000 caracteres: si lo supera se bloquea el envío sin truncarlo.
Las consultas generales siguen disponibles mediante «Solo consultar», incluso con menú vacío.

El equipo recibe el detalle en `/commercial-requests` y conserva la revisión y vinculación
explícitas de cliente antes de continuar como oportunidad. **Una solicitud de pedido no crea
automáticamente una orden en Pedidos, reserva, venta, pago ni consentimiento de campañas.**
La recepción muestra la referencia de solicitud y aclara que falta aceptación del negocio.
No equivale a un flujo de aceptación, preparación o cobro integrado al menú.

El reintento del mismo contenido conserva el UUID tras errores de red; editar el contenido
genera otro. El envío bloquea ediciones concurrentes y doble clic. Cambiar de catálogo aborta
peticiones y descarta selección, contacto y notas. Sin conexión se conserva la selección sólo
en memoria mientras la página siga abierta, se informa al visitante y se bloquea el envío.

El enlace al WhatsApp elegido permanece como consulta secundaria. Abrir WhatsApp no envía la
solicitud a Kova y no declara integración con WhatsApp Cloud API. `checkout_available` sigue en
`false`; no hay cobro público ni confirmación automática de inventario.

## Aceptación y QA

Selección explícita, retiro/rotación, contenido inseguro, productos ajenos, roles, billing, tenant
desactivado, replay, versión obsoleta, PNG y RLS se prueban en PostgreSQL aislado. Frontend cubre
retiro, cambio de enlace, error, teléfono inválido y fetch sin cookies. Las pruebas del menú
cubren cantidades, límites, agotados, filtros, solicitudes generales/pedidos, subtotal, origen,
reintentos, doble clic, navegación entre catálogos, conexión y confirmación de recepción.
Navegador cubre 320/390/768/1440 px, teclado y axe con API interceptada. La demostración visual con
fotografías usa recursos existentes de `public/showcase/products` sólo desde la API interceptada
del test; verifica carga real de píxeles, proporción de imagen, detalle, teclado y cantidades.
Se conservan escenarios sin fotos para probar ausencia de contenido. Verificar móvil, escritorio,
contraste, lectura de QR físico y WhatsApp real antes de atribuir aceptación de esos canales.

Los nombres legibles son descubribles: el catálogo contiene únicamente información elegida para
publicar. Su URL no es un secreto. La tabla de rutas no permite enumeración sin contexto ni
actualización/borrado con el rol runtime; sólo inserción de rutas propias y lectura por RLS.
