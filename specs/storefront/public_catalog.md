# Catálogo público por sucursal

Estado: catálogo publicado; enlaces legibles pendientes del release protegido.

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
`/catalogo/:token` es consulta pública con enlace directo al WhatsApp elegido. Escribir al negocio
no crea automáticamente cliente, consentimiento, oportunidad, pedido, reserva ni pago en Kova.
La UI lo explica y no declara integración con WhatsApp Cloud API.

## Aceptación y QA

Selección explícita, retiro/rotación, contenido inseguro, productos ajenos, roles, billing, tenant
desactivado, replay, versión obsoleta, PNG y RLS se prueban en PostgreSQL aislado. Frontend cubre
retiro, cambio de enlace, error, teléfono inválido y fetch sin cookies. Verificar móvil, escritorio,
contraste, lectura de QR físico y WhatsApp real antes de atribuir aceptación de esos canales.

Los nombres legibles son descubribles: el catálogo contiene únicamente información elegida para
publicar. Su URL no es un secreto. La tabla de rutas no permite enumeración sin contexto ni
actualización/borrado con el rol runtime; sólo inserción de rutas propias y lectura por RLS.
