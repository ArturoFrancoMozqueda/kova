# ADR-014: Pedidos operativos separados de ventas financieras

## Estado

Aceptado — 2026-08-12.

## Contexto

Una venta inmediata y un compromiso pendiente tienen ciclos de vida distintos. Agregar
`kitchen_status` a `orders` haría que una venta financiera también representara preparación,
entrega y reservas; además no cubriría retail, servicios por encargo o entregas y permitiría que
trabajo todavía no cobrado contaminara ingresos, turnos y reportes.

## Decisión

- `customer_orders` representa compromisos operativos; `orders` conserva exclusivamente ventas
  financieras.
- Caja mantiene ventas inmediatas. Pedidos usa su propia bandeja y detalle. El historial existente
  se presenta como Ventas, conservando `/orders` y `/api/v1/orders`.
- El pedido congela precio, nombre y modificadores, reserva inventario al confirmar y deriva el
  pago de una venta vinculada opcional.
- Checkout reutiliza una primitiva interna de persistencia financiera en una sola transacción; no
  hace llamadas HTTP entre APIs.
- Estado operativo y pago son ejes independientes. Entregado y Cancelado son terminales, y
  Entregado requiere pago completo.
- El rollout usa `customer_orders`, apagado por defecto y no asociado a otro plan de pago.
- Offline es consulta de caché por tenant. No se introduce una segunda cola de sincronización.

El diseño de `kitchen_status` sobre `orders` queda sustituido. Un KDS especializado continúa fuera
de alcance y, si se construye, deberá consumir pedidos operativos en lugar de cambiar el significado
de las ventas.

## Consecuencias

Pedidos sirve a comida, retail y trabajo por encargo sin convertir Kova en un sistema especializado
de restaurante. El costo es un dominio adicional con control explícito de concurrencia, reservas,
idempotencia y una conversión transaccional. A cambio, reportes, recibos, caja e inventario mantienen
una única fuente financiera y compatibilidad con ventas existentes.
