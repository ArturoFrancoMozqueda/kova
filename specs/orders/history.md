# Historial de ventas

Ventas permite consultar todos los registros autorizados de la sucursal activa,
con filtros de estado y fechas y páginas de 50 registros. El total corresponde
a todos los registros que cumplen los filtros; los botones Anteriores y
Siguientes muestran el alcance de la página actual y sus límites.

La API ordena el conjunto completo antes de paginar. Acepta `sort` con valores
`created_desc` (predeterminado), `created_asc`, `amount_desc` y `amount_asc`.
Los empates usan fecha de venta e identificador interno para mantener un orden
estable. Cambiar fechas, estado o criterio de orden vuelve a la primera página.
Los filtros de fecha y el orden cronológico usan la fecha efectiva de la venta,
incluidas las ventas offline sincronizadas después.

Búsqueda: `q` (2 a 80 caracteres) encuentra ventas por folio del ticket o por
cliente y se combina con estado, fechas y orden; el total y la paginación
corresponden a lo encontrado. El folio son los últimos 8 caracteres
hexadecimales del recibo; se acepta completo, con `#`, en minúsculas o sólo sus
últimos 4 a 7 dígitos. El folio completo usa el índice `ix_orders_tenant_folio`.
Por cliente busca nombre, teléfono o correo sin distinguir mayúsculas (los
acentos sí cuentan); `%` y `_` se tratan como texto. Cada fila trae
`receipt_number` y `customer_name` para reconocer la venta. Nombres y búsqueda
por cliente sólo aplican a roles con `customers.view`; los demás buscan por
folio.

El historial conserva sesión, acceso comercial, permisos, tenant y sucursal.
La interfaz distingue carga, error y ausencia de registros y no mezcla páginas
anteriores con filtros nuevos. La paginación no modifica ventas ni inventario.

Regresiones: `backend/app/tests/test_order_list_pagination.py` cubre más de 50
ventas, cuatro criterios, empates e identidad/sucursal;
`backend/app/tests/test_order_search.py` cubre folio, cliente, comodines,
aislamiento entre negocios y uso del índice; `OrderListView.test.tsx`
cubre navegación, límites y reinicio de página al cambiar filtros/orden.
