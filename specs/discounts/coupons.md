# Especificación: Cupones

Decisión y razones en [ADR-046](../../docs/adr/ADR-046-cupones.md). Plan Gestión y Standard.

## Gestión (`orders.discount`: dueño y gerente)

- `GET /api/v1/coupons` lista los cupones con sus usos vigentes (`orders.create`).
- `POST /api/v1/coupons` crea un cupón:
  - Código: 3 a 32 letras, números, `-` o `_`; se guarda en mayúsculas.
  - Tipo: `percent` (0–100) o `amount`.
  - Opcionales: descripción, compra mínima, `starts_at`/`ends_at`, `max_uses` y
    `max_uses_per_customer`.
- `PATCH /api/v1/coupons/{id}` cambia reglas o pausa/reactiva con `version` (409 si cambió). El
  código y el tipo no cambian.

## En Caja (cualquier rol que cobra)

- **Vista previa:** `POST /api/v1/coupons/preview` con el código y el carrito devuelve el subtotal y
  el descuento calculados por el servidor.
- **Motivos de rechazo,** en lenguaje claro: pausado, aún no vigente, vencido, compra mínima, límite
  de usos, cliente requerido, cliente que ya lo usó, código inexistente.
- **Cobro:** `POST /api/v1/coupons/checkout` con `code`, la venta y `expected_discount`.
  - Requiere `Idempotency-Key` y bloquea el cupón.
  - Recalcula subtotal y descuento: porcentaje redondeado al centavo, o monto con tope en el
    subtotal.
  - Crea la venta con ese descuento y registra el uso. Repetir la clave devuelve la misma venta.
  - Respuestas de error: 409 si el descuento cambió y 400 si la venta trae otro descuento.
- **Un descuento por venta:** con cupón no hay descuento manual ni recompensa. La venta y el recibo
  muestran "Descuento · Cupón CÓDIGO".
- **Solo en línea.** Si la respuesta se pierde, Caja conserva la referencia y consulta el
  resultado sin volver a cobrar.
- Al cambiar el carrito o el cliente hay que volver a aplicar el cupón.
- **Anular la venta** libera el uso (`status = released`); una devolución no lo libera.

## Seguridad

- `coupons` y `coupon_redemptions` tienen RLS forzado y FKs compuestas.
- `kova_app` solo actualiza las reglas del cupón y el estado del uso; el código y los montos
  registrados no se reescriben.

## Escenarios

```gherkin
Escenario: Un cajero aplica un cupón que calcula el servidor
  Dado el cupón VERANO10 de 10% y un carrito de $110
  Cuando el cajero aplica "verano10" y cobra
  Entonces la venta tiene $11 de descuento y el ticket dice "Cupón VERANO10"

Escenario: Un cupón de un solo uso vuelve a estar disponible si se anula la venta
  Dado el cupón UNAVEZ con un uso permitido ya usado
  Cuando se anula esa venta
  Entonces el cupón se puede usar otra vez
```

Regresiones: `backend/app/tests/test_coupons.py`, `migration_tests/test_0117_coupons.py`,
`frontend/src/coupons/CouponsView.test.tsx` y `RegisterView.test.tsx` ("applies a coupon…").
