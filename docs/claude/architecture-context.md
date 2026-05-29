# Kova Architecture Context

Known architecture:

- Frontend: React/Vite.
- Backend: FastAPI.
- Database/Auth: Supabase/Postgres.
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

## Engineering principles

- Make small, reviewable changes.
- Preserve API contracts unless explicitly changing them.
- Inspect migrations before database work.
- Use real backend data in production flows.
- Do not introduce fake data to make UI look complete.
- Keep environment separation clear.
