# Conciliación de depósitos y liquidaciones

## Estado y gate

Implementación local del 2026-10-18: importación manual en el formato CSV canónico de Kova,
preview, selección explícita, ledger idempotente y coincidencias revisadas por owner/manager.
No acredita publicación ni compatibilidad con los formatos propios de bancos o terminales. Esos
adaptadores siguen requiriendo muestras anonimizadas y política específica. No procesa tarjetas,
no mueve dinero y es independiente de Stripe Billing.

## Resultado y alcance

Owner o manager importa un estado de liquidaciones, revisa sugerencias y confirma qué depósitos
corresponden a ventas registradas por transferencia o tarjeta manual. V1 no conecta banca abierta, no
almacena PAN/CVV y no marca coincidencias automáticamente sin confirmación humana.

## Modelo implementado

- `reconciliation_import_batches`: tenant/sucursal, hash normalizado de la selección,
  versión de parser, origen `manual_csv`, conteo, actor y fecha. Sólo persiste lotes confirmados;
  preview y fallos no crean registros. No conserva nombre ni archivo original.
- `settlement_entries`: tenant/sucursal, lote, referencia ya enmascarada, fecha, importes bruto,
  comisión y neto, moneda, método y hash de fila. Su estado se deriva de las asignaciones confirmadas,
  sin una segunda fuente de verdad mutable.
- `reconciliation_matches`: tenant/sucursal, entrada, venta/pago ligados mediante FK compuestas,
  importe asignado, estado `suggested/confirmed/rejected/reversed`, versión, razones deterministas,
  actor de confirmación, motivo de reversa y fechas. Nunca conserva referencia bancaria cruda.

Montos usan `Decimal`; la suma confirmada no supera ni la entrada neta elegible ni el pago. Un match
siempre enlaza recursos del mismo tenant. El archivo original no se conserva por defecto; si producto
decide conservarlo, debe cifrarse, expirar y documentarse por separado.

## Formato manual y contrato de importación

CSV UTF-8, máximo 256 KiB y 500 filas; encabezado exacto:

```csv
settled_at,gross_amount,fee_amount,net_amount,currency,payment_method,reference
```

`settled_at` es ISO 8601 con zona horaria. Moneda `MXN`; métodos `bank_transfer` o `manual_card`.
Importes decimales no negativos con máximo dos decimales, bruto y neto positivos;
`gross_amount - fee_amount = net_amount`. Referencia ya enmascarada como `***1234`, nunca
PAN/CLABE completos; se rechazan más de cuatro dígitos seguidos. No acepta fórmulas, HTML,
contenido binario, macros ni otros formatos. Los mensajes de error no repiten celdas sensibles.

- Preview: JSON `{csv_content}`. Devuelve `parser_version:1`, `content_sha256`, filas normalizadas
  con `row_number` desde 2, `row_fingerprint`, y errores por fila. No persiste nada.
- Commit: JSON `{csv_content, content_sha256, parser_version:1, selected_rows:[2,...]}` y
  `Idempotency-Key`. Exige preview sin errores y hash vigente; importa sólo las filas elegidas.
- Reimportar selección idéntica con otra clave devuelve el lote existente. Una fila ya importada
  dentro de otra selección causa 409 y rollback completo; se debe excluir de la selección nueva.
- El listado `GET /entries?limit=50&offset=0` devuelve `{entries,has_more}`. Cada entrada incluye
  estado derivado, importe asignado, saldo y lista de sugerencias/confirmaciones históricas.
- `POST /entries/{id}/suggest`, cuerpo `{}`, requiere idempotencia; sugiere hasta veinte pagos
  del mismo método y sucursal en ventana de siete días anteriores a un día posterior al depósito.
  Explica coincidencia de bruto, referencia o asignación parcial. No confirma automáticamente.
- `POST /entries/{id}/matches/{match_id}/confirm|reject|reverse`, cuerpo `{expected_version,reason?}`,
  exige idempotencia. La reversa necesita motivo de tres a doscientos caracteres, tratado como texto
  privado; la auditoría registra que existe un motivo, sin copiarlo.

Una coincidencia asigna neto liquidado. Las comisiones se muestran separadas y no crean un gasto
ni reescriben el valor del pago. Una coincidencia revertida/rechazada conserva historial; el saldo
liberado puede conciliarse con otras entradas. Las sugerencias vigentes se recalculan con nueva
versión cuando cambia disponibilidad.

## Matching y extensiones futuras

- `POST /api/v1/reconciliation/imports/preview` recibe exclusivamente el CSV manual descrito;
  no pretende detectar firmas de formatos bancarios propietarios.
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

- Owner/manager con permiso existente `settings.manage` y acceso comercial; cashier/staff sin acceso.
  No se añaden seeds de roles. Separar permisos finos es una extensión de contrato futura.
- RLS ENABLE/FORCE, filtros tenant/sucursal y FK compuestas obligatorios. Locks advisory
  transaccionales por entrada/pago serializan asignaciones concurrentes sin conceder UPDATE al
  ledger inmutable de pagos. Las entradas y lotes admiten sólo SELECT/INSERT en el rol runtime.
- Rechazar archivos ejecutables, fórmulas activas, macros, cifrados, ZIP bombs y formatos no permitidos.
- No aceptar ni registrar PAN completo, CVV, credenciales, CLABE completa ni tokens de banca. Referencias
  se normalizan/enmascaran antes de logs y respuestas.
- Eventos: `reconciliation.batch.committed`, `match.confirmed/rejected/reversed`, con actor, import/match
  IDs, montos y motivo; nunca fila cruda.
- Replay idéntico devuelve batch/match original; reutilizar una key con otro cuerpo devuelve `400`
  conforme al ledger idempotente compartido. Los conflictos de versión/asignación devuelven `409`.

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
