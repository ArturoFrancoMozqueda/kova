# Especificación: Dividir la cuenta por persona

## Problema

Un grupo de amigos pide en mostrador y cada quien quiere pagar lo que consumió, con su propio medio.
"Dividir pago" ya reparte una venta entre medios, pero no dice quién consumió qué ni cuánto le toca
a cada persona.

## Decisión del dueño (27-nov-2026)

Cada quien paga lo suyo; queda **una sola venta con un solo ticket** que muestra la parte de cada
persona. Aplica en Caja y al cobrar pedidos.

## Reglas

- Cada artículo y cada pago llevan `split_group`, la persona del 1 al 20. Lo llevan todos o
  ninguno: una venta sin división conserva su forma y su hash idempotente.
  - **Caja:** en `POST /api/v1/orders` y en la sincronización offline, cada línea indica su
    persona. Varias unidades de un producto pueden ir a personas distintas como líneas separadas.
  - **Pedidos:** en `POST /api/v1/customer-orders/{id}/checkout`, `item_groups` indica cuántas
    unidades de cada artículo toma cada persona. Deben cubrir todas las unidades (`SPLIT_INCOMPLETE`).
- **Lo que paga cada persona** es la suma de sus líneas tal como el servidor reparte la venta:
  - Caja: descuento e impuesto repartidos por línea con redondeo acumulado.
  - Pedidos: el total de cada artículo repartido por unidades, menos su parte del anticipo, que se
    reparte según lo que consumió cada quien.
  - Los pagos de cada persona deben sumar exactamente eso ("La persona N debe pagar $X"). No se
    acepta un pago de una persona sin artículos.
- El anticipo aplicado de un pedido aparece como pago sin persona.
- **El recibo** agrupa las líneas por persona con su subtotal, y cada pago dice "Persona N ·
  medio". La venta sigue siendo una: devoluciones, reportes, turno y cajón no cambian.
- **Rollback:** la migración `0116_split_bill` es aditiva; el downgrade se niega si ya hay
  cuentas divididas.

## Interfaz

- **Caja:** "Dividir cuenta" junto a "Dividir pago"; se excluyen entre sí.
  - Se eligen las personas (2 a 8) y a quién va cada unidad.
  - Cada persona ve su total y paga con su medio (efectivo con cambio, transferencia o tarjeta).
  - No está disponible al canjear una recompensa.
- **Pedidos:** "Dividir cuenta: cada quien paga lo suyo" en el cobro. Muestra lo que cada persona ya
  cubrió con el anticipo.
- El cálculo del navegador replica el del servidor al centavo: `frontend/src/register/splitBill.ts`.

## Escenarios

```gherkin
Escenario: Tres amigos pagan cada quien lo suyo
  Dado un latte para Ana, un latte para Beto y un sándwich para Carla con $18 de descuento
  Cuando cada quien paga su parte con su medio
  Entonces Ana paga $49.50, Beto $49.50 y Carla $63.00
  Y queda una sola venta de $162.00 con un ticket que muestra a cada persona

Escenario: El anticipo de un pedido se reparte por lo que consumió cada quien
  Dado un pedido de dos pasteles de $300 con $150 de anticipo
  Cuando cada amigo toma un pastel
  Entonces cada uno paga $225
```

Regresiones: `backend/app/tests/test_split_bill.py`, `migration_tests/test_0116_split_bill.py`,
`frontend/src/register/splitBill.test.ts`, `SplitBillPanel.test.tsx`, `RegisterView.test.tsx`
("splits the bill…"), `CustomerOrderCheckoutRegister.test.tsx` y `ReceiptTemplate.split.test.tsx`.
