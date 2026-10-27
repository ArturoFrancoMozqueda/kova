# Desarrollo local y CI

Escrito desde el código el 2026-10-27. Fuentes de verdad: `docker-compose.yml`,
`scripts/test-stack.sh`, `.github/workflows/ci.yml` y `scripts/ci_policy.py`.
La política detallada de CI (inventario de suites, vulnerabilidades, mediciones) está en
[testing-ci.md](testing-ci.md).

## Requisitos

- Docker con Compose. Es la ruta recomendada y funciona sin instalar Node ni Python.
- Para correr los servicios por separado: Python 3.12 con `uv`, Node 24 y PostgreSQL 16.

## Levantar la app completa

```bash
cp .env.example .env
```

```bash
docker compose up --build --wait
```

- App: `http://localhost:5173`. API: `http://localhost:8000` (`/docs` disponible fuera de
  producción).
- El servicio `db` es Postgres local, solo para desarrollo. Nunca pongas URLs de Supabase de
  producción ni secretos reales en `.env`.
- Migraciones: `docker compose exec backend uv run alembic upgrade head`.

## Pruebas

Las pruebas de backend necesitan Postgres real; SQLite no prueba locks, constraints, grants ni RLS.

| Qué | Comando | Dónde |
|---|---|---|
| Backend completo con base desechable | `scripts/test-stack.sh backend` | raíz |
| Stack real (API + Postgres + Playwright) | `scripts/test-stack.sh integration` | raíz |
| Lint backend | `uv run ruff check .` | `backend/` |
| Pytest | `uv run pytest -n 4 --dist loadgroup` | `backend/` |
| Contrato OpenAPI | `uv run python scripts/export_openapi.py --check` | `backend/` |
| Lint frontend | `npm run lint` | `frontend/` |
| Unit tests (Vitest) | `npm test -- --run` | `frontend/` |
| Contrato API del frontend | `npm run check:api-contract` | `frontend/` |
| Contratos de release | `npm run test:release-contract` | `frontend/` |
| Build de producción (incluye `tsc`) | `npm run build` | `frontend/` |
| Secretos en el bundle | `npm run check:bundle-secrets` | `frontend/` |
| Playwright sobre el build | `npm run test:e2e-preview:built` | `frontend/` |
| Playwright con Vite dev (local) | `npm run test:e2e-dev` | `frontend/` |
| Workers de Cloudflare | `npm test --prefix deploy/cloudflare` (y `cloudflare-native`) | raíz |
| Política de CI | `python -m unittest discover -s scripts/tests` | raíz |

## CI (`.github/workflows/ci.yml`)

Se ejecuta en cada PR y en cada push a `main`.

1. **classify changes** (`scripts/ci_policy.py changes`) decide qué suites aplican: backend,
   frontend, parser o supply chain. Si un cambio solo toca Markdown de `docs/` o el `README`, se
   saltan las suites de aplicación. Una ruta desconocida activa todo.
2. Jobs en paralelo:
   - `repository contracts`: chequeos del repo y tests de la política de CI.
   - `integration (FastAPI + Postgres)`: ruff, pytest en paralelo y contrato OpenAPI.
   - `integration (Cloudflare Free + Postgres)`: la API dentro del runtime Python Workers (ruta de
     reversión).
   - `backend-native`: imagen nativa AMD64 con límites de CPU/RAM y aceptación
     (`native-backend.yml`).
   - `frontend unit and contracts`: lint, contrato API, Vitest, contratos de release y Worker del
     frontend.
   - `frontend production build and browser`: build más Playwright en 2 shards.
   - `integration`: stack real con Docker Compose.
   - `migration reversibility`: upgrade → downgrade → upgrade sobre una base propia.
   - `secrets and dependency audit`: gitleaks, npm/pip audit y secretos en el bundle.
   - `isolated assistant parser and antivirus`.
   - `supply-chain`: build reproducible y SBOM (`ci-maintenance.yml`).
3. **CI required** junta todo. Falla si una suite aplicable falló, se canceló o no corrió.
4. **publish and verify release**: solo en `main`. Ver [despliegue](despliegue.md).

`ci-maintenance.yml` también corre cada lunes para detectar vulnerabilidades nuevas sin esperar
cambios de código.

## Reglas al cambiar código

- No cambies tests, fixtures, migraciones ni resultados esperados solo para que pasen.
- Toda migración necesita `downgrade()` y debe ser compatible con la versión anterior de la app.
- Si cambias un endpoint, regenera el contrato en `specs/` y verifica `check:api-contract`.
- Antes de cerrar un cambio de producto, revisa
  [claude/manual-qa-checklist.md](claude/manual-qa-checklist.md).
