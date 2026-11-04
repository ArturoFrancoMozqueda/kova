# KOV-005 — Portal básico interactivo de los tres planes

Aceptación sandbox **aprobada**, con navegador interactivo, consultas de lectura al proveedor y
PostgreSQL local desechable. Kova abrió Checkout y Portal mediante sus rutas normales, con
identidades sintéticas propias. No se forjó el entorno de GitHub ni se cambiaron las guardas del
drill de Actions. Esta evidencia describe la validación interactiva; no acredita éxito headless
ni aceptación operativa del dueño en un negocio real.

## Fuente por etapa

| Etapa | Fuente de Kova |
| --- | --- |
| Checkout y guardado efectivo del método de pago, tres planes | `8528431675423d2deefaf521fdb19b70121fb169` (#314) |
| Cancelación programada, acceso, reanudación Standard y rollback local OFF | `7032d21f60aafd21b65832f847b380d10e384b3c` (#315) |

El cambio #315 normaliza la representación de cancelación y endurece readiness; no modifica
Checkout ni el guardado del método de pago. Las fuentes se conservan por etapa, sin atribuir a
un único SHA pruebas realizadas en versiones distintas. En el corte previo `7032d21f60aa` se
verificó Standard/OFF. Esta entrega cambia la política a ON y el gate a `tiered`; su publicación
requiere release PASS y verificación externa, que se registran como evidencia separada.

## Contrato comprobado

| Plan | Precio sandbox MXN/mes | Capacidades exactas | Límite de originales de fotos | Sucursales |
| --- | --- | --- | --- | --- |
| Standard | $299 | Nueve | Sin nuevo límite asignado (`null`) | Sin nuevo límite asignado (`null`) |
| Esencial | $399 | Cuatro básicas | 250,000,000 bytes (250 MB) | Una |
| Gestión | $699 | Nueve | 1,073,741,824 bytes (1 GiB) | Una |

Las cuatro capacidades básicas coinciden exactamente con `pos`, `inventory`, `sales_reports` y
`public_catalog`. Standard y Gestión incluyen además `purchasing`, `advanced_reports`, `loyalty`,
`customer_orders` y `quotes`. No se atribuyen límites nuevos a Standard ni se interpretan sus
valores `null` como garantía de capacidad física ilimitada.

En Esencial y Gestión se verificó el precio inclusivo configurado. Standard conserva su acuerdo;
no se añadió una afirmación fiscal sobre su precio. La verificación inclusiva no acredita registro
fiscal, cálculo automático, CFDI ni aceptación contable.

Para **cada uno de los tres planes** se comprobó:

- Checkout pagado en modo de prueba, estado local `active`, plan, importe, funciones y acceso correctos.
- Portal abierto desde Kova, historial de facturas visible y ausencia de acciones para cambiar de plan.
- Método de pago guardado y efectivo, con precio y período pagado conservados.
- Cancelación programada al límite del período pagado, sin retirar acceso antes del vencimiento
  ni cambiar el estado comercial o las condiciones del plan.

Stripe devolvió `cancel_at_period_end=false` y una fecha explícita `cancel_at` que coincidió con
el límite pagado. Kova presentó correctamente su marca semántica normalizada
`cancel_at_period_end=true`. Se conservó la diferencia entre el booleano crudo del proveedor y
la representación de Kova; no se inventó una fecha usando caché ni `canceled_at`.

Standard también se reanudó desde el Portal. No se atribuye esa comprobación adicional a los
otros dos planes. Con nuevas ofertas apagadas localmente sobre `7032d21f60aa`, Gestión pagado
conservó acceso y capacidades. Esa comprobación local no es una recuperación de tráfico productivo.

## Limpieza

La limpieza concluyó: tres Customers sintéticos propios eliminados y tres suscripciones propias
canceladas; cero Customers ajenos modificados. El historial inmutable de PaymentIntents/Charges
pagados de prueba permanece en Stripe. No se afirma que esos pagos o su historial fueran borrados.

La limpieza local también concluyó sobre la fuente `7032d21f60aa`: frontend y backend detenidos,
contenedor PostgreSQL temporal eliminado, puertos de los servicios cerrados y cero listeners de
Stripe CLI. El worktree y la evidencia saneada se conservaron. La copia temporal de la clave de
prueba ya no está en el Secret store de GitHub; no se publican credenciales o rutas privadas.

El resultado saneado revisado contiene solo campos permitidos. Este documento no publica IDs del
proveedor o tenants, identidades, claves, contraseñas, cookies, datos de tarjeta ni URLs bearer.

## Límites

El alcance aceptado es Portal básico sandbox. No acredita una corrida headless aprobada, upgrade
o downgrade autónomo, cancelación efectiva tras transcurrir el período, cobro live real, recepción
histórica de riesgos live, revisión de Ops con MFA, validación fiscal, hardware, recuperación
regional ni operación de negocios al 100%. Los [tres riesgos live ya habilitados](../../runbooks/stripe-risk-review.md)
conservan pendiente el reenvío autorizado por el dueño y su recepción controlada.

La [guía comercial](../../runbooks/commercial-plan-acceptance.md) y
[ADR-021](../../adr/ADR-021-commercial-production-activation.md) conservan los gates de activación.
