# Runbook: Uptime monitoring (UptimeRobot)

Production uptime for Kova is monitored by **UptimeRobot** (free plan, account owner: `posprojectsupport@gmail.com`). This runbook documents what is monitored, what each alert means, and how to act on failures.

> **Why UptimeRobot and not GitHub Actions?** A previous `uptime.yml` workflow polled `/health` every 10 minutes and consumed ~4,300 Actions minutes/month — well over the free tier. It was deleted in favor of UptimeRobot, which polls every 5 minutes for free and is purpose-built for this. Do not re-add the workflow.

---

## What is monitored

Three HTTP/S monitors, each checked every 5 minutes from UptimeRobot's global probes:

| Monitor | URL | What it proves when green |
|---|---|---|
| **Kova API health** | `https://api.kovasuite.com/health` | Fly machine is up, FastAPI is serving, TLS cert is valid, DNS resolves. Does **not** touch the database. |
| **Kova API + DB** | `https://api.kovasuite.com/health/db` | Everything above **plus** the backend can execute `SELECT 1` against Supabase (`get_current_session` → DB pool → Supabase pooler). |
| **Kova frontend** | `https://kovasuite.com` | Vercel is serving, DNS for the apex domain resolves, the SPA bundle loads. |

All three call `HEAD` by default. Both backend health endpoints support HEAD explicitly ([backend/app/health/router.py](../../backend/app/health/router.py)).

---

## Alert channels

Configured per monitor under *Alert Contacts*:

| Channel | Where it lands | Use |
|---|---|---|
| E-mail | `posprojectsupport@gmail.com` | Primary. Arrives within seconds of a confirmed down event. |
| Mobile push | UptimeRobot app on the operator's phone | Optional but recommended — wakes the operator outside Gmail hours. Install the app and add a "Mobile push" alert contact. |

> SMS and Voice are **disabled** by default — UptimeRobot bills SMS credits separately and is not worth enabling until paid clients exist. Leave them off.

UptimeRobot only fires an alert after the second consecutive failed probe to avoid false positives from a single network blip. Expect a minimum lag of ~5 min between true outage and email.

---

## Triage matrix

When an alert fires, look at **which combination** of monitors is down. That isolates the failure layer before you open any console.

| API health | API + DB | Frontend | Likely cause | First action |
|---|---|---|---|---|
| 🔴 | 🔴 | 🟢 | Backend down (Fly machine, app crash, OOM) | `fly status -a pos-project-backend` and `fly logs -a pos-project-backend` |
| 🟢 | 🔴 | 🟢 | Supabase unreachable from Fly (DB password rotated, pool exhausted, Supabase incident, RLS misconfig) | Open Supabase dashboard → project status. Verify `DATABASE_URL` in `fly secrets list -a pos-project-backend` matches the current Supabase password. |
| 🟢 | 🟢 | 🔴 | Vercel down, Vercel deploy broke, DNS for apex root broke | Vercel dashboard → deployments. Cloudflare DNS for `kovasuite.com`. |
| 🔴 | 🔴 | 🔴 | DNS root, Cloudflare incident, or TLS cert expired across the board | Cloudflare dashboard. Check `nslookup api.kovasuite.com` and `nslookup kovasuite.com` from a different network. |
| 🔴 | 🟢 | — | **Impossible state — investigate the monitor itself.** `/health/db` returns 200 implies `/health` should too. Probably UptimeRobot probe issue, not your app. | Re-run "Test Notification" / probe from UptimeRobot. |
| 🟢 | 🟢 | 🟢 | False alarm or transient network blip already recovered | Confirm in UptimeRobot incident history. Document the blip if it persists. |

---

## Common failures and fixes

### `/health/db` returns 405 Method Not Allowed
Cause: monitor is using HEAD against an endpoint without a HEAD handler. As of `health/router.py` both endpoints support HEAD — but if you ever add a new health endpoint, remember to declare both `@router.get(...)` and `@router.head(...)` or UptimeRobot's probes will 405.

### Frontend monitor goes red right after a Vercel deploy
Vercel sometimes serves a 404 for a few seconds during a deploy swap. UptimeRobot's 2-probe confirmation usually absorbs this. If alerts fire repeatedly on every deploy, raise the *Monitor Timeout* in UptimeRobot or set *Confirmation needs* to 3.

### All three monitors red, app actually works in the browser
Almost always a Cloudflare DNS-only proxy toggle. The DNS records for `api.kovasuite.com`, `kovasuite.com`, and `www.kovasuite.com` **must stay grey-cloud (Proxy: OFF / DNS only)** — Fly and Vercel handle their own TLS and Cloudflare proxy mode breaks the cert handshake. If someone flipped a record to orange-cloud, flip it back.

### Long downtime in *Last 30 days* stat
Historical artifact from monitor URL changes (e.g., the migration from `pos-project-backend.fly.dev` to `api.kovasuite.com` left the 30-day window with old downtime baked in). Ignore — *Last 7 days* and *Last 24 hours* are the live signals.

---

## Operating the dashboard

Account login: UptimeRobot dashboard at `dashboard.uptimerobot.com` with `posprojectsupport@gmail.com`.

| Action | Where |
|---|---|
| Pause a monitor (e.g., for planned maintenance) | Monitor row → ⋯ → Pause. Remember to un-pause. |
| Add a new monitor | **+ New monitor** → HTTP(S) → fill URL + friendly name + 5-min interval → assign alert contacts. |
| Change alert recipients | **My Settings** → Alert Contacts. Apply to monitors via Edit. |
| Maintenance windows (no alerts during deploys) | **Maintenance** tab → schedule a window. Useful for planned Supabase upgrades. |
| Public status page | **Status pages** tab. Free plan gives a UptimeRobot-branded URL (`stats.uptimerobot.com/<id>`). Custom domain (`status.kovasuite.com`) requires the paid plan — deferred until paid tenants exist. |

---

## When to add more monitors

Add a new monitor when a new externally-reachable surface becomes load-bearing for revenue or trust:

- **Stripe webhook endpoint** (`https://api.kovasuite.com/api/v1/billing/webhooks/stripe`) — once Stripe live is on, a silent webhook outage means missed subscription events. Add a monitor.
- **Resend email service** — not directly monitorable, but you can monitor a self-hosted `/health/email` if you ever add one.
- **Status page itself** (once we have one).

Do **not** add monitors for internal-only endpoints (admin paths, internal APIs) — UptimeRobot probes from the public internet and they would just 401 every time.

---

## Escalation

Today (pre-Stripe-live, no paid tenants):
1. Email lands in `posprojectsupport@gmail.com`.
2. Operator (Arturo) responds when they see it.
3. No on-call rotation.

After first paid tenants (TODO before Stripe live):
1. Add mobile push notification to the operator's phone.
2. Document an SLA target (e.g., "respond to API down within 1 h business hours, 4 h overnight").
3. Decide whether to enable SMS — costs UptimeRobot credits but wakes the operator outside business hours.

---

## Verification checklist (quarterly drill)

Run this at least once per quarter to confirm the alerting actually works end-to-end:

- [ ] In UptimeRobot, click **Test Notification** on each of the 3 monitors. Confirm email arrives.
- [ ] Manually pause Fly: `fly scale count 0 -a pos-project-backend`. Wait 10 min, confirm alert fires for **Kova API health** and **Kova API + DB**. Restore with `fly scale count 1 -a pos-project-backend`.
- [ ] Browse to `https://api.kovasuite.com/health` — should return `{"status":"ok"}` within 2 s.
- [ ] Browse to `https://api.kovasuite.com/health/db` — should return `{"status":"ok","db":"reachable"}` within 5 s.
- [ ] Confirm *Last 24 hours* row shows 100% on all 3 monitors after the drill.

Log drill execution in this table:

| Date (UTC) | Operator | Notes |
|---|---|---|
| _2026-MM-DD_ | _name_ | _Test Notification OK / fly scale 0 alert fired / restored_ |
