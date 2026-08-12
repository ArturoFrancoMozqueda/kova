# Email deliverability — Kova

Pre-beta checklist for the five Kova lifecycle emails:
verificación, bienvenida (post-checkout), recibo de pago, fin de prueba,
y reset de contraseña.

## 1. Sending domain (Resend)

- [ ] Dominio de envío configurado en Resend (p. ej. `mail.kovasuite.com`).
- [ ] `EMAIL_FROM` en producción apunta a una dirección de ese dominio
      (p. ej. `Kova <hola@mail.kovasuite.com>`). El startup-gate ya bloquea
      `onboarding@resend.dev` en producción.
- [ ] `RESEND_API_KEY` set en producción. El startup-gate aborta el boot
      si falta.

## 2. Registros DNS

Todos en el panel del proveedor del dominio raíz, no del subdominio
salvo donde se indique.

### SPF
- [ ] Registro `TXT` en el dominio de envío (subdominio si aplica):
      `v=spf1 include:_spf.resend.com -all`
- [ ] Verificar con `dig TXT mail.kovasuite.com +short` (o `nslookup -q=txt`).

### DKIM
- [ ] Resend muestra el `CNAME` DKIM a publicar — pegarlo tal cual
      (suele ser `resend._domainkey.<dominio>` apuntando a un host de
      Resend).
- [ ] Estado `Verified` en el dashboard de Resend antes de enviar a
      producción.

### DMARC
- [ ] Política inicial, modo `quarantine`, sin afectar legítimos:
      ```
      TXT _dmarc.kovasuite.com
      v=DMARC1; p=quarantine; rua=mailto:dmarc@kovasuite.com; pct=100; adkim=s; aspf=s
      ```
- [ ] Buzón `dmarc@kovasuite.com` activo y monitoreado al menos las primeras
      dos semanas.
- [ ] Subir a `p=reject` cuando los reportes muestren 0 fallos durante
      14 días seguidos.

### MX / return-path (opcional pero recomendado)
- [ ] Si Resend pide un `return-path` (bounce) personalizado, añadir el
      `CNAME` indicado (mejora alineación SPF).

## 3. QA real de entrega

Para cada uno de los 5 emails, enviar a un buzón real y verificar:

| Email | Trigger en local | Buzones a probar |
|---|---|---|
| verificación | `POST /api/v1/auth/signup` | Gmail, Outlook/Hotmail, iCloud |
| bienvenida | webhook `checkout.session.completed` (Stripe CLI) | mismos |
| recibo de pago | webhook `invoice.payment_succeeded` | mismos |
| fin de prueba | `uv run python scripts/send_trial_reminders.py` con `created_at` ajustado | mismos |
| reset de contraseña | `POST /api/v1/auth/password-reset` | mismos |

Checklist por buzón:

- [ ] Llega a **inbox**, no a spam ni a promociones.
- [ ] Remitente se muestra como `Kova <hola@mail.kovasuite.com>` (no como
      "via resend.dev").
- [ ] Asunto sin truncar, sin caracteres Unicode rotos.
- [ ] Enlaces abren al dominio correcto (`https://kovasuite.com/...`) y
      funcionan en una pestaña privada.
- [ ] Render correcto en Gmail web, Gmail iOS/Android, Outlook web,
      Outlook desktop, Hotmail web.
- [ ] Modo oscuro de Gmail/Outlook no rompe el contraste.
- [ ] Copy en es-MX revisado por humano (sin "thee", sin "you", sin
      placeholders sin sustituir).
- [ ] Verificar headers en Gmail (`Show original`):
      `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

## 4. Métricas post-lanzamiento

- [ ] Dashboard de Resend monitoreado primeras 2 semanas: bounce rate
      <2%, complaint rate <0.1%.
- [ ] Si bounce rate sube, pausar campañas no transaccionales y revisar
      higiene de la lista.

## 5. Cron de recordatorio de prueba

- [ ] Configurar cron (Render Cron Job, GitHub Actions schedule, o
      systemd timer) que ejecute una vez al día:
      `uv run python scripts/send_trial_reminders.py`
- [ ] Recomendado: 14:00 UTC (08:00 CDMX) para que los correos lleguen
      en horario laboral.
- [ ] Logs del cron persistidos al menos 30 días.
