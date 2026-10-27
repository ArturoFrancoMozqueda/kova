"""Original route order, loaded on demand only by the production Worker."""

from importlib import import_module

# Prefixes are routing hints only. Original routers keep their dependencies,
# methods, DTOs, ownership checks and internal route order.
ROUTERS = (
    ('app.health.router', ('/health',)),
    ('app.hardware.router', ('/api/v1/hardware',)),
    ('app.account_lifecycle.router', ('/api/v1/account', '/api/v1/export/account')),
    ('app.auth.router', ('/api/v1/auth',)),
    ('app.automations.router', ('/api/v1/automations',)),
    ('app.crm.router', ('/api/v1/crm',)),
    ('app.crm.engagement_router', ('/api/v1/crm',)),
    ('app.messaging.router', ('/api/v1/messaging',)),
    ('app.appointments.router', ('/api/v1/appointments',)),
    ('app.loyalty.enrollment_router', (
        '/api/v1/loyalty/enrollment-policy', '/api/v1/loyalty/members',
        '/api/v1/public/loyalty/membership',
    )),
    ('app.loyalty.router', ('/api/v1/loyalty',)),
    ('app.loyalty.public_router', ('/api/v1/public/loyalty',)),
    ('app.service_cases.router', ('/api/v1/service-cases',)),
    ('app.operations_queue.router', ('/api/v1/operations',)),
    ('app.storefront.router', (
        '/api/v1/storefront', '/api/v1/public/catalog', '/api/v1/public/order-tracking',
    )),
    ('app.assistant.router', ('/api/v1/assistant',)),
    ('app.billing.router', ('/api/v1/billing',)),
    ('app.branches.router', ('/api/v1/branches',)),
    ('app.business_settings.router', ('/api/v1/settings',)),
    ('app.business_settings.logo_router', ('/api/v1/settings',)),
    ('app.catalog.router', ('/api/v1/catalog',)),
    ('app.customer_orders.router', ('/api/v1/customer-orders',)),
    ('app.customers.router', ('/api/v1/customers',)),
    ('app.integrations.router', ('/api/v1/integrations',)),
    ('app.cfdi.router', ('/api/v1/integrations/cfdi',)),
    ('app.purchasing.router', ('/api/v1/purchasing',)),
    ('app.quotes.router', ('/api/v1/quotes',)),
    ('app.replenishment.router', ('/api/v1/replenishment',)),
    ('app.reconciliation.router', ('/api/v1/reconciliation',)),
    ('app.catalog.image_router', ('/api/v1/catalog',)),
    ('app.employees.router', ('/api/v1/employees',)),
    ('app.expenses.router', ('/api/v1/expenses',)),
    ('app.fiscal.router', ('/api/v1/fiscal',)),
    ('app.modifiers.router', ('/api/v1/catalog',)),
    ('app.inventory.router', ('/api/v1/inventory',)),
    ('app.inventory.lot_router', ('/api/v1/inventory',)),
    ('app.imports.router', ('/api/v1/catalog/import',)),
    ('app.onboarding.router', ('/api/v1/onboarding',)),
    ('app.ops.router', ('/api/v1/internal/ops',)),
    ('app.ops.mfa_router', ('/api/v1/internal/ops/mfa',)),
    ('app.orders.router', ('/api/v1/orders',)),
    ('app.reports.router', ('/api/v1/reports',)),
    ('app.shifts.router', ('/api/v1/shifts',)),
    ('app.sync.router', ('/api/v1/sync',)),
    ('app.telemetry.router', ('/api/v1/telemetry',)),
)


def include_routes(app, path=None):
    loaded = getattr(app.state, "loaded_router_modules", set())
    for module, prefixes in ROUTERS:
        if module in loaded:
            continue
        if path is not None and not any(
            path == prefix or path.startswith(prefix + "/") for prefix in prefixes
        ):
            continue
        app.include_router(import_module(module).router)
        loaded.add(module)
    app.state.loaded_router_modules = loaded
    app.openapi_schema = None


class LazyRoutes:
    """RequestCoordinator serializes loading and ASGI cleanup for each object."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            include_routes(self.app, scope["path"])
        await self.app(scope, receive, send)
