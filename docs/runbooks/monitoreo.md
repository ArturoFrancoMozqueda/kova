# Monitoreo y alertas

Dos piezas: monitores de disponibilidad en UptimeRobot y Sentry en el navegador. Los logs del
backend están en Cloudflare (ver [ops-dashboard](ops-dashboard.md)).

## Disponibilidad (UptimeRobot)

Production uptime for Kova is monitored by **UptimeRobot** (free plan, account owner: `posprojectsupport@gmail.com`). This runbook documents what is monitored, what each alert means, and how to act on failures.

Infrastructure reference updated 2026-10-26: the public frontend uses Cloudflare Workers Static
Assets and the API uses the resident FastAPI Container behind Cloudflare. Vercel is a release
candidate/fallback; Fly was retired on 2026-10-19. See the [architecture context](../claude/architecture-context.md),
[frontend deployment](../../deploy/cloudflare/README.md) and [resident backend](../../deploy/cloudflare-native/README.md).
Monitor settings and delivery still require confirmation in the operator's dashboard; this document
does not establish that a new notification or outage drill has passed.

> **Why UptimeRobot and not GitHub Actions?** A previous `uptime.yml` workflow polled `/health` every 10 minutes and consumed ~4,300 Actions minutes/month — well over the free tier. It was deleted in favor of UptimeRobot, which polls every 5 minutes for free and is purpose-built for this. Do not re-add the workflow.

---

### What is monitored

Three HTTP/S monitors, each checked every 5 minutes from UptimeRobot's global probes:

| Monitor | URL | What it proves when green |
|---|---|---|
| **Kova API health** | `https://api.kovasuite.com/health` | The public gateway/API responds, TLS is valid and DNS resolves. Does **not** touch the database or establish the running release SHA with a HEAD probe. |
| **Kova API + DB** | `https://api.kovasuite.com/health/db` | Everything above **plus** the backend can execute `SELECT 1` through its database connection. This does not certify tenant isolation or business queries. |
| **Kova frontend** | `https://kovasuite.com` | The public frontend returns a successful HTTP response and DNS resolves. A browser smoke is still needed to verify JavaScript, login and the current build. |

All three call `HEAD` by default. Both backend health endpoints support HEAD explicitly ([backend/app/health/router.py](../../backend/app/health/router.py)).

---

### Alert channels

Configured per monitor under *Alert Contacts*:

| Channel | Where it lands | Use |
|---|---|---|
| E-mail | `posprojectsupport@gmail.com` | Primary. Verify actual delivery and latency during the notification drill. |
| Mobile push | UptimeRobot app on the operator's phone | Optional but recommended — wakes the operator outside Gmail hours. Install the app and add a "Mobile push" alert contact. |

> SMS and Voice are **disabled** by default — UptimeRobot bills SMS credits separately and is not worth enabling until paid clients exist. Leave them off.

Verify the configured failure-confirmation count and interval in the dashboard. Record observed
notification latency; polling, confirmation and delivery delays must not be presented as an SLA.

---

### Triage matrix

When an alert fires, look at **which combination** of monitors is down. That isolates the failure layer before you open any console.

| API health | API + DB | Frontend | Likely cause | First action |
|---|---|---|---|---|
| 🔴 | 🔴 | 🟢 | Cloudflare gateway/Worker or resident API failure | Inspect Cloudflare Worker/Container status and sanitized runtime logs, then the exact release's CI logs. Compare GET `/health` with the expected SHA. |
| 🟢 | 🔴 | 🟢 | Supabase connectivity, pool exhaustion or database failure | Check Supabase health and sanitized backend logs. Verify runtime/migration binding names against the [resident backend contract](../../deploy/cloudflare-native/README.md); never print connection values or substitute the owner connection for runtime. A green DB probe does not establish RLS correctness. |
| 🟢 | 🟢 | 🔴 | Frontend Worker/assets, routing or apex DNS failure | Inspect the Cloudflare frontend deployment/routes and `/version.json`; compare with the accepted release. Inspect Vercel only as the captured candidate/fallback. |
| 🔴 | 🔴 | 🔴 | DNS root, Cloudflare incident, or TLS cert expired across the board | Cloudflare dashboard. Check `nslookup api.kovasuite.com` and `nslookup kovasuite.com` from a different network. |
| 🔴 | 🟢 | — | Different probe timing, routing or a transient API/gateway failure | Compare both exact GET URLs from the same network and inspect timestamps/request IDs. A notification test alone does not diagnose API routing. |
| 🟢 | 🟢 | 🟢 | False alarm or transient network blip already recovered | Confirm in UptimeRobot incident history. Document the blip if it persists. |

---

### Common failures and fixes

#### `/health/db` returns 405 Method Not Allowed
Cause: monitor is using HEAD against an endpoint without a HEAD handler. As of `health/router.py` both endpoints support HEAD — but if you ever add a new health endpoint, remember to declare both `@router.get(...)` and `@router.head(...)` or UptimeRobot's probes will 405.

#### Frontend monitor goes red after a release
Check the release's acceptance/recovery result and the public `/version.json`, not just the Vercel
candidate status. The [release verifier](../../frontend/scripts/verify-deployment.mjs) checks site,
frontend version, API, database and same-origin proxy against the requested SHA. If publication
failed, use the captured rollback artifact and existing release recovery; never guess Worker
versions, redeploy an old image ad hoc or bypass a failed gate.

#### All three monitors red, app actually works in the browser
Compare the monitor's exact URL/method with a direct GET from another network, then inspect
Cloudflare routing, certificates and incident history. The active frontend's apex and `www`
records **must remain proxied** for the Workers routes described in the [frontend deployment](../../deploy/cloudflare/README.md).
Do not switch them to DNS-only as a generic fix, and do not alter API, email or automation records.
DNS fallback to the retained Vercel origin is a separately reviewed recovery step.

#### Long downtime in *Last 30 days* stat
Separate historical outages from current incidents before interpreting a window. Earlier monitor
URL/provider changes, including `pos-project-backend.fly.dev` → `api.kovasuite.com`, may remain in
its history; do not erase that evidence or dismiss a new outage.
Record the interval, affected release and observed recovery.

---

### Operating the dashboard

Account login: UptimeRobot dashboard at `dashboard.uptimerobot.com` with `posprojectsupport@gmail.com`.

| Action | Where |
|---|---|
| Pause a monitor (e.g., for planned maintenance) | Monitor row → ⋯ → Pause. Remember to un-pause. |
| Add a new monitor | **+ New monitor** → HTTP(S) → fill URL + friendly name + 5-min interval → assign alert contacts. |
| Change alert recipients | **My Settings** → Alert Contacts. Apply to monitors via Edit. |
| Maintenance windows (no alerts during deploys) | **Maintenance** tab → schedule a window. Useful for planned Supabase upgrades. |
| Public status page | **Status pages** tab. Free plan gives a UptimeRobot-branded URL (`stats.uptimerobot.com/<id>`). Custom domain (`status.kovasuite.com`) requires the paid plan — deferred until paid tenants exist. |

---

### When to add more monitors

Add a new monitor when a new externally-reachable surface becomes load-bearing for revenue or trust:

- **Stripe webhook delivery** — inspect verified deliveries/failures in the provider and application
  evidence. The signed POST endpoint `/api/v1/billing/webhooks/stripe` is not a GET/HEAD health
  monitor; do not send synthetic financial events or infer subscription convergence from uptime.
- **Resend email service** — not directly monitorable, but you can monitor a self-hosted `/health/email` if you ever add one.
- **Status page itself** (once we have one).

Do **not** add monitors for internal-only endpoints (admin paths, internal APIs) — UptimeRobot probes from the public internet and they would just 401 every time.

---

### Escalation

Documented beta escalation, to reconfirm before paid access:
1. Email lands in `posprojectsupport@gmail.com`.
2. Operator (Arturo) responds when they see it.
3. No on-call rotation.

Before committing paid support expectations:
1. Add mobile push notification to the operator's phone.
2. Document the support owner, hours and response expectations accepted for the beta; do not promise an unaccepted SLA.
3. Decide whether to enable SMS — costs UptimeRobot credits but wakes the operator outside business hours.

---

### Verification checklist (quarterly drill)

Run this at least once per quarter to confirm the alerting actually works end-to-end:

- [ ] In UptimeRobot, click **Test Notification** on each of the 3 monitors. Confirm email arrives.
- [ ] Confirm monitor URLs, methods, intervals and alert contacts match the current Cloudflare deployment.
- [ ] Record notification delivery separately from outage detection. A planned detection/recovery drill needs explicit approval and an isolated target or maintenance plan; do not stop production, delete a Container or invoke the retired Fly provider to test an alert.
- [ ] Browse to `https://api.kovasuite.com/health` — should return `{"status":"ok"}` within 2 s.
- [ ] Browse to `https://api.kovasuite.com/health/db` — should return `{"status":"ok","db":"reachable"}` within 5 s.
- [ ] Record incident/recovery timestamps and any gap. Do not require or report 100% uptime for a window containing an actual outage drill.

Log drill execution in this table:

| Date (UTC) | Operator | Notes |
|---|---|---|
| _2026-MM-DD_ | _role_ | _notification result / detection scope / recovery evidence / remaining gaps_ |

## Sentry del navegador

El frontend usa el proyecto de navegador existente de Sentry. El DSN público de ingestión
se obtiene en Settings → Projects → proyecto del frontend → Client Keys (DSN). No es un
token de administración y no requiere crear claves, usuarios ni permisos nuevos.

En el proyecto Vercel que prepara el candidato del pipeline, guardar `VITE_SENTRY_PUBLIC_DSN`
como **Config**, en los entornos Production y Preview. El pipeline toma esta configuración
al compilar y publica los mismos archivos validados en Cloudflare. No guardar tokens privados
en variables `VITE_*` ni incluir un password de DSN deprecado.

La compilación valida este valor y lo aplica tanto al cargador diferido como a la inicialización
existente del SDK. Si falta, mantiene compatibilidad con un `VITE_SENTRY_DSN` válido. Sin ambos,
los builds locales/de pruebas permanecen sin Sentry. Un valor configurado inválido bloquea el
build sin imprimirlo. No se suprimen errores para simular observabilidad funcionando.

El incidente del 26 de octubre de 2026 se detectó como `Invalid Sentry Dsn`. La variable anterior
estaba guardada como Secret; esa clase de valor no se recupera al preparar el build local del
pipeline. Vercel impide convertirla en Config en sitio. La variable pública explícita permite
corregirlo conservando la configuración anterior, sin eliminar ni revelar secretos.

Antes de cerrar una publicación:

1. Comprobar los gates del commit y publicar mediante el pipeline con recuperación habitual.
2. Confirmar frontend/API y cargar el bundle nuevo mediante la actualización segura de la PWA.
3. Comprobar que desaparece `Invalid Sentry Dsn`.
4. Enviar un único evento de aceptación sin datos personales desde el SDK del frontend y
   comprobar en Sentry proyecto, entorno `production` y release del build publicado.
5. Mantener las opciones existentes de privacidad y ausencia de muestreo de transacciones.

El backend conserva su configuración independiente. Esta corrección no activa WhatsApp,
correo, pagos ni otros proveedores externos.
