# Especificación: Cola de preparación

Decisión y razones en [ADR-045](../../docs/adr/ADR-045-cola-de-preparacion.md). Disponible en todos
los planes.

## Problema

En mostrador se cobra antes de preparar. Barra y cocina necesitan ver qué sigue, desde cuándo espera
y a quién llamar, sin que el ticket de preparación cambie la venta ni duplique el estado de un
pedido.

## Estaciones

- **Endpoints:**
  - `GET /api/v1/prep-stations` (`orders.create`).
  - `POST /api/v1/prep-stations` y `PATCH /api/v1/prep-stations/{id}` (`catalog.update`).
- **Campos:** nombre (único entre estaciones activas, sin importar mayúsculas), `alert_minutes`
  (1–240, 8 por omisión), `position` e `is_active`.
- Desactivar una estación no borra su historial; sus productos dejan de entrar a la cola.
- **Producto:** `prep_station_id` en el alta y la edición. Solo acepta una estación activa del
  negocio; sin estación el producto no se prepara.

## Cola

`GET /api/v1/prep-queue` (`orders.create`) devuelve las estaciones activas y las tarjetas de la
sucursal activa, ordenadas por hora prometida o de llegada:

- **Venta de Caja (`kind = sale`):**
  - Al cobrar, cada estación con productos recibe un ticket con el número del día de la sucursal.
  - El número reinicia cada día local y lo comparten todas las estaciones de esa venta.
  - El recibo lo muestra como "Orden #N" (`prep_number`).
- **Pedido (`kind = customer_order`):**
  - Solo con el módulo de Pedidos activo, y si el pedido está confirmado, en preparación o listo y
    no tiene fecha o está prometido para hoy.
  - Se muestra con su folio, cliente, estado de pago y estado propio. No existe un ticket para él.
- Cada tarjeta trae sus artículos de esa estación, con modificadores y notas.
- Las entregadas siguen visibles 15 minutos para corregir.

## Estados

`POST /api/v1/prep-queue/tickets/{id}/status` con `version` y `status`:

- **Avanzar:** `received → preparing → ready → delivered`, también saltando pasos. Lo hace
  cualquier rol que cobra.
- **Regresar:** solo `owner`/`manager`. Borra las marcas de tiempo posteriores y queda en auditoría
  (`prep.ticket.reopen`).
- **Reintento:** repetir el estado actual devuelve la tarjeta sin cambios.
- **Concurrencia:** una versión vieja responde 409.
- **Ventas anuladas:** su ticket queda `cancelled` y sale de la cola.
- **Pedidos:** sus tarjetas cambian con `POST /api/v1/customer-orders/{id}/status`. Entregar exige
  pago, por lo que la cola ofrece "Cobrar en Caja".

## Offline

- Sin conexión la pantalla avisa que no se actualiza y bloquea los cambios.
- Una venta offline sincronizada más de 20 minutos después de cobrarse no entra a la cola.

## Seguridad

- `prep_stations`, `prep_daily_numbers` y `prep_tickets` tienen RLS forzado por tenant y FKs
  compuestas.
- `kova_app` solo inserta y actualiza las columnas de flujo; no puede borrar.

## Escenarios

```gherkin
Escenario: Un latte cobrado en Caja llega a la barra con su número
  Dado que "Latte" se prepara en "Barra" y "Sándwich" en "Cocina"
  Cuando se cobra un latte y un sándwich en Caja
  Entonces la venta recibe el número 1 del día
  Y Barra muestra "#1" con el latte y Cocina "#1" con el sándwich
  Y el recibo muestra "Orden #1"

Escenario: Solo gerencia corrige una orden entregada
  Dado una orden "#3" entregada
  Cuando un cajero intenta regresarla a "Listo"
  Entonces se rechaza
  Y cuando una gerente la regresa queda en auditoría

Escenario: Un pastel prometido para mañana no aparece hoy
  Dado un pedido confirmado prometido para mañana
  Entonces no aparece en la cola de hoy
```

Regresiones: `backend/app/tests/test_prep_queue.py`, `migration_tests/test_0115_prep_queue.py`,
`frontend/src/prep/PrepQueueView.test.tsx` y `frontend/src/catalog/ProductForm.prepStation.test.tsx`.
