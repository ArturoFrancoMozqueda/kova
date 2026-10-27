# Kova Architecture Context

Resumen corto para agentes. El detalle, escrito desde el código, está en
[`../arquitectura.md`](../arquitectura.md) y [`../despliegue.md`](../despliegue.md).

- Frontend: React/Vite PWA servida por el Worker `kova-frontend` (Cloudflare Static Assets). El
  Worker reenvía `/api` en el mismo origen a `api.kovasuite.com`, sin cachear respuestas privadas
  ni tener credenciales de base de datos. Vercel queda como candidato de publicación y respaldo.
- Backend: FastAPI nativo en un Container Cloudflare `basic` residente (una instancia, un proceso
  Uvicorn), detrás de `kova-backend-gateway` y del controlador `kova-backend`. FastAPI en Python
  Workers con Hyperdrive queda como ruta de reversión validada; `kova-backend-jobs` atiende los
  jobs privados del asistente.
- Database: Supabase Postgres solo como Postgres administrado; PostgreSQL local para desarrollo y
  pruebas. Es la autoridad para sesiones, permisos, RLS y escrituras. SQLite de Durable Objects no
  guarda tablas del negocio.
- Auth: propia de Kova (contraseñas con hash, sesiones persistidas, cookies HttpOnly). Supabase
  Auth no forma parte del runtime.
- Billing: Stripe subscriptions.
- Ingesta de documentos del asistente desactivada para controlar el gasto.
- Fly se retiró el 2026-10-19; publicación y recuperación usan versiones exactas de Cloudflare.

## Safety boundaries

The highest-risk areas are:

- Auth and sessions.
- Supabase RLS and tenant isolation.
- Billing and Stripe webhooks.
- Production deployment.
- Offline POS sync and idempotency.
- Analytics correctness.

## Data and identity boundaries

- El backend es el único cliente de PostgreSQL; el frontend no recibe credenciales de Supabase.
- `APP_DATABASE_URL` usa el rol runtime sin bypass de RLS; `MIGRATION_DATABASE_URL` queda reservado
  para migraciones y rutas privilegiadas explícitas.
- La identidad y el tenant se resuelven desde una sesión válida en el servidor. Nunca se confía en
  un tenant enviado por el navegador para autorizar una operación.
- Access y refresh tokens viajan únicamente en cookies seguras; ningún token sensible se guarda en
  `localStorage` o `sessionStorage`.

## Engineering principles

- Make small, reviewable changes.
- Preserve API contracts unless explicitly changing them.
- Inspect migrations before database work.
- Use real backend data in production flows.
- Do not introduce fake data to make UI look complete.
- Keep environment separation clear.

El índice de setup, pruebas y operación está en
[`../README.md`](../README.md). Los estados históricos
de auditorías o sprints no reemplazan [`../current-sprint.md`](../current-sprint.md).
