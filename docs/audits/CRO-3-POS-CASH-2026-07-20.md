# Evidencia CRO-3 — Carrito POS sin ansiedad prematura

Estado: **validación local aprobada; pendiente de PR, Preview y verificación en producción**.

## Interacción del efectivo

- Con productos en el carrito y el campo intacto, Caja muestra una ayuda neutral: “Ingresa el
  efectivo recibido o elige un monto rápido.” El campo no se marca inválido y no aparece texto
  rojo.
- Un monto insuficiente, abandonar el campo vacío o intentar cobrar revela el faltante y el error
  específico. El mensaje está enlazado al input mediante `aria-describedby` y el campo recibe
  `aria-invalid` únicamente en ese estado.
- El CTA conserva la guarda financiera: cuando el efectivo no cubre el total, el submit se cancela
  antes de crear, encolar o sincronizar una venta. El control expone `aria-disabled` y el propio CTA
  acepta el intento para poder explicar por qué todavía no se puede cobrar.
- Un monto suficiente conserva el cálculo existente y muestra el cambio a entregar.

## Reinicio y medición

- Cambiar método de pago, activar o desactivar pago dividido, vaciar el carrito, completar una venta
  o iniciar una venta nueva limpia `touched`, `attempted` y la deduplicación de telemetría. Al vaciar
  el carrito también se descarta el efectivo capturado para no arrastrarlo a otra venta.
- `sale_validation_blocked` se emite solo después de interacción y una sola vez por ciclo de
  validación, con `field: "cash_tendered"` y `reason_code: "insufficient_cash"`.
- El evento usa el contexto CRO común (`device_class` y `viewport_bucket`) y no incorpora importes,
  productos, identificadores de orden ni otros valores capturados por el usuario.

## Validación local

- Vitest focal de Caja: 14/14; corrida de regresión de Caja, App y funnel: 30/30.
- TypeScript, ESLint focal y build de producción con prerender: verdes.
- Playwright de ventas existente: 5/5 en Chromium (efectivo, dividido, offline, turno y stock).
- Playwright mobile en Chromium: escenario CRO-3 aprobado en 320×844 y 390×844.
- El escenario móvil reduce además el viewport visual a 500 px para aproximar un teclado abierto:
  selector de pago y CTA siguen alcanzables dentro del sheet, sin quedar bajo la navegación.
- Antes de interacción no existe error ni evento; el intento bloqueado muestra el error y registra
  exactamente un evento categórico. Con una venta de $18.50 y $20.00 recibidos se muestran $1.50 de
  cambio y el CTA deja el estado bloqueado.
- La verificación de overflow horizontal pasa en ambos anchos.

## Seguridad, contratos y rollback

No hay cambios de backend, totales, cálculo monetario, payload de venta, idempotencia offline,
cookies, sesiones, permisos, billing, RLS, tenant ni esquema. No se modifican contratos públicos.
El rollback consiste en revertir el commit de CRO-3; restaura la validación roja inmediata y retira
la ayuda neutral y el estado de interacción.
