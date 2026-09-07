# Índice de ingeniería y operación

Este documento es la entrada canónica para trabajar en Kova. Cuando un documento histórico difiera
del código actual, se debe comprobar el contrato, la migración o la prueba vigente antes de cambiar
comportamiento.

## Arquitectura y propiedad de datos

- [`architecture.md`](architecture.md): módulos, contratos, modelo multi-tenant, sesiones y RBAC.
- [`claude/architecture-context.md`](claude/architecture-context.md): resumen corto de stack e
  invariantes que ningún cambio puede debilitar.
- [`deployment.md`](deployment.md): topología Supabase/Postgres, roles runtime/migración, Fly,
  Vercel y procedimiento de release.
- [`adr/ADR-009-backend-only-rls-no-policy-tables.md`](adr/ADR-009-backend-only-rls-no-policy-tables.md):
  frontera entre aislamiento de aplicación y RLS.

Supabase se usa como PostgreSQL administrado. La autenticación es propia de Kova: contraseñas con
hash, sesiones persistidas, access/refresh cookies HttpOnly, rotación y revocación. El navegador no
recibe credenciales de Supabase ni guarda tokens sensibles en Web Storage.

## Desarrollo local

Requisitos: Docker con Compose para la ruta completa; o Python 3.12, `uv`, Node 24 y PostgreSQL para
ejecutar cada servicio por separado.

Ruta completa y aislada:

```powershell
Copy-Item .env.example .env
docker compose up --build --wait
docker compose ps
```

La base `db` del compose es exclusivamente local. Staging y producción requieren los roles y URLs
separados que describe [`deployment.md`](deployment.md); el rol owner nunca debe servir requests.

## Pruebas y contratos

Los mismos grupos principales exigidos por CI pueden reproducirse así:

```powershell
docker compose exec -T backend uv run ruff check .
docker compose exec -T backend uv run alembic upgrade head
docker compose exec -T backend uv run pytest
docker compose exec -T backend uv run python scripts/export_openapi.py --check

Set-Location frontend
npm ci
npm run lint
npm run typecheck
npm run check:api-contract
npm test -- --run
npm run test:release-contract
npm run build
npm run check:bundle-secrets
```

Las pruebas backend necesitan PostgreSQL real; SQLite no demuestra locks, constraints, grants ni
RLS. La suite E2E mockeada se ejecuta con `npm run test:e2e-mocked`. Las pruebas de integración y
smoke productivo tienen requisitos adicionales definidos en [`deployment.md`](deployment.md) y no
se deben interpretar como aprobadas si se omitieron.

## Ejecución, auditoría y evidencia

- [`current-sprint.md`](current-sprint.md): trabajo y gates vigentes.
- [`audits/KOVA_COMPREHENSIVE_AUDIT.md`](audits/KOVA_COMPREHENSIVE_AUDIT.md): diagnóstico histórico
  fechado; sus puntuaciones describen el commit auditado.
- [`audits/KOVA_IMPROVEMENT_BACKLOG.md`](audits/KOVA_IMPROVEMENT_BACKLOG.md): criterios originales de
  los hallazgos; su encabezado histórico no representa el estado posterior a remediaciones.
- [`risk-register.md`](risk-register.md): riesgos operativos conocidos.
- [`claude/manual-qa-checklist.md`](claude/manual-qa-checklist.md): revisión manual para cambios de
  producto significativos.

## Runbooks y gates de salida

- [`runbooks/ops-beta-gate.md`](runbooks/ops-beta-gate.md): evidencia requerida antes del beta pago.
- [`runbooks/restore-supabase-backup.md`](runbooks/restore-supabase-backup.md): restore en destino
  desechable y registro de RPO/RTO.
- [`runbooks/uptime-monitoring.md`](runbooks/uptime-monitoring.md): monitores, alertas y respuesta.
- [`runbooks/ops-dashboard.md`](runbooks/ops-dashboard.md): diagnóstico operativo de sólo lectura.
- [`offline-qa-checklist.md`](offline-qa-checklist.md): prueba por dispositivo del POS offline.
- [`email-deliverability.md`](email-deliverability.md): verificación de entrega del proveedor.
- [`claude/release-ga-checklist.md`](claude/release-ga-checklist.md): checklist resumido de release.

Código y pruebas locales pueden preparar estos gates, pero no reemplazan evidencia real de Stripe,
correo, backup/restore, infraestructura, monitoreo ni QA en dispositivos. Cada ejecución debe quedar
fechada con commit, entorno, resultado y responsable en el runbook correspondiente.
