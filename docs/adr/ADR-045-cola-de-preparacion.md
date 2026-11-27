# ADR-045 — Cola de preparación por estación para mostrador y pedidos

Estado: aceptada; implementación local (E7), publicación no acreditada.
Fecha: 2026-11-27.

## Contexto

Una cafetería cobra un latte en Caja y la barra necesita saber qué preparar, en qué orden y a quién
llamar. [ADR-014](ADR-014-customer-orders-domain.md) rechazó poner `kitchen_status` en `orders` y dejó
un KDS fuera de alcance; el dueño pidió ahora una cola de preparación con estaciones de barra y
cocina (frente G del brief).

## Decisiones del dueño (27-nov-2026)

- Disponible en **todos los planes** (Esencial, Gestión y Standard). No cambia precios.
- Entran **ventas de Caja y pedidos**.
- El cliente se llama con un **número corto del día** por sucursal (#1, #2…).

## Decisión

1. **Estaciones por negocio** (`prep_stations`): nombre y minutos para marcar una orden como
   tarde. Cada producto puede indicar su estación (`products.prep_station_id`). Sin estación, el
   producto no entra a la cola.
2. **Tickets separados de la venta:** una venta de Caja con productos de estación crea un
   `prep_ticket` por estación, con el número del día (`prep_daily_numbers`, por sucursal y fecha
   local). La venta financiera no cambia de significado; ADR-014 se respeta.
3. **Los pedidos no se copian:** la cola los muestra con su propio estado (`confirmed` → recibido,
   `in_progress` → en preparación, `ready` → listo, `fulfilled` → entregado) y los cambios pasan
   por Pedidos. Entregar un pedido sigue exigiendo pago. Solo aparecen pedidos sin fecha o
   prometidos para hoy.
4. **Estados del ticket:**
   - El ticket avanza `received → preparing → ready → delivered`. Cualquiera que cobra avanza.
   - Regresar es corrección de gerencia y queda en auditoría.
   - Anular la venta cancela sus tickets.
5. **Offline:** una venta sincronizada más de 20 minutos después de cobrarse no entra: ya se
   preparó en mostrador.
6. **Entre dispositivos por consulta periódica** (cada 5 s con la pantalla visible), sin canal de
   tiempo real.

## Consecuencias

- La cola no conserva un estado por estación para pedidos: un pedido con barra y cocina avanza
  junto en ambas.
- Cambiar la estación de un producto cambia en qué estación se ven sus artículos en tickets
  abiertos.
- Pendiente: impresión de comandas, mesas y cuentas abiertas siguen fuera de alcance
  ([alcance diferido](../deferred-scope.md)).
