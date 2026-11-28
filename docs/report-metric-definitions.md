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

## Anticipos de pedidos

Un anticipo no es venta: entra a la caja del turno cuando se recibe y la venta del pedido se cuenta
una sola vez, el día que se liquida, con el anticipo aplicado como pago ya cobrado
([ADR-044](adr/ADR-044-anticipos-en-pedidos.md)). Ventas brutas, netas y métodos de cobro usan esa
venta. Un anticipo **conservado** al cancelar un pedido es ingreso del día de la cancelación y el
resumen de ventas lo muestra aparte (`retained_deposits`, `retained_deposit_count`), sin sumarlo a
ventas.

## Cancelaciones: fecha del evento

Una orden anulada deja de contar como venta completada. El contador de
cancelaciones se asigna al rango donde se registró la anulación, porque sirve como
señal operativa del momento en que ocurrió esa acción.

Esta distinción se muestra dentro de la sección de devoluciones y cancelaciones
para evitar interpretar ambos contadores como si compartieran la misma base.

## Merma: fecha del movimiento

La merma valúa las salidas tipificadas (merma, caducidad, robo, daño, autoconsumo,
otro) registradas dentro del rango con el **costo por unidad que tenía el producto al
registrarlas** (`inventory_movements.unit_cost`, desde la migración `0118`), así que un
cambio de precio posterior no reescribe pérdidas pasadas. Los movimientos anteriores a ese
cambio, o los que no guardaron costo, usan el costo actual del producto, como antes. Si no
hay costo de ninguna de las dos formas, el total queda incompleto.

**Devoluciones que no regresaron al inventario** se muestran aparte y no cambian
ese total ni sus unidades. Son las unidades devueltas al cliente cuya venta descontó
existencias y que no se repusieron (`refund_items.quantity - restocked_quantity`),
ubicadas por la fecha de la devolución y valuadas con `order_items.unit_cost`, el
costo de la partida al vender. Se excluyen productos con lote (se reponen con
ajuste), servicios y devoluciones anteriores a que se guardara la reposición. El
margen sigue descontando la unidad devuelta de ventas y costo; esta línea hace
visible la pérdida física que antes no aparecía en ningún reporte.

## Costo de productos con receta

Para un producto preparado al vender, el costo de la partida (`order_items.unit_cost`) es la suma
de sus insumos según la receta vigente al cobrarse, con los ajustes de las opciones elegidas. Si
algún insumo no tiene costo, la partida queda sin costo y el margen se reporta incompleto, nunca
con costo cero. El consumo de insumos (`movement_type = 'consumption'`) cuenta para la cobertura
de inventario; no es merma ni venta del insumo.

## Producción por lote

Un lote descuenta sus insumos (`consumption`) y suma las piezas que salieron (`production`). El costo
por pieza es el costo de insumos del lote entre las piezas reales; sin costo si falta alguno.
«Piezas que no salieron en producción» en Merma son las piezas esperadas menos las reales de los
lotes registrados en el rango, valuadas con el costo de insumos del lote por pieza esperada. No
forman parte de la merma tipificada ni de sus unidades.

