# Beta Support Spec

## Beta Model

3 friendly beta tenants. Founder-assisted onboarding. $199 MXN/month (Standard Plan).

## Support Channel

**Minimum for beta:** A dedicated email address or WhatsApp group per tenant.
- Suggested: `beta@[yourdomain]` forwarded to engineering
- Response SLA: same business day for P0/P1 issues

## Feedback Process

- Weekly 30-minute call per beta tenant for the first month
- Written feedback form after first week (simple Google Form or Notion)
- All feedback logged in `docs/beta-feedback.md` (to be created)
- P0/P1 bugs go directly into sprint backlog

## Beta Agreement

Before access, each beta tenant signs a 1-page agreement covering:
- Beta status: software may have bugs
- Data handling: production data, backed up daily
- Price: $199 MXN/month (subject to change after beta)
- Feedback commitment: weekly call, written feedback
- No long-term contract: cancel any time
- Disclaimer: no SLA during beta

Template location: `docs/beta-agreement-template.md` (to be created)

## Onboarding Checklist (per tenant)

1. Tenant signs beta agreement
2. Engineering creates tenant account via signup flow
3. Engineering seeds a small sample catalog (5 categories, 10 products)
4. Owner walkthrough: login, catalog review, first sale, shift, reports
5. Billing: Stripe Standard Plan activated at $199 MXN
6. Support channel established (email or WhatsApp)
7. Sentry tenant_id noted for log filtering

## Runbook Locations

- Restore drill: `specs/ops/backups.md`
- Log access: `fly logs -a pos-project-backend`
- Stripe dispute: Stripe dashboard → Disputes
- P0 incident: notify tenant immediately, patch within 4 hours

## Acceptance Criteria

- Support email configured and tested before beta launch.
- Beta agreement template complete.
- Onboarding checklist followed for each beta tenant.
- Feedback process documented and agreed with each tenant.
