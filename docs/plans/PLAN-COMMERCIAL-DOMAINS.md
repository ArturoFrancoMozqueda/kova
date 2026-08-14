# Plan de dominios comerciales de Kova

Estado: especificado; implementación bloqueada por gates. Este documento no mueve alcance a
`docs/current-sprint.md` ni marca trabajo como terminado.

## Objetivo

Entregar paridad comercial por vertical slices verificables sin debilitar dinero, tenant isolation,
offline ni la historia financiera.

## Secuencia y ramas futuras

| Orden | Rama propuesta | Resultado | Gate de entrada |
|---:|---|---|---|
| 0 | — | Pilotos y gates operativos cerrados | Planes vigentes de crecimiento/copiloto |
| 1 | `feature/epic-04a-discounts` | Descuento auditable, online, reflejado en ticket/reporte | 10 pilotos + política aprobada |
| 2 | `feature/epic-04b-fiscal-snapshots` | Venta con snapshot de cálculo inmutable | Épica 1 integrada |
| 3 | `feature/epic-04c-tax-engine` | Tasas configurables sin afirmar CFDI | Revisión contador/PAC |
| 4 | `feature/epic-04d-suppliers` | Directorio de proveedores tenant-scoped | Demanda validada |
| 5 | `feature/epic-04e-product-variants` | SKU/precio/stock por variante | Vertical y UX validados |
| 6 | `feature/epic-04f-purchasing-receiving` | OC y recepción parcial idempotente | Identidad de inventario + política de costo; variantes sólo si el slice las usa |
| 7 | `feature/epic-04g-bank-reconciliation` | Liquidaciones importadas y conciliadas | Formato real de proveedor |

CFDI/PAC no forma parte de estas ramas. Depende de snapshots e impuestos, y tendrá plan propio.

## Contratos transversales

### Datos y seguridad

- El tenant proviene de la sesión; ningún endpoint confía en `tenant_id` del payload.
- Nuevas tablas se agregan a `TENANT_SCOPED_TABLES`, habilitan y fuerzan RLS, y se prueban con
  `kova_app` y dos tenants.
- IDs relacionados se validan con pertenencia compuesta `(tenant_id, id)`.
- Catálogos SAT o del proveedor son versionados/read-only; configuración del comercio es tenant-owned.
- Auditoría guarda IDs, estados y diferencias categóricas; no certificados, cuentas completas ni PII
  fiscal innecesaria.

### Escrituras

- `POST` de negocio exige `Idempotency-Key`; replay mismo hash devuelve respuesta original y la misma
  clave con hash distinto falla `409`.
- Confirmación, recepción y conciliación bloquean filas relevantes para evitar doble aplicación.
- Registros confirmados son inmutables; correcciones usan cancelación o movimiento compensatorio.

### Dinero y reportes

- `Decimal`/`NUMERIC`, `ROUND_HALF_UP` y currency snapshot; sin floats.
- Reportes agregan snapshots, no configuración actual.
- Gross, descuento, base, impuesto, total, devolución y neto tienen definiciones separadas.
- Datos incompletos producen `null`/estado incompleto, nunca cero inventado.

### Offline

- Primer release: configuración y mutaciones nuevas online-only.
- La cola existente conserva ventas simples. Si una función no puede verificarse online, su control
  aparece deshabilitado con explicación, sin bloquear una venta sin esa función.
- Una futura versión de cola deberá snapshotear `pricing_engine_version`, variante e intención de
  descuento; el servidor seguirá recalculando y podrá enviar el caso a recuperación, nunca aceptará
  totales finales del cliente.

## Dependencias de esquema

```text
discount policy -> sale discount intent -> pricing snapshot
tax profile -----------------------------> fiscal line snapshots -> CFDI futuro
product -> product variant -> inventory identity -> purchase receipt
supplier -> purchase order -> goods receipt -> inventory movement + cost layer
payment -> settlement entry -> reconciliation match
```

## Gate común de salida por épica

- Spec y escenarios BDD aprobados.
- Migración upgrade/downgrade y backfill ensayados.
- OpenAPI y clientes frontend alineados.
- Unit/golden, BDD, tenant/RLS, permission, audit, idempotency y concurrencia verdes.
- Playwright del recorrido completo y estados mobile/error/offline.
- QA manual con datos reales de prueba; cero datos demo en producción.
- Riesgos y métricas actualizados sin declarar cierre de gates externos.

## Decisiones que no pueden asumirse

1. Límite de descuento por rol y si el cajero puede descontar.
2. Tasas/reglas fiscales predeterminadas: Kova no asumirá IVA 16% para todos.
3. Política de costo al recibir compras.
4. Si el stock de variante sustituye o convive con stock del producto padre.
5. Formatos, zona horaria y semántica de depósitos del adquirente/banco piloto.
6. Proveedor PAC, tarifa, sandbox, cancelación y custodia de CSD.
