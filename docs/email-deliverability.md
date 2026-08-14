# Entregabilidad de correo — Kova

Estado verificado el 12 de agosto de 2026 para los cinco correos de ciclo de vida:
verificación, bienvenida, recibo de pago, fin de prueba y restablecimiento de contraseña.

## 1. Configuración de producción

- [x] Dominio `mail.kovasuite.com` verificado en Resend.
- [x] Remitente efectivo: `Kova <no-reply@mail.kovasuite.com>`.
- [x] `RESEND_API_KEY` configurada en Fly.io. El startup gate bloquea producción si falta.
- [x] `EMAIL_FROM` configurado con el dominio verificado. El startup gate rechaza
      `onboarding@resend.dev` en producción.

No copies valores de secretos a tickets, logs, documentos o comandos locales. Para comprobar su
presencia usa únicamente los nombres de las variables o el startup gate.

## 2. DNS publicado en Cloudflare

Los siguientes valores son los que Resend asignó a este dominio; no los sustituyas por ejemplos
genéricos de otros proveedores.

### SPF y return path

- [x] `TXT send.mail.kovasuite.com`:
      `v=spf1 include:amazonses.com ~all`
- [x] `MX send.mail.kovasuite.com`, prioridad `10`:
      `feedback-smtp.us-east-1.amazonses.com`
- [x] Ambos registros aparecen como verificados en Resend y responden en DNS público.

### DKIM

- [x] `TXT resend._domainkey.mail.kovasuite.com` publicado con la clave entregada por Resend.
- [x] Estado `Verified` en Resend y resolución confirmada en DNS público.

### DMARC

- [x] `TXT _dmarc.kovasuite.com`:
      `v=DMARC1; p=quarantine; rua=mailto:dmarc@kovasuite.com; pct=100; adkim=s; aspf=s`
- [x] La misma política está publicada en `_dmarc.mail.kovasuite.com` para el subdominio remitente.
- [x] Cloudflare Email Routing está habilitado.
- [x] `dmarc@kovasuite.com` reenvía a `posprojectsupport@gmail.com`.
- [ ] Mantener el buzón y los reportes bajo observación durante 14 días antes de considerar
      `p=reject`. El cambio requiere cero fallos legítimos sostenidos y una revisión explícita.

## 3. Evidencia de entrega

El 12 de agosto de 2026 se envió una prueba controlada desde el backend desplegado en Fly.io a
`dmarc@kovasuite.com`, usando la configuración real de producción. Resultado:

- [x] Resend: `delivered`.
- [x] Cloudflare Email Routing: mensaje reenviado al destino operativo.
- [x] Gmail web: llegó a Inbox en aproximadamente un segundo.
- [x] Remitente visible: `Kova <no-reply@mail.kovasuite.com>`; sin `via resend.dev`.
- [x] Gmail “Show original”: `SPF: PASS`, `DKIM: PASS` para `mail.kovasuite.com` y
      `DMARC: PASS` con política `quarantine`.
- [x] Transporte al buzón final mediante TLS.

También se enviaron las cinco plantillas reales, prefijadas con `[QA Kova]` y con tokens inválidos
deliberadamente. No se crearon cuentas, cobros, suscripciones ni datos de cliente.

| Plantilla | Resend | Gmail web |
|---|---|---|
| Verificación | `delivered` | Inbox; asunto y texto en español correctos |
| Bienvenida | `delivered` | Inbox; asunto y texto en español correctos |
| Recibo de pago | `delivered` | Inbox; marcado como QA, sin cargo real |
| Fin de prueba | `delivered` | Inbox; asunto y texto en español correctos |
| Restablecimiento de contraseña | `delivered` | Inbox; token QA inválido |

La primera prueba visual confirmó que Gmail elimina SVG embebido. La plantilla base ahora usa el
isotipo PNG público `https://kovasuite.com/email/kova-mark.png`, mantiene el wordmark textual como
fallback y fija sus dimensiones para evitar saltos de layout.

### QA todavía pendiente

- [ ] Repetir las cinco plantillas en buzones de prueba Outlook/Hotmail e iCloud.
- [ ] Revisar render y modo oscuro en Gmail iOS/Android, Outlook web/desktop e iCloud.
- [ ] Abrir enlaces QA en una sesión privada y confirmar destino `https://kovasuite.com` sin usar
      tokens reales ni disparar cobros.
- [ ] Hacer revisión humana final de copy y contraste en cada cliente.

Usar buzones de QA, tokens deliberadamente inválidos y el registro sin PII de
[`runbooks/ops-beta-gate.md`](runbooks/ops-beta-gate.md). Un estado `delivered` del proveedor no
equivale a Inbox. OPS-1 permanece en curso hasta documentar Outlook y Hotmail; esta revisión tampoco
autoriza migrar el canal de soporte.

## 4. Monitoreo

- [ ] Revisar Resend y los reportes DMARC diariamente durante las primeras dos semanas.
- [ ] Mantener bounce rate por debajo de 2% y complaint rate por debajo de 0.1%.
- [ ] Ante un rebote permanente, corregir el destinatario y conservar la supresión; no reintentar
      repetidamente una dirección inexistente.
- [ ] Si aumenta el bounce rate, pausar mensajes no transaccionales y revisar la higiene de la lista.

La muestra actual es demasiado pequeña para inferir una tasa estable de entregabilidad.

## 5. Recordatorio de fin de prueba

- [x] GitHub Actions ejecuta `uv run python scripts/send_trial_reminders.py` diariamente a las
      `06:00 UTC` (`00:00` en Ciudad de México).
- [x] El job es idempotente por tenant mediante `trial_reminder_sent_at`.
- [x] Los diez runs programados más recientes al 12 de agosto de 2026 terminaron correctamente.
- [ ] Confirmar que la retención de logs operativos cubra al menos 30 días.
