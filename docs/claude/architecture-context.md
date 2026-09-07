# Kova Architecture Context

Arquitectura vigente:

- Frontend: React/Vite.
- Backend: FastAPI.
- Database: Supabase Postgres en entornos alojados; PostgreSQL local para desarrollo y pruebas.
- Auth: implementación propia de Kova en FastAPI/Postgres, con contraseñas hasheadas, sesiones
  persistidas y cookies HttpOnly. Supabase Auth no forma parte del runtime.
- Billing: Stripe subscriptions.
- Frontend hosting: Vercel.
- Backend hosting: Fly.io.

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
[`../engineering-operations-index.md`](../engineering-operations-index.md). Los estados históricos
de auditorías o sprints no reemplazan [`../current-sprint.md`](../current-sprint.md).
