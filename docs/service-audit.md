# Auditoria de servicios de Kova

Fecha de auditoria: 2026-06-11

Esta auditoria inventaria los servicios externos que Kova usa o tiene preparados, para que sea claro para que sirve cada uno y donde podria haber costo. No se leyeron ni imprimieron secretos: solo nombres de variables, configuraciones no sensibles, conectores y documentacion publica.

## Resumen ejecutivo

| Servicio | Estado actual | Para que sirve en Kova | Costo / plan observado |
|---|---|---|---|
| Supabase | Activo confirmado | Base de datos Postgres administrada para staging/produccion | Plan confirmado: `free` en organizacion `PoS` |
| Vercel | Activo confirmado | Hosting del frontend Vite, dominios y rewrites hacia el API | Plan/factura pendiente de dashboard; pricing publico tiene Hobby gratis y Pro desde USD 20/mes + uso |
| Fly.io | Activo por configuracion | Hosting del backend FastAPI y migraciones Alembic en deploy | Probable costo por uso: hay 1 maquina minima encendida; monto pendiente de dashboard |
| Stripe | Configurado, depende de variables | Checkout, suscripciones, webhooks y cobro del plan Kova | Sin costo fijo publico en plan Standard; cobra comision por transaccion exitosa |
| Resend | Configurado, depende de variable | Emails transaccionales: verificacion, bienvenida, recibos, prueba y reset | Pendiente de dashboard; pricing publico incluye plan Free con limite diario |
| Sentry | Configurado, depende de DSN | Monitoreo de errores frontend/backend | Pendiente de dashboard; pricing publico tiene Developer gratis y Team pagado |
| Upstash Redis | Configurado, depende de variables | Rate limiting distribuido en produccion si hay URL/token | Pendiente de dashboard; puede estar gratis o pay-as-you-go |
| Cloudflare R2 | Configurado en GitHub Actions | Backups diarios logicos de Supabase | Pendiente de dashboard; R2 cobra por almacenamiento/operaciones sobre free tier |
| GitHub Actions | Activo confirmado | CI, tests, deploy backend, smoke test y backup DB | Pendiente de GitHub billing; repo privado consume minutos incluidos o pagados |
| UptimeRobot | Activo documentado | Monitoreo externo de frontend, API y DB cada 5 minutos | Documentado como plan gratis |
| Dominio/DNS | Activo por dominios | `kovasuite.com`, `www.kovasuite.com`, `api.kovasuite.com` | Costo de registrador/DNS pendiente; no visible en repo |

> Nota: el dashboard interno de operaciones (`/internal/ops`, "Kova Ops") consume Sentry, Fly, Vercel y UptimeRobot en modo lectura vía tokens server-side opcionales. Sin token, cada integración aparece como `not_configured`. Guía de tokens, scopes mínimos y limitaciones en `docs/runbooks/ops-dashboard.md`.

## Inventario detallado

### Supabase

- Estado: activo confirmado por conector Supabase.
- Organizacion: `PoS` (`ixmmgbsbkmjwqzwxklhl`).
- Proyecto: `PoS Project` (`qpgpwbhjuzszhrkhsjrn`), region `us-west-1`, estado `ACTIVE_HEALTHY`, Postgres 17.
- Plan confirmado: `free`.
- Uso en Kova: Supabase se usa como Postgres administrado via `DATABASE_URL`. La ruta documentada dice que no se usa Supabase Auth, Storage, Edge Functions ni Realtime para la app actual.
- Evidencia local: `docs/deployment.md`, `docs/claude/architecture-context.md`, `backend/app/config.py`, migraciones Alembic en `backend/alembic/versions/`.
- Riesgo de costo: bajo hoy porque el plan esta confirmado como gratis, pero el Free Plan tiene cuotas. Si se sube a Pro, Supabase factura por organizacion y puede sumar costos por compute/uso.
- Pendiente para monto exacto: revisar Supabase Dashboard > Organization > Billing/Usage para confirmar que no haya add-ons, facturas pendientes o credit card activa.

### Vercel

- Estado: activo confirmado por conector Vercel.
- Equipo: `PoS Project's projects` (`team_5ggtpPZhuPUCxDmMnnJKVzt6`).
- Proyecto: `point-of-sale` (`prj_Ej790rUdJGUsC2rYhx93FFj6iuaT`), framework `vite`.
- Dominios: `kovasuite.com`, `www.kovasuite.com`, `point-of-sale-ochre.vercel.app` y aliases de deploy.
- Uso en Kova: sirve el frontend y aplica headers/rewrite de `/api/*` hacia `https://api.kovasuite.com`.
- Evidencia local: `frontend/vercel.json`, `frontend/package.json`, `.github/workflows/ci.yml`.
- Costo: el conector no expuso plan/factura. Pricing publico de Vercel muestra Hobby gratis y Pro desde USD 20/mes + uso adicional.
- Pendiente para monto exacto: Vercel Dashboard > Team > Settings > Billing y Project > Usage. Confirmar si el equipo esta en Hobby/Pro y si hay add-ons de Analytics, Speed Insights, Observability o dominios comprados en Vercel.

### Fly.io

- Estado: activo por configuracion y pipeline de deploy.
- App configurada: `pos-project-backend`, region primaria `dfw`.
- Capacidad configurada: 1 VM, 1 CPU, 1 GB RAM, `min_machines_running = 1`, `auto_stop_machines = off`.
- Uso en Kova: ejecuta el backend FastAPI y corre `uv run alembic upgrade head` como release command antes de promover deploys.
- Evidencia local: `backend/fly.toml`, `backend/Dockerfile`, `.github/workflows/ci.yml`, `docs/deployment.md`.
- Costo probable: Fly cobra por uso de infraestructura. Como hay una maquina minima siempre encendida, es razonable esperar cargo recurrente si la app esta desplegada.
- Pendiente para monto exacto: Fly Dashboard > Billing o `fly billing`/dashboard de la org. Confirmar uso mensual de Machines, IPv4, volumenes, transferencia y soporte.

### Stripe

- Estado: configurado, depende de variables de entorno y cuenta Stripe.
- Uso en Kova: checkout de suscripcion, lectura de prices/subscriptions, cancelacion al final del periodo, webhooks de billing y recibos.
- Variables esperadas: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_STANDARD_PRICE_ID`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`.
- Evidencia local: `backend/app/billing/stripe_client.py`, `backend/app/billing/service.py`, `specs/billing/standard_plan.md`, `frontend/vercel.json` CSP permite `js.stripe.com`, `hooks.stripe.com`, `api.stripe.com` y `checkout.stripe.com`.
- Producto Kova documentado: un solo `Standard Plan` de $299 MXN/mes.
- Costo probable: Stripe no suele cobrar mensualidad fija en su pricing Standard; cobra comision por transaccion exitosa y posibles cargos por disputas/servicios adicionales.
- Pendiente para monto exacto: Stripe Dashboard > Balances/Payments/Billing/Developers. Confirmar si esta en modo test o live, comisiones por Mexico, impuestos, Billing, Tax, Radar u otros productos activos.

### Resend

- Estado: configurado, se activa si existe `RESEND_API_KEY`.
- Uso en Kova: emails transaccionales para verificacion, bienvenida, recibo de pago, fin de prueba, invitacion y reset de contrasena.
- Variables esperadas: `RESEND_API_KEY`, `EMAIL_FROM`.
- Evidencia local: `backend/app/email/service.py`, `docs/email-deliverability.md`, `backend/app/config.py`.
- Costo probable: puede estar en Free si el volumen es bajo; pricing publico muestra limite diario en Free y planes pagados para mayor volumen/capacidades.
- Pendiente para monto exacto: Resend Dashboard > Billing/Usage. Confirmar dominio de envio, volumen, bounces, webhooks y si hay plan Pro/Scale.

### Sentry

- Estado: configurado, se activa si hay DSN.
- Uso en Kova: monitoreo de errores backend FastAPI y frontend React. Ambos desactivan envio de PII por default.
- Variables esperadas: `SENTRY_DSN` en backend y `VITE_SENTRY_DSN` en frontend.
- Evidencia local: `backend/app/observability/sentry.py`, `frontend/src/observability/sentry.ts`, dependencias `sentry-sdk[fastapi]` y `@sentry/react`.
- Costo probable: puede estar en plan Developer gratis si es un solo usuario y bajo volumen; planes Team/Business son pagados.
- Pendiente para monto exacto: Sentry > Organization Settings > Subscription/Usage. Confirmar eventos mensuales, tracing, replay y retencion.

### Upstash Redis

- Estado: configurado, se usa solo si existen URL y token.
- Uso en Kova: rate limiting distribuido para entornos con mas de una instancia. Si no esta configurado, cae a limitador en memoria.
- Variables esperadas: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Evidencia local: `backend/app/middleware/rate_limit.py`, `backend/app/config.py`, dependencias `upstash-redis` y `upstash-ratelimit`.
- Costo probable: puede estar en Free o pay-as-you-go segun dashboard. El codigo comenta que sliding window puede costar varias operaciones Redis por request limitado.
- Pendiente para monto exacto: Upstash Console > Redis database > Billing/Usage. Confirmar comandos mensuales y plan.

### Cloudflare R2

- Estado: activo por workflow si los secretos existen y el workflow esta habilitado.
- Uso en Kova: backup logico diario de Supabase con `pg_dump`, subido a bucket R2 bajo prefijo `supabase/postgres/`, retencion de 7 dias.
- Secretos esperados en GitHub Actions: `SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`.
- Evidencia local: `.github/workflows/db-backup.yml`, `docs/deployment.md`, `docs/runbooks/restore-supabase-backup.md`.
- Costo probable: con dumps pequenos y 7 dias de retencion podria caer dentro del free tier, pero R2 cobra por almacenamiento y operaciones si se supera.
- Pendiente para monto exacto: Cloudflare Dashboard > R2 > Usage/Billing. Confirmar tamano del bucket, operaciones Class A/B y si el dominio DNS esta en Cloudflare.

### GitHub Actions

- Estado: activo confirmado por workflows.
- Uso en Kova: backend lint/test/migrations/OpenAPI, frontend lint/typecheck/test/build, smoke e2e contra Vercel, deploy backend a Fly, gitleaks y backup diario a R2.
- Evidencia local: `.github/workflows/ci.yml`, `.github/workflows/db-backup.yml`, `.gitleaks.toml`.
- Costo probable: el repo es privado segun metadata de deploy Vercel. GitHub Actions en repos privados consume minutos incluidos por plan y puede generar cobros si se exceden.
- Pendiente para monto exacto: GitHub > Billing and plans > Actions minutes. Confirmar plan de GitHub, minutos usados, storage de artifacts/cache y si hay Codespaces/Packages.

### UptimeRobot

- Estado: documentado como activo.
- Uso en Kova: tres monitores cada 5 minutos: API health, API + DB y frontend. Alertas por email a `posprojectsupport@gmail.com`; SMS/Voice deshabilitados.
- Evidencia local: `docs/runbooks/uptime-monitoring.md`.
- Costo observado en docs internas: plan gratis.
- Costo publico: UptimeRobot publica plan Free de USD 0/mes con 50 monitores y 5 min de intervalo.
- Pendiente para monto exacto: UptimeRobot Dashboard > Billing. Confirmar que sigue en Free y que no hay SMS credits/Team/Solo.

### Dominio y DNS

- Estado: activo por configuracion y dominios Vercel/Fly.
- Uso en Kova: `kovasuite.com` para frontend, `www.kovasuite.com`, y `api.kovasuite.com` para backend. Los docs mencionan que DNS debe quedar sin proxy Cloudflare para evitar problemas TLS con Fly/Vercel.
- Evidencia local: `frontend/vercel.json`, `docs/runbooks/uptime-monitoring.md`, conectores Vercel.
- Costo probable: registro/renovacion anual de dominio y, si aplica, servicios DNS o correo. No se ve el registrador en el repo.
- Pendiente para monto exacto: revisar registrador del dominio y Cloudflare/Vercel Domains si fue comprado ahi.

## Servicios no usados directamente en produccion

- Docker Postgres local: `docker-compose.yml` define `db` solo para desarrollo local y pruebas; no es proveedor productivo.
- Supabase Auth/Storage/Edge Functions/Realtime: documentado como fuera de alcance actual para la app, aunque Supabase como plataforma los ofrece.
- Terraform/IaC: documentado como fuera de alcance.

## Checklist para saber si estas pagando hoy

1. Supabase: confirmado por conector como `free`; revisar Billing para facturas/add-ons.
2. Vercel: revisar Team Billing; el conector confirmo proyecto activo pero no plan.
3. Fly.io: revisar Billing; por configuracion, la maquina siempre encendida probablemente genera costo.
4. Cloudflare: revisar R2 Usage/Billing y dominio/DNS.
5. Stripe: revisar si la cuenta esta en live y si ya hubo cobros/comisiones.
6. Resend: revisar Billing/Usage y dominio verificado.
7. Sentry: revisar Subscription/Usage.
8. Upstash: revisar si hay database creada y plan.
9. GitHub: revisar Actions minutes para repo privado y storage.
10. Dominio: revisar registrador y fecha de renovacion.

## Fuentes consultadas

Locales:

- `docs/deployment.md`
- `docs/architecture.md`
- `docs/claude/architecture-context.md`
- `docs/runbooks/uptime-monitoring.md`
- `docs/email-deliverability.md`
- `backend/fly.toml`
- `frontend/vercel.json`
- `.github/workflows/ci.yml`
- `.github/workflows/db-backup.yml`
- `backend/app/config.py`
- `backend/app/billing/stripe_client.py`
- `backend/app/email/service.py`
- `backend/app/observability/sentry.py`
- `frontend/src/observability/sentry.ts`
- `backend/app/middleware/rate_limit.py`

Conectores:

- Supabase: organizacion `PoS`, proyecto `PoS Project`, plan `free`.
- Vercel: equipo `PoS Project's projects`, proyecto `point-of-sale`, dominios y deployments.

Pricing publico consultado el 2026-06-11:

- Supabase billing docs: https://supabase.com/docs/guides/platform/billing-on-supabase
- Vercel pricing: https://vercel.com/pricing
- Fly.io pricing: https://fly.io/pricing
- Stripe pricing: https://stripe.com/pricing
- Resend pricing: https://resend.com/pricing
- Sentry pricing: https://sentry.io/pricing/
- Upstash pricing: https://upstash.com/pricing
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- UptimeRobot pricing: https://uptimerobot.com/pricing/
- GitHub pricing: https://github.com/pricing

