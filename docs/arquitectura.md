# Arquitectura actual de Kova

Escrito desde el código el 2026-10-27. Si este documento y el código difieren, manda el código;
corrige este documento en el mismo cambio.

## Vista general

```text
Navegador (PWA React)
   │  https://kovasuite.com  (mismo origen, cookies HttpOnly)
   ▼
kova-frontend  ── Worker Cloudflare + Static Assets      deploy/cloudflare/
   │  /api/* → https://api.kovasuite.com (proxy sin caché, no-store)
   ▼
kova-backend-gateway ── Worker JS, dominio api.kovasuite.com   deploy/cloudflare-backend/gateway.mjs
   │  Durable Object KovaApi
   ▼
kova-backend ── controlador JS + Container "kova-native-api"   deploy/cloudflare-native/
   │  FastAPI nativo (uvicorn, 1 proceso, instancia basic, residente)
   │  ├─ http://rate-limit.kova.internal → Durable Object KovaRateLimit
   │  ├─ http://jobs.kova.internal       → Worker kova-backend-jobs
   │  └─ R2 "kova-assistant" (almacenamiento privado del asistente)
   ▼
Supabase Postgres (autoridad de datos, sesiones, RLS)
```

Servicios externos: Stripe (suscripciones), Resend (correo), Sentry (errores backend y navegador).

## Componentes

### Frontend — `frontend/`

- React 18 + Vite + TypeScript, PWA con `vite-plugin-pwa`.
- Datos de servidor con TanStack Query; rutas con React Router.
- Offline: ventas y cola local en IndexedDB vía Dexie (`frontend/src/offline/`).
- El build se pre-renderiza (`build:ssr` + `prerender`) para landing y páginas públicas.
- Todas las llamadas usan rutas relativas `/api/v1/...`; el Worker del frontend las reenvía.
- Módulos por dominio en `frontend/src/` (register, catalog, inventory, reports, billing, fiscal,
  assistant, etc.).

Hosting: Worker `kova-frontend` con Static Assets (`deploy/cloudflare/worker.mjs`). Aplica headers de
seguridad, sirve `app-shell.html` para navegación de la app y responde 404 a archivos inexistentes.
Dominios: `kovasuite.com`, `www.kovasuite.com` (redirige a apex) y `preview.kovasuite.com`.
Vercel sigue existiendo como candidato de publicación y respaldo (ver [despliegue](despliegue.md)).

### Backend — `backend/`

- FastAPI + SQLAlchemy + Pydantic + Alembic. Monolito modular: un paquete por dominio en
  `backend/app/` (auth, tenants, rbac, catalog, orders, inventory, shifts, reports, billing, sync,
  fiscal, cfdi, assistant, ops, …).
- Entrada de producción: `app.native:app` en `backend/Dockerfile.api`. Entrada local:
  `app.main:app` en `backend/Dockerfile`.
- Middleware (de fuera hacia dentro): límite de tamaño de body → contexto de request → CSRF →
  headers de seguridad → GZip (solo nativo) → CORS.
- Al arrancar valida configuración y la postura de RLS (`assert_rls_active`,
  `assert_private_policies`); si falla, no arranca.
- En producción `/docs` y `/openapi.json` están desactivados. El contrato versionado vive en
  `specs/` y CI lo compara con el código.

### Runtime en Cloudflare

| Worker | Qué hace | Config |
|---|---|---|
| `kova-frontend` | Static assets + proxy `/api` | `deploy/cloudflare/cloudflare.config.ts` |
| `kova-backend-gateway` | Dominio `api.kovasuite.com`; 404 temprano a rutas desconocidas; dirige al Durable Object `KovaApi` | `deploy/cloudflare-backend/cloudflare.config.ts` |
| `kova-backend` | Controlador del Container FastAPI (`KovaApi`) y limitador (`KovaRateLimit`) | `deploy/cloudflare-native/cloudflare.config.ts` |
| `kova-backend-jobs` | Jobs privados del asistente con alarmas por tenant y sweep cada 5 min; sin ruta pública | `deploy/cloudflare-backend/cloudflare.config.ts` |

- El Container corre un solo proceso (`maxInstances: 1`, `instanceType: basic`) que se mantiene vivo
  en inactividad. Mantenimiento o un release pueden reiniciarlo.
- Con `KOVA_NATIVE_BACKEND=1` el gateway usa el backend nativo. La versión anterior, FastAPI dentro
  de Python Workers (`deploy/cloudflare-backend/entry.py`) con Hyperdrive, se conserva como ruta de
  reversión validada.
- La identidad de release es el SHA completo: `KOVA_BUILD_SHA` en Workers, `KOVA_RELEASE_SHA` en la
  imagen; `/health` expone `release_sha`.
- Fly.io se retiró por completo el 2026-10-19. No hay proveedor de backend alternativo.

## Datos y multi-tenant

- Supabase se usa **solo como Postgres administrado**. No se usa Supabase Auth, Storage, Realtime
  ni Edge Functions. El navegador nunca recibe credenciales de base de datos.
- Esquema compartido con `tenant_id` en las tablas de negocio
  ([ADR-002](adr/ADR-002-shared-schema-multitenancy.md)).
- Defensa en profundidad con RLS forzado ([ADR-009](adr/ADR-009-backend-only-rls-no-policy-tables.md)):
  el backend fija `app.tenant_id` con `set_config` por transacción (`backend/app/db.py`) y las
  políticas comparan contra ese valor.
- Dos roles de base de datos:
  - `APP_DATABASE_URL`: rol runtime `kova_app`, sin `BYPASSRLS`, sin ser dueño de tablas.
  - `MIGRATION_DATABASE_URL`: rol dueño, solo para migraciones y rutas privilegiadas explícitas.
  - En local ambos caen a `DATABASE_URL`.
- Migraciones: Alembic en `backend/alembic/versions/`. Deben ser reversibles (CI hace
  upgrade → downgrade → upgrade) y compatibles con la versión anterior de la app, porque un
  rollback nunca baja la base.
- Dinero siempre en `Decimal` ([ADR-005](adr/ADR-005-decimal-money.md)).

## Autenticación y permisos

- Auth propia en `backend/app/auth/`: contraseñas con bcrypt, sesiones persistidas en Postgres,
  access y refresh token en cookies HttpOnly con rotación y revocación
  ([ADR-007](adr/ADR-007-auth-session-strategy.md)).
- CSRF por cookie + header `X-CSRF-Token` (`backend/app/middleware/csrf.py`).
- El tenant se obtiene de la sesión del servidor, nunca de lo que mande el navegador.
- Nada sensible en `localStorage` ni `sessionStorage`.
- RBAC en `backend/app/rbac/`; cada endpoint de escritura declara su permiso.
- Rate limiting persistente en el Durable Object `KovaRateLimit`; fuera de Cloudflare puede usar
  Upstash Redis (`UPSTASH_REDIS_REST_*`).

## Offline e idempotencia

- El POS registra ventas offline en Dexie y las sincroniza por lotes con `client_uuid` e
  `Idempotency-Key` ([ADR-004](adr/ADR-004-offline-first-sync.md)).
- El servidor deduplica (`backend/app/idempotency/`, `backend/app/sync/`). Una venta fallida no se
  borra sola: queda visible para que el usuario la recupere.

## Billing

- Suscripción del negocio con Stripe Checkout/Billing (`backend/app/billing/`); los pagos del POS
  son otro dominio ([ADR-008](adr/ADR-008-billing-vs-pos-payments.md)).
- El estado de suscripción se guarda localmente y los webhooks son idempotentes.
- Producción rechaza llaves de prueba salvo `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION`.
- Planes, precios y textos: verificar en código y en
  [billing-state-copy-matrix.md](billing-state-copy-matrix.md); no asumir.

## Tareas programadas

| Qué | Dónde corre | Cómo |
|---|---|---|
| Jobs del asistente | Worker `kova-backend-jobs` | Alarmas por tenant + cron `*/5 * * * *` |
| Backup lógico diario | GitHub Actions `db-backup.yml` | `pg_dump` → R2, retención 7 días |
| Purga de cuentas eliminadas | `account-purge.yml` (diario) | `POST` interno con `INTERNAL_API_KEY` |
| Borradores fiscales globales | `fiscal-global-drafts.yml` (cada 6 h) | `POST` interno con `INTERNAL_API_KEY` |
| Recordatorios de fin de prueba | `trial-reminders.yml` (diario) | Script Python con Resend |
| Drills manuales | `db-restore-drill.yml`, `stripe-sandbox-drill.yml` | `workflow_dispatch` con confirmación |

## Funciones desactivadas a propósito

- La carga e ingesta de documentos del asistente está desactivada para controlar el gasto. El
  parser aislado (`backend/assistant-parser/`, con antivirus y OCR) se sigue construyendo y
  probando en CI, pero no corre en producción.
- Los thumbnails nativos de fotos de producto usan el original como respaldo.

## Límites de seguridad que ningún cambio puede debilitar

Auth y cookies, RLS y aislamiento entre tenants, gates de billing, separación live/test de Stripe,
idempotencia del sync offline y seguridad de despliegue. Ver
[claude/architecture-context.md](claude/architecture-context.md) y `CLAUDE.md`.
