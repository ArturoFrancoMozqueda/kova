# Monitoring Spec

## Error Tracking (Sentry)

Already integrated in both frontend and backend (`@sentry/react`, `sentry-sdk[fastapi]`).

**Configure before beta:**
1. Set `VITE_SENTRY_DSN` (frontend) and `SENTRY_DSN` (backend) in production environments
2. Create a Sentry project for `pos-backend` and `pos-frontend`
3. Configure alert rules:
   - **New issue** → email to engineering
   - **Error rate spike** (>10 new errors in 5 min) → email + Slack if available
   - **P0 issue unresolved after 1 hour** → escalate

## Uptime Monitoring

**Minimum for beta:** External uptime check on the health endpoint.

Recommended free options:
- BetterUptime (free tier, 3-min checks)
- UptimeRobot (free tier, 5-min checks)
- Fly.io built-in health checks (already configured via `[http_service]`)

**Health endpoint:** `GET https://pos-project-backend.fly.dev/health`
Expected response: `200 OK`

**Alert:** Notify engineering on first failure and every subsequent failure until resolved.

## Log Access

Backend logs are structured JSON (request_id, tenant_id, user_id).
Access via: `fly logs -a pos-project-backend`

## Acceptance Criteria

- Sentry DSN configured in both frontend and backend before beta.
- At least one alert rule active (new issue or error spike).
- Uptime monitor checking `/health` every 5 minutes or less.
- Support can access logs without touching production server directly.
