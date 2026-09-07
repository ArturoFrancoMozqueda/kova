# Estado de remediación integral de Kova

**Fecha:** 2026-09-07 (America/Mexico_City)

**Base de implementación revisada:** `e994136`

**Auditoría de origen:** [`KOVA_COMPREHENSIVE_AUDIT.md`](KOVA_COMPREHENSIVE_AUDIT.md)

**Backlog de aceptación:** [`KOVA_IMPROVEMENT_BACKLOG.md`](KOVA_IMPROVEMENT_BACKLOG.md)

Este documento registra el cierre posterior a la auditoría del commit `837cf3f`. El puntaje 51/100
de la auditoría es una medición histórica de ese commit y no se reescribe ni se presenta como el
estado actual. La remediación local no sustituye evidencia de proveedores o producción.

## Decisión de salida

La reauditoría independiente no encontró bloqueadores locales adicionales: los 36 hallazgos tienen
implementación, prueba o procedimiento local. Kova todavía no debe declararse listo para GA ni para
un despliegue productivo sin supervisión porque tres hallazgos conservan gates externos:

1. KOV-005: lifecycle real en Stripe test mode, incluyendo eventos cruzados y fuera de orden.
2. KOV-030: recuperación por fase de Fly y Vercel en un staging desechable.
3. KOV-031: restore real autorizado con RPO/RTO, roles, RLS, conteos, binarios y smoke. Es P1.

Hasta completar esos tres controles, la decisión correcta es **código local remediado; salida a
producción bloqueada por evidencia externa**.

## Matriz de los 36 hallazgos

`Cerrado local` significa que el comportamiento y su evidencia viven en el repositorio. `Gate
externo` significa que la corrección local existe, pero la aceptación de producción requiere operar
el proveedor o entorno real.

| ID | Estado | Evidencia principal |
|---|---|---|
| KOV-001 | Cerrado local | `cbd7ca6`, `86a59fd`: contexto tenant después de commit/rollback y lote offline `synced/failed/synced` con `kova_app`. |
| KOV-002 | Cerrado local | `9f6262c`: cantidades duplicadas de refund agregadas y límite por línea. |
| KOV-003 | Cerrado local | `9f9cdf9`, `40cca91`, `cb02c14`: cierre serializado contra movimientos, venta, refund y doble cierre. |
| KOV-004 | Cerrado local | `5590be3`: identidad financiera permanente, replay tras TTL, rechazo de hash distinto y concurrencia. |
| KOV-005 | Gate externo | `cf55471` converge familias localmente; falta ejecutar las secuencias temporales en Stripe test mode. |
| KOV-006 | Cerrado local | `de42036`: upgrade fiscal poblado, rollback inyectado, reconciliación y grants. |
| KOV-007 | Cerrado local | `250af40`: allowlist de export excluye notas Ops e información interna. |
| KOV-008 | Cerrado local | `250af40`: grafo de purga ordenado, aislado y fail closed. |
| KOV-009 | Cerrado local | `ef45243`: activación PWA diferida mientras existe una intención o formulario activo. |
| KOV-010 | Cerrado local | `f3ec133`: invalidación entre pestañas y rechazo de tenant obsoleto. |
| KOV-011 | Cerrado local | `e5cb8e5`: reintento manual reinicia presupuesto y conserva UUID/tenant. |
| KOV-012 | Cerrado local | `f3ec133`, `5057756`: reapertura offline segura y logout fail closed si IndexedDB falla. |
| KOV-013 | Cerrado local | `e5cb8e5`, `71e11b`: intención estable de refund ante respuesta perdida, auth y actualización PWA. |
| KOV-014 | Cerrado local | `de42036`, `3850a28`, `54e4d0f`: historia fiscal append only y grants mínimos. |
| KOV-015 | Cerrado local | `199075a`: stock de pedidos revalidado bajo locks ordenados. |
| KOV-016 | Cerrado local | `ae83c00`: venta offline tardía produce ajuste fiscal conciliable. |
| KOV-017 | Cerrado local | `9f6262c`, `ae83c00`: ledger fiscal conserva void, refund y exclusiones. |
| KOV-018 | Cerrado local | `9f6262c`: refund restaura únicamente el consumo original de inventario. |
| KOV-019 | Cerrado local | `9f9cdf9`, `5590be3`: movimientos de caja idempotentes y asociados al turno. |
| KOV-020 | Cerrado local | `199075a`, `53ecf67`, `3623314`: ventas y pedidos con orden inverso, stock, reservas e identidad bajo concurrencia PostgreSQL real. |
| KOV-021 | Cerrado local | `9911a83`, `1d6a5b8`: parámetros, DETAIL y variables locales fuera de logs/Sentry. |
| KOV-022 | Cerrado local | `250af40`: refund items exportados por ownership tenant safe y conciliados. |
| KOV-023 | Cerrado local | `9ce1581`, `9ad93e6`: reactivación única e invitaciones viejas, usadas, vencidas y concurrentes. |
| KOV-024 | Cerrado local | `9ce1581`: lock común de tenant conserva al menos un owner. |
| KOV-025 | Cerrado local | `3850a28`: 21 FKs compuestas, preflight poblado, backfill y rechazo cross tenant. |
| KOV-026 | Cerrado proveedor | Matriz real 1,296/1,296, A/B con dos tenants, roles Data API sin grants ni funciones y Data API deshabilitada; evidencia en `evidence/KOV-026-SUPABASE-EFFECTIVE-GRANTS-2026-09-07.md`. |
| KOV-027 | Cerrado local | `3850a28`, `54e4d0f`: 42 tablas por cuatro verbos, A/B, policies especiales, contextos y detección de policies permisivas. |
| KOV-028 | Cerrado local | `17a3297`: semántica cohorte/evento, cruce de medianoche y timezone conciliables. |
| KOV-029 | Cerrado local | `f9fe3c3`: cero numérico preservado en XLSX y CSV. |
| KOV-030 | Gate externo | `8e0f27f` cierra máquina de estados y simulación; falta ensayo Fly/Vercel en staging desechable. |
| KOV-031 | Gate externo P1 | El runbook es ejecutable; falta restore real fechado, smoke, RPO/RTO y evidencia del backup autorizado. |
| KOV-032 | Cerrado local | `5f747c1`: aviso sin payload, sin reasignación/sync, conciliación guiada y borrado explícito. |
| KOV-033 | Cerrado local | `4ca614a`: OpenAPI generado y contrato frontend sincronizado. |
| KOV-034 | Cerrado local | `8e0f27f`, `3c81bda`: suites dev/preview separadas, SEO ejecutado y prueba lazy estable. |
| KOV-035 | Cerrado local | `7a30109`, `c4dd1fa`: conteo de queries y 30 muestras before/after con p50/p95 e igualdad funcional. |
| KOV-036 | Cerrado local | `2946fdd`: índice canónico, arquitectura de auth corregida y documentos históricos identificados. |

Todos los commits indicados son alcanzables desde `main`. Los merges mantienen las remediaciones
separadas en ramas `feature/` y dejan visible su integración secuencial en el primer padre.

## Validación final local

La validación se ejecutó sobre Windows, Python 3.12, Node 24 y PostgreSQL 17 local. Para la última
certificación backend se creó una base vacía, se migró desde baseline hasta
`0067_runtime_grant_matrix` y se aprovisionó `kova_app` como rol `NOSUPERUSER NOBYPASSRLS`.

| Control | Resultado |
|---|---|
| Suite backend completa sobre la base recién migrada | **680 passed** |
| Migration tests, incluidos upgrades poblados y matriz RLS/grants | **4 passed** |
| Ruff backend | PASS |
| OpenAPI versionado | PASS |
| Frontend lint y typecheck | PASS |
| Vitest | **112 archivos, 522 tests passed** |
| Release contracts | **8 passed** |
| Build cliente + SSR + prerender + PWA | PASS; 5 rutas prerenderizadas, 118 entradas PWA |
| Playwright sobre preview de producción | **145 passed, 3 skipped**; los skips requieren stack real |
| Auditoría npm completa | 0 vulnerabilidades reportadas |
| Readiness de operaciones | PASS local; **10 unit tests passed** |
| Benchmark KOV-035 | Mejoras p95 de 44.0% a 56.9% en los cinco escenarios medidos |

Los warnings observados corresponden a la deprecación TestClient/httpx y a una clave JWT sintética
de tests. No se usaron secretos, proveedores ni bases del producto durante la validación local.

## Gates externos antes de producción

Registrar cada ejecución con fecha, commit, entorno, responsable y evidencia en el runbook
correspondiente:

- Stripe test mode: checkout, renovación, `past_due`, cancelación y eventos entre familias fuera de
  orden; comprobar entitlements y watermark final.
- Fly/Vercel staging: inyectar fallos en cada fase de release, comprobar recuperación y ejecutar los
  smoke/read-only checks antes de promoción.
- Restore: descargar un backup autorizado, verificar SHA-256, restaurar en destino desechable,
  aplicar roles/RLS, comparar conteos y binarios, ejecutar smoke y anotar RPO/RTO.
- Antes de ampliar clientes: completar entrega real de correo, SPF/DKIM/DMARC, QA en dispositivos,
  piloto controlado, soporte y revisión legal/comercial vigente.

Los procedimientos de operación están enlazados desde
[`engineering-operations-index.md`](../engineering-operations-index.md). No se debe marcar ninguno
de estos gates como aprobado usando sólo mocks, contratos versionados o una ejecución local.
