# Definiciones temporales de Análisis

Los reportes de ventas usan la zona horaria configurada del negocio y rangos de
fechas locales inclusivos. La hora de una venta es `orders.occurred_at` y, para
filas históricas sin ese dato, `orders.created_at`.

## Ventas y devoluciones: cohorte de venta

Los KPI de ventas seleccionan las ventas originadas dentro del rango. Para esas
ventas muestran:

- **Ventas brutas:** total actual de órdenes completadas de la cohorte.
- **Devoluciones:** todas las devoluciones de esas órdenes, aunque se hayan
  registrado después del rango.
- **Ventas netas:** ventas brutas menos esas devoluciones.
- **Motivos de devolución:** el mismo conjunto de devoluciones usado por el KPI.

Por esta razón, una devolución posterior corrige retrospectivamente el periodo de
la venta y sus motivos siempre concilian con el total mostrado. Ejemplo: una venta
de $100 del lunes devuelta el martes aparece el lunes como $100 bruto, $100
devuelto y $0 neto; el martes no se presenta como una venta ni como una devolución
de una venta originada ese día.

Esta definición también se usa para productos, horarios, métodos de cobro y
desempeño por persona. Un reporte histórico puede cambiar cuando se registra una
devolución válida después. Los movimientos físicos de efectivo conservan su hora
real en el turno donde se registraron y se concilian en Caja.

## Cancelaciones: fecha del evento

Una orden anulada deja de contar como venta completada. El contador de
cancelaciones se asigna al rango donde se registró la anulación, porque sirve como
señal operativa del momento en que ocurrió esa acción.

Esta distinción se muestra dentro de la sección de devoluciones y cancelaciones
para evitar interpretar ambos contadores como si compartieran la misma base.
