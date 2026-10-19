# Deferred Scope

This document protects the product from scope creep.

If a feature is listed here, do not implement it unless explicitly moved into the active sprint and approved.

## Authorized POS expansion (2026-10-05)

The owner explicitly authorized agent implementation, branch integration and deployment of the POS
expansion. Discounts/added taxes and snapshots, barcode support, customers/history, suppliers/purchases/
receiving, inventory transfers and optional employee branch restrictions are now integrated into the
release branch. Historical deferrals below no longer govern those capabilities. Current verification
and publication status lives in [`current-sprint.md`](current-sprint.md).

Issuer data and internal invoice requests are prepared, with requests explicitly pending provider.
Real CFDI/autofactura and terminal processing still require contracted providers and real credentials;
the owner confirms neither is currently contracted. The remaining roadmap capabilities stay gated.

## Deferred From Closed Beta

Actualización de dirección 2026-10-18: el propietario solicitó analizar Colega Studio y encaminar
Kova hacia automatización de negocio de punta a punta. El
[plan E2E](plans/PLAN-AUTOMATIZACION-E2E.md) abre discovery por fases para comunicación/CRM,
captación, operación y postventa, con extensiones por giro. Esta dirección amplía el horizonte del
copiloto; no mueve automáticamente agendas, lealtad, marketing masivo, API pública ni otras
capacidades diferidas al sprint. Para implementarlas siguen aplicando los criterios de entrada
al final de este documento y sus gates técnicos/comerciales.

Actualización de ejecución autorizada: captación revisable, bandeja/borradores y postventa interna
se implementaron en la continuación del circuito general. Su alcance, pruebas y canales aún sin
conectar se registran en el [informe de continuación](audits/KOVA-E2E-COMPLETION-2026-10-18.md).
Las extensiones por giro de este documento conservan sus contratos y aceptación propios.

Actualización 2026-10-19: la autorización explícita del propietario incorporó agenda interna por
recurso, puntos de lealtad internos y atención postventa con casos/notas/responsables. Esos cortes
acotados ya tienen contratos y validación local; las antiguas listas de deferrals no los bloquean.
El alcance especializado de citas/lealtad, promociones, campañas, compensaciones automáticas y
operación completa por giro sigue diferido. [Atención implementada y gates del release](
audits/KOVA-SERVICE-CASES-2026-10-19.md). La [cola de pendientes internos](
plans/PLAN-COLA-OPERATIVA-INTERNA.md) es sólo la siguiente propuesta; no se presenta implementada.

The closed beta should focus on a reliable bakery / small food retail POS.

Do not implement these for beta:

- Multiple pricing tiers
- Basic / Pro / Premium plans
- Plan-based feature gates
- Per-user pricing
- Per-location pricing
- Annual plans
- Add-ons
- Usage-based billing
- KDS
- Pedidos especializados por restaurante (mesas, comandas, estaciones de cocina)
- Tables / floor plan
- Appointments
- Loyalty
- Promotions engine
- Public API
- Webhooks
- Custom roles UI
- Stripe Terminal
- Hardware printer SDKs
- Advanced report builder
- Multi-currency
- White-label
- SSO
- Enterprise features
- Full restaurant production support
- Full salon production support
- Full clinic production support

## Deferred Until After Core POS Stability

These can be considered after the core flow is stable with beta tenants:

- Modifiers
- Retail preset
- Restaurant preset
- Product CSV import wizard
- Receipt template editor
- Advanced employee permissions

## Approved Roadmap, Still Gated

The owner-copilot roadmap in [`docs/plans/PLAN-KOVA-COPILOT.md`](plans/PLAN-KOVA-COPILOT.md) formally
approves the following capabilities for phased discovery and implementation. Approval does not make
them part of the active sprint: each phase must satisfy the preceding validation and production
gates before feature work begins.

- Discounts, configurable taxes, barcodes and fiscal sale snapshots.
- Lightweight customer records and purchase history.
- CFDI/autofactura through a verified PAC integration.
- Suppliers, purchase orders, receiving and auditable inventory cost updates.
- Customer credit, installments, due dates and aging.
- Deterministic Kova recommendations, owner goals and a weekly action plan.
- Read-only natural-language questions over an approved semantic layer.
- Mobile owner supervision.

Multi-location operation and branch comparison were explicitly moved into the active sprint by
the owner on 2026-10-05. See [`current-sprint.md`](current-sprint.md) and the
[`branch spec`](../specs/branches/multi_location.md); that authorization supersedes the former
Phase 4 demand gate. Transfers and staff restrictions moved into the authorized October 5 expansion;
branch-specific prices remain deferred. The
roadmap does not approve a generic AI chatbot, autonomous mutations, generated SQL against
production, accounting, payroll, KDS, manufacturing, a marketplace or mass marketing automation.

## Deferred Until Post-GA

These should not be considered until there is real usage, support capacity, and revenue signal:

- Stripe Terminal
- KDS
- Tables/floor plan
- Appointments
- Loyalty
- Promotions
- Public API
- Webhooks
- White-label
- SSO
- SCIM
- Enterprise admin
- Franchise hierarchy
- Multi-currency
- Marketplace/plugins
- AI features outside the constrained, read-only Kova scope above

## Explicit Non-Goals for v1

- Becoming a full restaurant platform from day one.
- Competing with enterprise POS systems.
- Supporting complex tax jurisdictions before beta.
- Supporting hardware ecosystems before the core POS works.
- Building microservices.
- Creating an app marketplace.
- Supporting every possible business type in beta.

## Rule

A deferred feature can only move into scope if:

1. There is a written Feature Spec.
2. It is added to `docs/current-sprint.md`.
3. It does not break the north star flow.
4. It does not delay beta-critical work.
5. It has clear BDD scenarios and acceptance criteria.
