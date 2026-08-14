# Evidencia de remediación OFF — 2026-08-13

## Alcance

Esta entrega implementa OFF-1 a OFF-5 del plan de remediación. OFF-6 sigue como pendiente
externo: este repositorio no contiene evidencia de un drill en staging con una PWA instalada,
tenant desechable, corte real de red y conciliación posterior de stock, turno y reportes.

## Contrato de ownership

- Toda venta nueva exige `tenant_id`; el valor proviene del tenant autenticado de `AuthContext`,
  no de controles de UI ni del payload de la venta.
- `client_uuid` se conserva como clave física y como identidad de idempotencia enviada al backend.
  `tenant_id + client_uuid` es la identidad lógica usada por lecturas y mutaciones locales.
- La escritura usa `add`, no `put`: una colisión de UUID falla sin sobrescribir otra venta.
- Las filas de bundles anteriores que no tienen tenant se conservan con payload, recibo, turno,
  intentos y fechas, pero pasan a `quarantined`. Ninguna consulta normal ni worker incluye ese
  estado. No se asignan al siguiente tenant que inicia sesión.
- Compatibilidad PWA: Dexie v4 abre bases v1-v3 y ejecuta una migración local. No se debe publicar
  un downgrade que quite el contrato de ownership. La recuperación guiada de cuarentena queda
  fuera de esta entrega; debe probar ownership antes de exportar o reconciliar.

## Migración y lease

- Dexie v4 añade índices `tenant_id`, `[tenant_id+status]`, `[tenant_id+updated_at]` y `lease_id`.
- Un claim transaccional establece `sync_owner`, `lease_id`, `sync_started_at`, incrementa el
  intento y cambia a `syncing` antes del request.
- El lease vence a los dos minutos. Al iniciar un sync, solo los leases vencidos del tenant actual
  regresan a `pending`; un lease activo de otra pestaña no se roba.
- Toda respuesta modifica la fila únicamente si coinciden tenant, UUID y lease. Una respuesta
  tardía de un owner anterior no puede marcar como sincronizada una fila reclamada de nuevo.
- Un cambio/logout de sesión desmonta timers, aborta requests activos y evita nuevos requests del
  tenant anterior. Los contadores, fallidas, reintentos y recibos visibles están acotados al tenant.
- `429` vuelve a pending sin consumir el intento y respeta `Retry-After`; errores de red y 5xx son
  reintentables; 4xx y resultados por venta fallidos van a dead-letter. El UUID no cambia.

## Pruebas y checks

Evidencia local ejecutada en Windows, rama `feature/audit-offline-remediation`:

- `npm run typecheck`: verde.
- `npm run lint`: verde.
- Vitest focalizado (`src/offline`, `RegisterView.test.tsx`, `App.test.tsx`): 7 archivos,
  41 pruebas verdes.
- Cobertura nueva: migración legacy a cuarentena; 1,001 filas; base recreada; tenant A/B;
  colisión UUID fail-closed; dos workers; lease vencido tras crash; respuesta tardía; cambio de
  tenant antes de request; logout durante request; receipt/idempotencia existentes preservados.
- Playwright `e2e/offline-sync.spec.ts --project=chromium`: 7/7 verdes; incluye navegador
  compartido A/B, cold offline, dead-letter/reintento, recibo local y UUID idempotente. Los
  requests auxiliares no mockeados del entorno local emitieron `ECONNREFUSED`, pero el endpoint de
  sync estuvo interceptado y sus aserciones fueron verdes.
- Verificación posterior al merge en `main`: `offline-sync.spec.ts` + `reports.spec.ts`, 17/17
  verdes. Los selectores de estados `Pendientes` y `Fallidas` exigen el encabezado exacto para no
  confundirlos con “Sin ventas pendientes o fallidas”; el caso de error de red prueba tanto el
  reintento automático como el manual y exige una segunda llamada con la misma venta.
- `npm run build`: verde, incluida compilación TypeScript, bundle cliente/SSR y prerender.

## Limitaciones y gates abiertos

- OFF-6 no está ejecutado ni cerrado. Requiere staging autorizado, PWA instalada y dos tenants
  desechables sin PII; se deben registrar fecha, commit desplegado, navegador/SO, UUID anonimizado,
  request IDs, conciliación de orden/stock/turno/reportes y limpieza.
- La cuarentena se conserva deliberadamente pero aún no tiene UI de recuperación. Esto evita
  pérdida o atribución insegura; cualquier flujo futuro debe verificar ownership fuera del valor
  aportado por el usuario.
- La suite local no sustituye el gate de CI ni un drill de cierre abrupto del proceso del navegador.
