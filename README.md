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

El índice canónico de setup, pruebas, arquitectura, runbooks y gates está en
[`docs/engineering-operations-index.md`](docs/engineering-operations-index.md). Para levantar toda la
aplicación local sin usar servicios administrados:

```powershell
Copy-Item .env.example .env
docker compose up --build --wait
```

La aplicación queda en `http://localhost:5173` y la API en `http://localhost:8000`. No copies
secretos reales a `.env`; los valores locales sólo deben servir para desarrollo.

## Fuentes vigentes

- Arquitectura e invariantes: [`docs/architecture.md`](docs/architecture.md) y
  [`docs/claude/architecture-context.md`](docs/claude/architecture-context.md).
- Ejecución actual: [`docs/current-sprint.md`](docs/current-sprint.md).
- Despliegue y gates: [`docs/deployment.md`](docs/deployment.md) y
  [`docs/claude/release-ga-checklist.md`](docs/claude/release-ga-checklist.md).
- Métricas de ventas: [`docs/report-metric-definitions.md`](docs/report-metric-definitions.md).
- Auditorías históricas y evidencia: [`docs/audits/`](docs/audits/).

Los documentos de auditoría conservan el estado observado en su fecha y commit. No sustituyen el
estado de ejecución actual ni prueban por sí solos que un gate externo esté cerrado.
