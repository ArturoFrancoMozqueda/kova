# ADR-046 — Cupones con código, vigencia y límites

Estado: aceptada; implementación local (E8), publicación no acreditada.
Fecha: 2026-11-27.

## Contexto

Las cafeterías y panaderías lanzan promociones ("10% con VERANO10", "$20 en tu primera compra").
Kova solo tenía el descuento manual de gerencia y las recompensas de lealtad.

## Decisiones del dueño (27-nov-2026)

- Los cupones van en **Gestión y Standard**, junto con lealtad; Esencial no los ve.
- **Cualquier cajero** aplica un cupón válido; crear y pausar cupones es de gerencia.
- **Un descuento por venta:** cupón, recompensa de lealtad o descuento manual.

## Decisión

1. **`coupons` por negocio:**
   - Código único en mayúsculas.
   - Porcentaje (0–100) o monto fijo sobre la venta completa, antes de impuestos.
   - Compra mínima, vigencia, usos totales y usos por cliente opcionales.
2. **El servidor calcula el descuento:**
   - `POST /api/v1/coupons/checkout` recalcula el subtotal con el catálogo, valida el cupón con su
     fila bloqueada y crea la venta en la misma transacción. El cajero no escribe montos, por eso no
     necesita `orders.discount`.
   - Si el descuento difiere del que vio el cajero, responde 409.
   - El cobro sigue el patrón y la recuperación de las recompensas: solo en línea, con la
     referencia guardada en el dispositivo.
3. **`coupon_redemptions`** liga cada uso con su venta. Anular la venta libera el uso; una
   devolución no lo libera.
4. **Plan:** las rutas de escritura de cupones se asignan a la función `loyalty`, sin cambiar el
   catálogo de planes ni sus precios.

## Consecuencias

- Fuera de alcance: cupones por producto o categoría, combinables o automáticos, y su
  aplicación offline.
- El recibo y la venta muestran el código del cupón junto al descuento.
