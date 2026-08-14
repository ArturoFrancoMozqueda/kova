# Auditoría de remediación REL — 2026-08-13

## Alcance

Implementación de REL-1 a REL-4 sin desplegar, promover, leer secretos ni modificar el plan maestro.

## Evidencia por control

- **REL-1:** CI y scripts nombran por separado `integration`, `e2e-mocked` y
  `production-smoke`. El reporter productivo imprime ejecutadas/omitidas/fallidas y devuelve fallo
  con cero aprobadas o cualquier omitida. La configuración productiva exige URL y opt-in antes de
  descubrir casos.
- **REL-2:** todos los specs importan `e2e/fixtures.ts`; un fallback bloquea cualquier
  `METHOD URL` API fuera de los mocks del escenario y de una allowlist compartida, exacta y
  documentada para cargas secundarias/telemetría. `check-e2e-imports.mjs` evita bypasses futuros.
- **REL-3:** el workflow construye ambos artefactos desde `github.sha`, valida `version.json` y
  `/health.release_sha`, consulta `/health/db`, prueba el candidato Vercel contra el Fly recién
  desplegado y sólo entonces promueve sin rebuild. El image id previo de Fly alimenta rollback.
- **REL-4:** cobertura live de landing, login, refresh, billing read, catálogo, inventario, turnos,
  ventas, reportes y logout. Consola, page errors, requests fallidas, API 5xx y ausencia de
  `x-request-id` fallan. La venta sólo se ejecuta con autorización explícita, tenant/producto
  dedicados, UUID idempotente y referencia conciliable; no toca Stripe ni cancela suscripciones.

## Validación local

- `npm run typecheck`: aprobado.
- `npm run lint`: aprobado.
- `npm run test:release-contract`: 2 aprobadas, 0 omitidas.
- `node scripts/check-e2e-imports.mjs`: 22 specs inspeccionados.
- `npm run test:e2e-mocked`: 120 aprobadas, 6 omitidas preexistentes fuera del smoke productivo,
  0 fallidas; 126 casos entre desktop y mobile. El guard encontró mocks ausentes durante la
  implementación y las cargas secundarias quedaron declaradas explícitamente.
- Pytest focalizado: no ejecutable localmente porque el PostgreSQL existente rechazó las
  credenciales locales `pos`; no se cambió configuración ni se usaron secretos para sortearlo.
- No se ejecutó `production-smoke`: requiere URL, tenant y credenciales del secret store, además de
  un despliegue real. Éste permanece correctamente como gate operativo pendiente.

## Prerrequisitos externos pendientes

1. Crear/proteger el environment GitHub `production` con reviewers y secrets enumerados en
   `docs/deployment.md`.
2. Desactivar auto-promoción Git de Vercel para evitar carrera con el candidato de CI.
3. Provisionar el tenant smoke y, si se autorizan ventas, su producto/stock y turno controlados.
4. Ejecutar el primer release supervisado, comprobar rollback image capture y conservar el resumen
   de CI como evidencia de aceptación.

Hasta completar estos cuatro puntos no se afirma que un smoke o rollback productivo real haya sido
validado.
