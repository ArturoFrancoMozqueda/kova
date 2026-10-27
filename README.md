# Kova

Kova es un SaaS de punto de venta y análisis para PyMEs mexicanas. El frontend usa React/Vite, el
backend FastAPI y los datos viven en PostgreSQL. Supabase proporciona el PostgreSQL administrado en
staging/producción; **Kova implementa su propio sistema de usuarios, contraseñas y sesiones** y no usa
Supabase Auth.

## Mapa del repositorio

```text
backend/    FastAPI, SQLAlchemy, Alembic y pytest
frontend/   React, Vite, TypeScript, Vitest y Playwright
docs/       arquitectura, operación, decisiones y planeación
specs/      contratos funcionales y OpenAPI versionado
```

## Primer recorrido

El índice de la documentación está en [`docs/README.md`](docs/README.md). Para levantar toda la
aplicación local sin usar servicios administrados:

```powershell
Copy-Item .env.example .env
docker compose up --build --wait
```

La aplicación queda en `http://localhost:5173` y la API en `http://localhost:8000`. No copies
secretos reales a `.env`; los valores locales sólo deben servir para desarrollo.

## Fuentes vigentes

- Arquitectura: [`docs/arquitectura.md`](docs/arquitectura.md) e invariantes en
  [`docs/claude/architecture-context.md`](docs/claude/architecture-context.md).
- Desarrollo local y CI: [`docs/desarrollo-y-ci.md`](docs/desarrollo-y-ci.md).
- Despliegue y rollback: [`docs/despliegue.md`](docs/despliegue.md).
- Ejecución actual: [`docs/current-sprint.md`](docs/current-sprint.md).
- Métricas de ventas: [`docs/report-metric-definitions.md`](docs/report-metric-definitions.md).

Las auditorías y planes con fecha se retiraron del árbol el 2026-10-27; siguen en el historial git.
