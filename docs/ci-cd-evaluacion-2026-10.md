# Evaluación de CI/CD — octubre 2026

Fuente: `.github/workflows/*`, `scripts/ci_policy.py` y los últimos 40 runs de
`CI and release` (21–26 oct). Los tiempos vienen de la API de GitHub y de los
reportes JUnit del run 40350449370.

## Avance en la branch `ci/evaluacion-pipeline`

Implementado: política `backend`/`frontend` con sus tests, un solo reintento
en integración, eliminación del workflow
de incidente (su presupuesto de 90 min del release pasa a
`check_ops_readiness.py`) y `retention-days: 7` en `openapi-json`. Aplicada a
los últimos 40 PRs, la política habría saltado el backend en 13 y el frontend
en 1.

Descartado tras medirlo: 4 workers en Playwright preview. En el run 40416992828
la suite tardó 324 s contra 276 s con 2 workers, porque el servidor de preview y
los navegadores compiten por el CPU. Además, la carga más lenta destapó una
carrera en `pos-expansion.spec.ts`: el clic llegaba antes de que cargara la
lista vacía. La prueba ya espera ese estado.

Pendiente: ruleset de `main`, pytest-xdist y reutilizar el resultado del PR en
`main`.

## Estado actual

| Flujo | Tiempo de pared | Ruta crítica |
| --- | --- | --- |
| PR | 8–9.5 min | `integration (Cloudflare Free + Postgres)` 8–9.5 min |
| Push a `main` | 11–15 min | la misma suite completa (~9 min) + `release` 3.5–5 min |

Jobs más pesados (run 40350449370):

| Job | Total | Paso dominante |
| --- | --- | --- |
| backend-workers | 8m21s | pytest completo con pg8000: 396 s |
| backend-integration | 6m30s | pytest completo con psycopg: 357 s (2,099 tests, en serie) |
| frontend (preview) | 5m23s | Playwright: 276 s (327 tests, 535 s sumados, 2 workers) |
| backend-native | 2m56s | contenedor con límites lite: 128 s |
| frontend-unit | 2m49s | vitest: 138 s |
| integration (stack docker) | 2m53s | 15 tests reales + axe |
| migrations | 2m17s | migration_tests: 107 s |

Lo que ya está bien y conviene conservar: acciones fijadas por SHA, gate único
`CI required` que falla cerrado, cancelación de PRs obsoletos, cola sin
cancelación para releases, artefacto exacto de rollback, auditoría de
dependencias y gitleaks, y la verificación de SHA frontend/backend antes de
publicar. Producción coincide hoy con `main` (backend `886311a9…`, frontend
`886311a9a978`).

## Hallazgos (prioridad = impacto ÷ riesgo)

### P0 — Eficacia: `main` no está protegida

`gh api repos/:owner/:repo/branches/main/protection` responde 404 y no hay
rulesets. Se fusionaron dos PRs con `CI required` en rojo: #275
(`feat/dashboard-business-status`) y #268 (`feature/connected-owner-workflows`).
En ambos casos el push a `main` falló igual. El release se bloqueó (bien), pero
`main` quedó rota y hubo que abrir PRs de corrección (#269, #276).

**Acción:** ruleset en `main` que exija el check `CI required` y prohíba
force-push y borrado. No exigir "up to date" estricto (añade rebases y otra
corrida completa por PR). Es un cambio de configuración del repositorio y lo
debe aplicar el propietario.

Aceptación: un PR con `CI required` en rojo no se puede fusionar.

### P1 — Eficiencia: el push a `main` repite toda la validación

Cada merge vuelve a correr los ~9 min de suites sobre el mismo árbol que el PR
acaba de validar (el run de PR usa el merge commit `refs/pull/N/merge`). Esto
duplica minutos y alarga la ventana en la que los releases se apilan, que fue
la causa del incidente del 22 oct.

**Acción:** en el push, buscar el último run exitoso del PR fusionado y
comparar `git rev-parse <merge_sha>^{tree}` con `HEAD^{tree}`. Si son
idénticos, reutilizar el resultado y pasar directo a `release`. Si no coinciden
(otro PR entró antes), o falta cualquier dato, se corre todo como hoy (falla
cerrado). `security` y `assistant-parser` (firmas antivirus frescas) se siguen
corriendo siempre.

Impacto estimado: el release de `main` baja de ~13 min a ~5–6 min.
Riesgo: medio. Toca el gate de producción y necesita tests en
`scripts/tests` para cada rama de "fallar cerrado".

### P1 — Eficiencia: un cambio solo de frontend corre todo el backend

`ci_policy.py` solo distingue "solo docs" de "código". De los últimos 40 PRs,
15 (37 %) tocaron solo `frontend/` y/o docs, y aun así corrieron pytest dos
veces, las migraciones, la aceptación nativa y el build de Workers (~20 min de
runner por PR).

**Acción:** agregar salidas `backend` y `frontend` a la política:

- `backend=true` con `backend/`, `deploy/`, `specs/`, infraestructura,
  dependencias o cualquier ruta desconocida.
- `frontend=true` con `frontend/`, `deploy/cloudflare/`, `specs/`,
  infraestructura, dependencias o cualquier ruta desconocida.
- `integration` (stack completo) y `repository`/`security` corren siempre que
  haya código.
- En push a `main` todo es `true` (igual que `parser` hoy), así producción
  siempre se publica con validación completa, salvo que aplique el punto
  anterior.

Riesgo: bajo. Es la misma estrategia conservadora que ya existe y se prueba en
`scripts/tests`.

### P1 — Eficiencia: pytest corre en serie, dos veces

Las 2,099 pruebas tardan ~6 min por driver. Los runners de repos públicos
tienen 4 vCPU. El fixture `db` ya aísla cada prueba con una transacción que se
revierte, así que la paralelización es viable.

**Acción:** `pytest-xdist -n 4` con una base de datos por worker
(`pos_gw0…pos_gw3`) creada en `conftest.py` antes de `apply_migrations`, y
provisión del rol `kova_app` por base. No compartir una sola base: los
`alembic upgrade` simultáneos competirían entre sí.

Impacto estimado: cada suite baja de ~6 min a ~2–2.5 min, y la ruta crítica de
un PR baja de ~9 min a ~5 min.

La suite pg8000 se conserva completa: según `architecture-context.md`, la ruta
Workers sigue siendo la reversión validada y atiende los jobs privados.
Recortarla a un subconjunto ahorraría más, pero debilitaría esa garantía.

### P2 — Playwright preview con solo 2 workers

327 pruebas, 535 s sumados, 276 s de pared: Playwright usa la mitad de los
núcleos. **Medido:** con 4 workers fue más lento (324 s contra 276 s) por contención
de CPU. La opción que queda es repartir la suite con `--shard=1/2` y `2/2` en
dos jobs. Cada job hace su propio build (~30 s) y se ganaría ~2 min de pared.

### P2 — Reintentos que ocultan inestabilidad

`playwright.config.ts` usa `retries: 2` en CI. Se pensó para el smoke contra
producción, pero lo hereda `test:integration` (stack real). Un test que pasa al
tercer intento se ve verde. **Acción:** `retries: 1` para integración y
publicar los tests marcados como `flaky` en el resumen del job. El preview ya
usa `retries: 0`.

### P2 — Workflow de incidente obsoleto

`recover-interrupted-release.yml` está fijado al run 39709835800 y a SHAs del
22 oct. Producción ya está consistente y el artefacto expira el 29 oct.
**Acción:** eliminarlo. El procedimiento general queda en
`frontend/scripts/release-recovery.mjs`.

### P3 — Detalles menores

- `openapi-json` se sube en cada run sin `retention-days` (90 días por
  omisión). Bajarlo a 7 como el resto.
- `backend-native` reconstruye la imagen en cada PR con código. Con el punto de
  `backend`/`frontend` deja de correr en PRs solo de frontend.
- No vale la pena fusionar los `npm ci` de `frontend-unit`, `frontend` e
  `integration`: tardan 8–14 s con caché y fusionarlos quitaría paralelismo.

## Lo que no recomiendo quitar

- La suite completa con pg8000: es la ruta de reversión.
- Las migraciones de ida, vuelta e ida: son baratas (~2 min) y atrapan errores
  irreversibles.
- `supply-chain`: solo corre con cambios de infraestructura o dependencias, y
  cada semana.
- `assistant-parser` en `main`: refresca las firmas antivirus y no está en la
  ruta crítica.

## Orden propuesto

1. Ruleset de `main` (configuración, 5 min).
2. Política `backend`/`frontend` más tests de la política (PR pequeño).
3. pytest-xdist con base de datos por worker (PR mediano, solo `conftest.py` y
   el workflow).
4. Workers de Playwright, ajuste de reintentos y limpieza P2/P3 (PR pequeño).
5. Reutilizar el resultado del PR en `main` (PR mediano, el de más cuidado).

Resultado esperado: un PR de frontend pasa de ~9 min a ~4–5 min, un PR de
backend de ~9 min a ~5 min, y un release de `main` de ~13 min a ~5–6 min, sin
quitar ninguna validación que proteja producción.
