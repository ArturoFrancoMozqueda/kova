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

El historial conserva sesión, acceso comercial, permisos, tenant y sucursal.
La interfaz distingue carga, error y ausencia de registros y no mezcla páginas
anteriores con filtros nuevos. La paginación no modifica ventas ni inventario.

Regresiones: `backend/app/tests/test_order_list_pagination.py` cubre más de 50
ventas, cuatro criterios, empates e identidad/sucursal; `OrderListView.test.tsx`
cubre navegación, límites y reinicio de página al cambiar filtros/orden.
