# Catálogo público por sucursal

Estado: implementación local; publicación productiva pendiente del release protegido.

El dueño o gerente selecciona productos activos, nombre, descripción y WhatsApp público opcional.
Publicar exige acceso comercial, al menos un producto y confirmación mediante Guardar publicación.
El catálogo usa precios actuales de backend y disponibilidad descontando reservas de la sucursal.
No expone costos, márgenes, cantidades exactas, datos de clientes ni catálogo no seleccionado.

## Contrato y seguridad

- `GET/PUT /api/v1/storefront/settings` usa sesión, permiso `settings.manage`, sucursal y billing.
- PUT exige `Idempotency-Key`, `expected_version` y selección explícita; el primer guardado usa versión cero.
- `GET /api/v1/storefront/qr` genera PNG privado del origen configurado y enlace vigente.
- `GET /api/v1/public/catalog/{token}` acepta sólo capability firmada con audiencia, publicación,
  negocio, sucursal y versión de enlace. Se consulta con rol runtime/RLS, sin conexión privilegiada.
- La capability no autentica sesiones ni autoriza otras APIs. Respuesta de proyección estricta,
  sin caché compartida; la ruta pública limita consultas por IP mediante el limitador existente.
- Despublicar retira acceso inmediatamente; reemplazar enlace invalida el anterior. Producto inactivo,
  tenant desactivado y billing no vigente ocultan los datos. El enlace no es una credencial de sesión.
- `public_catalogs` y `public_catalog_items`: RLS ENABLE/FORCE, FK compuestas y grants sólo runtime.
  La exportación y purga de cuenta incluyen ambas tablas, hijos antes del padre.

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
