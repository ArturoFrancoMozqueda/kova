# Conciliación de depósitos y liquidaciones

## Estado y gate

Especificado, no implementado. Requiere muestras anonimizadas de al menos un formato bancario o de
terminal usado por pilotos, política de matching aprobada y entrada explícita en sprint. No procesa
tarjetas, no mueve dinero y es independiente de Stripe Billing.

## Resultado y alcance

Owner o manager importa un estado de liquidaciones, revisa sugerencias y confirma qué depósitos
corresponden a ventas registradas por transferencia o tarjeta manual. V1 no conecta banca abierta, no
almacena PAN/CVV y no marca coincidencias automáticamente sin confirmación humana.

## Modelo propuesto

- `reconciliation_import_batches`: `id`, `tenant_id`, `source_type`, `original_filename`,
  `content_sha256`, `parser_version`, `status` (`previewed`, `committed`, `failed`), `row_count`,
  `created_by_user_id`, timestamps.
- `settlement_entries`: `id`, `tenant_id`, `batch_id`, `external_reference_masked`, `settled_at`,
  `gross_amount`, `fee_amount`, `net_amount`, `currency`, `payment_method`, `raw_row_fingerprint`,
  `status` (`unmatched`, `partially_matched`, `matched`, `ignored`).
- `reconciliation_matches`: `id`, `tenant_id`, `settlement_entry_id`, `order_payment_id`,
  `matched_amount`, `status` (`suggested`, `confirmed`, `rejected`, `reversed`), `score nullable`,
  `reasons_json`, `confirmed_by_user_id nullable`, timestamps.

Montos usan `Decimal`; la suma confirmada no supera ni la entrada neta elegible ni el pago. Un match
siempre enlaza recursos del mismo tenant. El archivo original no se conserva por defecto; si producto
decide conservarlo, debe cifrarse, expirar y documentarse por separado.

## Importación y matching

- `POST /api/v1/reconciliation/imports/preview` recibe un archivo permitido, valida firma real,
  encoding, columnas, tamaño/filas y devuelve filas normalizadas y errores sin persistir matches.
- `POST /api/v1/reconciliation/imports/commit` requiere `Idempotency-Key`, hash de contenido,
  `parser_version` y selección explícita de filas.
- `GET /api/v1/reconciliation/entries` lista pendientes; `POST .../{id}/suggest` calcula candidatos.
- `POST /api/v1/reconciliation/entries/{id}/matches/{match_id}/confirm|reject|reverse` requiere
  idempotencia y motivo para reversa.
- Las sugerencias usan monto, método, ventana temporal y referencia enmascarada. Siempre muestran las
  razones; no mutan caja, orden ni pago hasta confirmación.
- Confirmar sólo cambia estado de conciliación y agrega vínculo/auditoría. No reescribe el método o total
  original de la venta.

## Seguridad, privacidad y auditoría

- Permisos: `reconciliation.read`, `reconciliation.import`, `reconciliation.confirm`.
- Owner/manager propuesto; cashier sin acceso. RLS y filtros tenant obligatorios.
- Rechazar archivos ejecutables, fórmulas activas, macros, cifrados, ZIP bombs y formatos no permitidos.
- No aceptar ni registrar PAN completo, CVV, credenciales, CLABE completa ni tokens de banca. Referencias
  se normalizan/enmascaran antes de logs y respuestas.
- Eventos: `reconciliation.batch.committed`, `match.confirmed/rejected/reversed`, con actor, import/match
  IDs, montos y motivo; nunca fila cruda.
- Replay idéntico devuelve batch/match original; misma key con hash o selección diferente devuelve `409`.

## Offline y conciliación de caja

V1 es online-only. El corte puede mostrar totales registrados por método y cuántos están conciliados,
pero una liquidación bancaria posterior no cambia el efectivo esperado ni reabre un turno. Ventas offline
se vuelven candidatas sólo después de sincronizarse al servidor.

## Aceptación

- Preview no persiste y reporta errores por fila; commit es atómico e idempotente.
- Importar dos veces el mismo archivo no duplica entradas aun con nombre distinto.
- Sugerencias deterministas nunca se confirman solas.
- Confirmación concurrente no sobreasigna entrada o pago.
- Reversa conserva historial y devuelve disponibilidad sin borrar el match.
- Tenant B no descubre batches, entradas, pagos ni matches de tenant A.
- Tests incluyen parser malicioso/corrupto, Decimal, RLS, concurrencia, privacidad de logs, BDD y E2E.
