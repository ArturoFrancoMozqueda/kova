# Matriz de pruebas: dominios comerciales

Estado: diseño. Ninguna fila habilita implementación sin los gates del plan comercial.

| Dominio | Unit/golden | Integración Postgres | RLS/RBAC | Idempotencia/concurrencia | BDD/E2E | Offline/recuperación |
|---|---|---|---|---|---|---|
| Descuentos | fijo, porcentaje, prorrateo y residuos | orden+snapshot+refund atómicos | límites por rol, tenant ajeno 404 | replay y payload conflictivo | aplicar, denegar y ticket/reporte | control deshabilitado; venta simple continúa |
| Snapshot fiscal | precisión y agregación versionada | rollback de venta completa | snapshots sólo del tenant | una historia por orden | cambio de tasa no altera historia | sync resuelve versión o recovery |
| Impuestos | inclusivo, exclusivo, exento, cero, múltiples componentes | vigencias y referencias compuestas | owner configura; cashier no | quote/create consistentes | perfil, venta y recibo | configuración online; no inventar tasa |
| Proveedores/compras | estados, cantidades y costo Decimal | recepción parcial y ledger atómicos | permisos read/write/receive | doble confirmación y sobre-recibo | OC→recepción→kardex | lectura/confirmación online-only |
| Variantes | combinación, precio, stock y SKU únicos | migración/backfill e inventario por variante | IDs cruzados 404 | venta/ajuste concurrente | scan, selector teclado/móvil, refund | cache versionada y replay por variant ID |
| Conciliación | parser, fingerprint y matching determinista | batch/matches atómicos | privacidad, import/confirm separados | archivo repetido y doble asignación | preview→sugerir→confirmar/revertir | sólo ventas ya sincronizadas |

## Gates no funcionales comunes

- `npm run typecheck`, lint frontend/backend y `npm run check:api-contract`.
- Migración upgrade/downgrade, un único head Alembic y tests con rol `kova_app`.
- Logs inspeccionados para no exponer RFC, notas, archivos crudos, cuenta, PAN/CVV o secretos.
- Playwright mocked y, donde aplique, staging con navegador móvil/teclado/impresora.
- Reporte/ticket/export reconcilian exclusivamente desde snapshots históricos.
- Prueba de PWA anterior durante rollout expand/backfill/contract.

## Evidencia de salida

Cada rama futura actualizará esta matriz con comando exacto, número de pruebas, QA manual y riesgos no
verificados. Un test bloqueado por infraestructura se reporta; no se cambia la expectativa para hacerlo
pasar.
