# Beta Support Spec

## Beta Model

3 friendly beta tenants. Founder-assisted onboarding. $299 MXN/month (Standard Plan).

## Support Channel

**Canal oficial durante la beta:** `posprojectsupport@gmail.com`.

- La ayuda autenticada muestra siempre el correo oficial.
- WhatsApp aparece como canal secundario solo mientras exista un número verificado configurado en la fuente de verdad del frontend.
- La ayuda puede adjuntar el último `X-Request-ID` seguro observado en una respuesta de la API. No adjunta tenant, correo del usuario, cookies, tokens, cuerpos de respuesta ni datos de pago.
- La beta no promete un SLA formal. Los incidentes que impiden operar se atienden con prioridad durante el horario hábil publicado.

## Feedback Process

- Weekly 30-minute call per beta tenant for the first month
- Written feedback form after first week (simple Google Form or Notion)
- All feedback logged in `docs/beta-feedback.md` (to be created)
- P0/P1 bugs go directly into sprint backlog

## Beta Agreement

Before access, each beta tenant signs a 1-page agreement covering:
- Beta status: software may have bugs
- Data handling: production data, backed up daily
- Price: $299 MXN/month (subject to change after beta)
- Feedback commitment: weekly call, written feedback
- No long-term contract: cancel any time
- Disclaimer: no SLA during beta

Template location: `docs/beta-agreement-template.md` (to be created)

## Onboarding Checklist (per tenant)

1. Tenant signs beta agreement
2. Engineering creates tenant account via signup flow
3. Engineering seeds a small sample catalog (5 categories, 10 products)
4. Owner walkthrough: login, catalog review, first sale, shift, reports
5. Billing: Stripe Standard Plan activated at $299 MXN
6. Confirmar que el propietario puede abrir Ayuda y enviar correo al canal oficial
7. Para un incidente reproducible, confirmar que Ayuda muestra una referencia técnica correlacionable en logs

## Runbook Locations

- Restore drill: `specs/ops/backups.md`
- Log access: `fly logs -a pos-project-backend`
- Stripe dispute: Stripe dashboard → Disputes
- P0 incident: notify tenant immediately, patch within 4 hours

## Acceptance Criteria

- El correo oficial de soporte está configurado y se prueba antes del lanzamiento beta.
- WhatsApp no se renderiza si su número verificado está vacío.
- La referencia técnica contiene exclusivamente el `X-Request-ID` validado de una respuesta same-origin de `/api/`.
- Beta agreement template complete.
- Onboarding checklist followed for each beta tenant.
- Feedback process documented and agreed with each tenant.
