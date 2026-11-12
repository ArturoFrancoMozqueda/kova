# Fuentes y verificación del contexto de Kova

Material de referencia para mantener [KOVA_BRAND_CONTEXT.md](KOVA_BRAND_CONTEXT.md).
La revisión funcional corresponde al 10 de noviembre de 2026. Los precios y estados registrados
requieren comprobación actual antes de convertirse en una oferta pública.

El posicionamiento de marca no está limitado a México, conforme a la corrección del dueño.
Las referencias históricas al mercado mexicano, la oferta en MXN y los contratos de CFDI
se conservan como contexto de producto; no establecen una exclusividad geográfica de la marca.

## Fuentes del producto

Actualizar esta guía cuando cambie el producto, la oferta, una preferencia de marca o lo aprendido
de clientes. No cambiar identidad por una tendencia ni dar por actuales los precios solo porque
aparecen aquí. Conservar una única guía de contexto y actualizar su fecha y fuentes.

Corte funcional consultado: `4504693360b03bb04502baf3223ea3bfe48e9571` de `ArturoFrancoMozqueda/kova`.
Fuentes de ese corte:

- [Estado productivo y gates](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/docs/current-sprint.md).
- [Capacidades y límites por plan](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/specs/billing/commercial_plans.md).
- [Autorización de oferta productiva](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/docs/adr/ADR-021-commercial-production-activation.md).
- [Dirección y contexto de producto](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/docs/claude/product-context.md).
- [Prueba vigente](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/frontend/src/billing/trial.ts).

El apartado comercial de contexto de producto aún describe la oferta como no publicada; el estado
productivo y ADR-021 posteriores acreditan Esencial/Gestión ON. Esa discrepancia se resuelve a favor
del estado productivo y contrato vigentes; no se presenta Standard como oferta nueva.

Identidad y preferencias creativas: paquete de Kova Content Studio y sus referencias de marca,
playbook editorial y dirección social consultados en esta revisión. Sus reglas esenciales están
incluidas aquí para permitir uso independiente; no se requiere instalar el paquete para leer la guía.
Los binarios de assets se aportan por separado cuando sean necesarios para producir.

### Cobertura de la revisión funcional

Se contrastaron el registro de 45 módulos de rutas API, el mapa de rutas y navegación de frontend,
51 documentos de contrato funcional y fuentes de implementación/política de los dominios. La
revisión incluyó definiciones de pruebas existentes para lotes, agenda, automatizaciones,
conciliación y modificadores; leerlas no equivale a ejecutarlas. No se modificó producto ni se
realizaron escrituras de negocio para preparar esta guía.

Fuentes de alcance transversal:

- [Registro de rutas API](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/backend/app/route_registry.py).
- [Rutas del producto](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/frontend/src/App.tsx)
  y [navegación/controles de exposición](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/frontend/src/layout/AppShell.tsx).
- [Catálogo de planes del servidor](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/backend/app/billing/plans.py),
  [política por operación](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/backend/app/billing/plan_policy.py)
  y [rollouts](https://github.com/ArturoFrancoMozqueda/kova/blob/4504693360b03bb04502baf3223ea3bfe48e9571/backend/app/tenants/feature_flags.py).

Trazabilidad por familia; rutas relativas al repositorio del corte indicado, opcionales para usar
esta guía y útiles para actualizar una afirmación concreta:

| Familia | Implementación/contrato contrastado |
|---|---|
| Arranque, catálogo y modificadores | `backend/app/onboarding/service.py`, `backend/app/catalog/{router,schemas}.py`, `backend/app/modifiers/{router,schemas}.py`, `specs/catalog/import_xlsx.md`, `specs/customers/customers_barcodes.md`. |
| Venta, precios, efectivo y tickets | `backend/app/orders/{router,schemas}.py`, `backend/app/pricing/calculator.py`, `backend/app/shifts/router.py`, `specs/sales-pricing.md`, `specs/orders/{receipt,offline_sync}.md`, `specs/settings/receipt.md`. |
| Inventario y abastecimiento | `backend/app/inventory/{router,lot_router}.py`, `specs/inventory/lots.md`, `specs/purchasing/purchasing.md`, `specs/automations/replenishment.md`, `specs/reports/restock_decisions.md`. |
| Sucursales y equipo | `backend/app/branches/router.py`, `specs/branches/{multi_location,inventory_transfers}.md`, `specs/settings/employees.md`. |
| Clientes y CRM | `backend/app/customers/router.py`, `specs/customers/customer_activity.md`, `specs/crm/{commercial_crm,commercial_engagement}.md`, `specs/quotes/customer_quotes.md`. |
| Menú, pedidos y seguimiento | `specs/storefront/{public_catalog,order_acceptance_tracking}.md`, `specs/customer_orders/customer_orders.md`, `backend/app/route_registry.py`. |
| Agenda, casos y pendientes | `backend/app/{appointments,service_cases,operations_queue,automations}/router.py`, `specs/appointments/internal-agenda.md`, `specs/service_cases/internal_service.md`, `specs/operations_queue/internal_queue.md`, `specs/automations/automation_engine.md`. |
| Lealtad y canales | `backend/app/loyalty/router.py`, `specs/loyalty/{internal_points,digital_card,public_enrollment,pos_rewards}.md`, `specs/integrations/messaging-inbox.md`. |
| Dirección y finanzas | `backend/app/reports/{router,control}.py`, `specs/reports/{range,smart_insights,dashboard_control_center,analysis_activation}.md`, `backend/app/expenses/{router,schemas,service}.py`, `specs/reconciliation/bank_reconciliation.md`. |
| Fiscal e integraciones | `backend/app/{fiscal,integrations}/router.py`, `specs/tax/fiscal_snapshots.md`, `specs/integrations/{provider-readiness,cfdi-contract}.md`. |
| Asistente, cuenta y equipos | `backend/app/assistant/{access,direct,tools,router}.py`, `docs/adr/ADR-017-asistente-respuestas-ancladas.md`, `backend/app/account_lifecycle/router.py`, `specs/shifts/cash_drawer.md`, `docs/current-sprint.md`. |

Las rutas entre llaves son abreviaturas de lectura, no archivos adicionales requeridos por un
harness. Los contratos históricos que dicen «publicación pendiente» se contrastan con el release;
las condiciones externas del estado vigente permanecen abiertas aunque el código esté publicado.
