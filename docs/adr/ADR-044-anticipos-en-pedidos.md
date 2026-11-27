# ADR-044 — Anticipos en pedidos: dinero recibido antes de la venta

Estado: aceptada; implementación local (E6), publicación no acreditada.
Fecha: 2026-11-27.

## Contexto

Una pastelería cotiza un pastel, pide anticipo, lo prepara, lo entrega y cobra el resto. Hasta
ahora Pedidos solo admitía el cobro completo al final
([spec](../../specs/customer_orders/customer_orders.md)). Registrar el anticipo como venta contaría
el ingreso dos veces; no registrarlo deja el efectivo del turno descuadrado.

## Decisiones del dueño (27-nov-2026)

- El ingreso se reconoce **al liquidar**: la venta del pastel se registra una sola vez.
- Cada negocio decide si un anticipo de un pedido cancelado **se devuelve o se conserva**.
- Cada negocio decide si existe un **anticipo mínimo** para confirmar el pedido.

## Decisión

1. **Historial propio y solo de inserción:** `customer_order_deposits` con tres tipos.
   - `deposit` recibe dinero.
   - `refund` lo devuelve.
   - `retained` conserva el saldo de un pedido cancelado.
   - El saldo se calcula; no se guarda.
2. **El efectivo entra al turno cuando llega:** un anticipo en efectivo crea una entrada
   (`cash_in`) en el turno abierto, y una devolución en efectivo una salida (`cash_out`). Así el
   turno cuadra ese día con las fórmulas existentes. Transferencia y tarjeta no tocan la caja.
3. **La venta aplica el anticipo como pago ya cobrado:** al liquidar, cada medio con saldo crea un
   pago `deposit_applied = true` en la venta. Los cobros del día pagan solo el resto.
   - Los cálculos de efectivo esperado (turno, Panel y apertura del cajón) excluyen esos pagos,
     porque el dinero ya entró.
   - Reportes de ventas y por método de cobro los incluyen: la venta vale el total una vez.
4. **Anular la venta libera el anticipo:** si la venta liquidada se anula, el saldo vuelve a estar
   disponible y el pedido exige devolverlo o conservarlo al cancelarse.
5. **Política por negocio en `customer_order_settings`** (sin fila = sin mínimo y devolver):
   - `deposit_minimum_percent`: porcentaje del total requerido para confirmar.
   - `cancelled_deposit_policy`: `refund` o `retain`. Con `retain`, gerencia aún puede elegir
     devolver.
   - Cancelar con saldo exige gerencia (`owner`/`manager`) y una resolución explícita.
6. **Un anticipo conservado es ingreso del día de la cancelación, fuera de ventas:** el resumen de
   ventas lo muestra aparte (`retained_deposits`), sin tocar ventas brutas ni netas
   ([definiciones](../report-metric-definitions.md)).

## Consecuencias

- Una devolución parcial del anticipo es decisión de gerencia (`orders.refund`); recibir anticipos
  usa el permiso de cobrar pedidos.
- El anticipo no puede superar el total. Si el total baja después, el cobro exige devolver la
  diferencia primero.
- Conciliación bancaria sigue emparejando los pagos de la venta; un anticipo por transferencia se
  verá en la fecha de la venta, no en la del depósito. Pendiente si un negocio lo necesita.
- Sin CFDI de anticipo: las funciones fiscales siguen operando sobre la venta final.
- Durante un rollback a la versión anterior, esa versión contaría como efectivo del turno los
  pagos aplicados en efectivo; la migración es aditiva y el downgrade se niega si hay anticipos.
