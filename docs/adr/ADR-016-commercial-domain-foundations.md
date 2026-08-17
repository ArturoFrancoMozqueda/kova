# ADR-016: Fundamentos de dominios comerciales

## Estado

Propuesto. Esta ADR define contratos para descubrimiento y futuras ramas; no activa funcionalidad.
La implementación continúa bloqueada por los gates de `PLAN-GROWTH-EXECUTION` y
`PLAN-KOVA-COPILOT`.

## Contexto

Descuentos, impuestos, compras, variantes y conciliación se cruzan en ventas, inventario, recibos,
reportes y operación offline. Agregarlos como campos aislados produciría totales históricos
mutables, inventario ambiguo y conciliaciones imposibles de auditar.

CFDI 4.0 exige información que no pertenece al ticket operativo. El SAT distingue datos del emisor,
receptor, conceptos, objeto de impuesto e impuestos; nombre, RFC, régimen y código postal del
receptor son datos fiscales estructurados. Por ello un snapshot fiscal de Kova no es un CFDI ni
debe presentarse como emitido sin timbrado confirmado por un PAC.

Referencias oficiales vigentes al redactar esta ADR:

- SAT, Formato de Factura (Anexo 20): https://wwwmatnp.sat.gob.mx/consultas/35025/formato-de-factura-electronica-%28anexo-20%29
- SAT, requisitos de factura: https://www.sat.gob.mx/minisitio/Factura/solicita_requisitos.htm
- SAT, artículo 29-A: https://wwwmat.sat.gob.mx/articulo/99662/articulo-29-a

## Decisión

1. El servidor conserva la autoridad sobre precios, descuentos, impuestos, costos y totales.
2. La venta guarda snapshots inmutables. Nunca reconstruye historia desde producto, variante, tasa o
   proveedor actuales.
3. El orden de cálculo es: precio/modificadores -> descuento de línea -> descuento de orden
   prorrateado -> base fiscal -> impuestos -> total.
4. Dinero usa `Decimal`; tasas y bases fiscales conservan hasta seis decimales y los totales de cobro
   se cuantizan a moneda conforme a una versión explícita del motor.
5. Modificadores siguen describiendo opciones sin identidad de inventario. Las variantes tienen SKU,
   precio, costo y stock propios.
6. Recepciones confirmadas escriben el ledger una sola vez. No se simulan compras mediante ajustes.
7. Conciliación bancaria importa liquidaciones; no procesa tarjetas y permanece separada de Stripe
   Billing conforme a ADR-008.
8. Las nuevas mutaciones son online-only en su primera entrega. La venta offline sin estas funciones
   no cambia. Habilitar descuentos, cambios fiscales, compras o conciliación offline requiere una
   versión posterior del contrato y pruebas de replay.
9. Toda tabla tenant-scoped incluye `tenant_id`, RLS forzado, `USING`/`WITH CHECK`, índices,
   referencias compuestas cuando eviten cruces de tenant, RBAC, auditoría e idempotencia.
10. Ninguna épica fiscal habilita CFDI. La emisión queda en una integración PAC asíncrona posterior.

## Consecuencias

- Descuentos preceden a impuestos y snapshots fiscales.
- Variantes preceden a inventario/compra por variante.
- Proveedores pueden entregarse antes que compras, pero una recepción no se habilita hasta cerrar la
  política de costo.
- Conciliación comienza con CSV de adquirente/banco y confirmación humana; el matching automático
  sólo propone.
- Las migraciones son expand/backfill/contract y aceptan clientes PWA anteriores durante el rollout.

## Gates de implementación

- Diez pilotos activos y alcance validado para descuentos/CFDI según el plan de crecimiento.
- Revisión fiscal de contador y PAC antes de congelar catálogos, precisión o reglas CFDI.
- Decisión escrita de costo (`último costo` o `promedio móvil`) antes de confirmar recepciones.
- Formato real de al menos un adquirente/banco antes de construir conciliación productiva.
- Evidencia de demanda antes de variantes; no usar variantes para adelantar multi-almacén.
