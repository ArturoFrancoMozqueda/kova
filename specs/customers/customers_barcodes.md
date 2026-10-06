# Clientes y códigos de barras

Objetivo: identificar compradores recurrentes y cobrar productos por su código de empaque sin cambiar ventas históricas.

## Contratos

- `products.barcode` es opcional, conserva ceros iniciales y es único por negocio (también en productos inactivos). Admite hasta 100 caracteres ASCII visibles, sin espacios; se pueden borrar con `null`. El catálogo permite capturarlo y buscarlo.
- Importación CSV/XLSX agrega `codigo_barras` al final de la plantilla. Los archivos anteriores siguen válidos. Validación previa detecta duplicados dentro del archivo y del negocio. Para códigos con ceros iniciales en Excel, usar una celda de texto.
- `GET /api/v1/customers` busca por nombre/correo/teléfono y pagina con `limit`/`offset`; incluye activos por defecto. `POST` crea y `PUT /{id}` reemplaza nombre/contacto/estado con Idempotency-Key.
- Clientes pertenecen al negocio, no a una sucursal. Consulta: propietario, encargado, cajero y personal. Creación/edición/desactivación: propietario y encargado. No hay eliminación que borre la asociación histórica.
- Venta `customer_id` es opcional; el cliente debe estar activo y pertenecer al negocio al crear una venta. La integración de caja/sincronización conserva el identificador sin guardar contactos del cliente en la cola offline.
- `GET /api/v1/customers/{id}/history` permite al propietario/encargado consultar ventas asociadas en la sucursal activa, con estado e importe original y devoluciones por separado; incluye anuladas y tiene paginación.
- No hay datos fiscales, campañas, crédito ni fidelización automática. Registrar únicamente contacto proporcionado por el cliente.

## Seguridad y despliegue

Migración `0070_customers_barcodes` sigue `0069_sales_pricing`. RLS forzado en clientes, claves compuestas de negocio en ventas y permisos sin DELETE para `kova_app`. Auditoría registra nombres de campos modificados sin contactos personales. Reversiones de migración se rechazan si existen clientes, códigos de barras o asociaciones a ventas.

Integración central requerida: registro de modelo/router, permisos, grants de fixtures/provisión, ruta `/customers`, navegación y OpenAPI regenerado. El agente de ventas integra selección del cliente y escáner en caja.

## Validación

Tests backend prueban idempotencia, búsqueda literal, edición/desactivación, permisos, aislamiento entre negocios, FK de asociación, historial con devoluciones/paginación, duplicados/borrado/importación de códigos y RLS real mediante `kova_app`. Tests frontend prueban creación, historial con devoluciones y gestión según permisos. Regresión catálogo/importación y TypeScript.

QA integrada: registrar cliente, crear producto con `000123`, escanear en caja, asociar venta online, revisar historial, desactivar cliente, confirmar que no se selecciona para nueva venta; repetir venta offline y sincronizar sin duplicados. Cambiar negocio y confirmar catálogo/clientes aislados; cambiar sucursal y confirmar historial local.
