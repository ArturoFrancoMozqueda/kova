"""Exact SQL aggregates of existing records, never counts of bounded UI lists.

Every source filters tenant and the validated supervision branches explicitly.
Optional areas use savepoints: a failed source is unavailable, never a fake zero.
No provider call, task processing, configuration write or message send occurs here.
"""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import and_, case, func, literal, select, union_all
from sqlalchemy.exc import SQLAlchemyError

from app.appointments.models import Appointment, AppointmentReminder
from app.automations.models import AutomationRule, AutomationRun
from app.branches.models import Branch
from app.catalog.models import Product
from app.cfdi.models import CfdiConnection, CfdiDocument
from app.crm.engagement_models import CatalogRequest, FollowupTask
from app.crm.models import Opportunity
from app.customer_orders.models import CustomerOrder, InventoryReservation
from app.customers.models import Customer
from app.inventory.models import InventoryLot, InventoryLotAllocation, InventoryLotReservation
from app.loyalty.models import LoyaltyPolicyRevision
from app.messaging.models import Conversation, Message
from app.messaging.readiness import readiness
from app.orders.models import InventoryMovement, Order, Payment
from app.pricing.calculator import money as round_money
from app.purchasing.models import PurchaseOrder
from app.quotes.models import CustomerQuote
from app.rbac.permissions import Permission, has_permission
from app.reconciliation.models import ReconciliationMatch, SettlementEntry
from app.reports import service
from app.reports.control_schemas import (
    ControlAlert,
    ControlArea,
    ControlBranch,
    ControlBranchSales,
    ControlMetric,
    DashboardControl,
)
from app.service_cases.models import ServiceCase
from app.shifts.models import CashMovement, Shift
from app.storefront.models import PublicCatalog
from app.tenants.feature_flags import CUSTOMER_ORDERS, MARGIN_REPORTS, resolve_feature_flags
from app.tenants.models import Tenant

ACTIVE_ORDERS = ("new", "confirmed", "in_progress", "ready")
ACTIVE_CASES = ("open", "in_progress", "reopened")
ALERT_LIMIT = 12


def _counts(db, tenant, branches, specs):
    """One union aggregate round-trip per area; zero is backed by a successful SELECT."""
    result = {key: defaultdict(int) for key, _, _ in specs}
    statements = [
        select(literal(key), model.branch_id, func.count())
        .where(
            model.tenant_id == tenant,
            model.branch_id.in_(branches),
            condition,
        )
        .group_by(model.branch_id)
        for key, model, condition in specs
    ]
    if statements:
        for key, branch, count in db.execute(union_all(*statements)):
            result[key][branch] = count
    return result


def _inventory(db, tenant, branches, today):
    movements = (
        select(
            InventoryMovement.branch_id,
            InventoryMovement.product_id,
            func.sum(InventoryMovement.quantity_delta).label("quantity"),
        )
        .where(
            InventoryMovement.tenant_id == tenant,
            InventoryMovement.branch_id.in_(branches),
        )
        .group_by(InventoryMovement.branch_id, InventoryMovement.product_id)
        .subquery()
    )
    reserved = (
        select(
            InventoryReservation.branch_id,
            InventoryReservation.product_id,
            func.sum(InventoryReservation.quantity).label("quantity"),
        )
        .where(
            InventoryReservation.tenant_id == tenant,
            InventoryReservation.branch_id.in_(branches),
            InventoryReservation.status == "active",
        )
        .group_by(InventoryReservation.branch_id, InventoryReservation.product_id)
        .subquery()
    )
    stock = func.coalesce(movements.c.quantity, 0)
    reservation = func.coalesce(reserved.c.quantity, 0)
    # Catalog is tenant-wide; zero ledger rows still mean zero stock at that branch.
    positions = (
        select(
            Branch.id.label("branch_id"),
            Product.id.label("product_id"),
            stock.label("stock"),
            reservation.label("reserved"),
            func.greatest(0, stock - reservation).label("available"),
            Product.low_stock_threshold.label("threshold"),
            Product.is_active.label("is_active"),
        )
        .select_from(Branch)
        .join(Product, Product.tenant_id == Branch.tenant_id)
        .outerjoin(
            movements,
            and_(movements.c.branch_id == Branch.id, movements.c.product_id == Product.id),
        )
        .outerjoin(
            reserved,
            and_(reserved.c.branch_id == Branch.id, reserved.c.product_id == Product.id),
        )
        .where(
            Branch.tenant_id == tenant,
            Branch.id.in_(branches),
            Product.tenant_id == tenant,
            Product.track_inventory.is_(True),
        )
        .subquery()
    )
    result = {
        key: defaultdict(int)
        for key in (
            "out_of_stock",
            "low_stock",
            "reserved_units",
            "stock_conflicts",
            "expiring_lots",
        )
    }
    for row in db.execute(
        select(
            positions.c.branch_id,
            func.count().filter(positions.c.available <= 0).label("out_of_stock"),
            func.count()
            .filter(
                and_(
                    positions.c.threshold.is_not(None),
                    positions.c.available <= positions.c.threshold,
                )
            )
            .label("low_stock"),
            func.coalesce(func.sum(positions.c.reserved), 0).label("reserved_units"),
        )
        .where(positions.c.is_active.is_(True))
        .group_by(positions.c.branch_id)
    ).mappings():
        for key in ("out_of_stock", "low_stock", "reserved_units"):
            result[key][row["branch_id"]] = int(row[key])

    lot_stock = (
        select(
            InventoryLotAllocation.branch_id,
            InventoryLotAllocation.lot_id,
            func.sum(InventoryLotAllocation.quantity_delta).label("quantity"),
        )
        .where(
            InventoryLotAllocation.tenant_id == tenant,
            InventoryLotAllocation.branch_id.in_(branches),
        )
        .group_by(InventoryLotAllocation.branch_id, InventoryLotAllocation.lot_id)
        .subquery()
    )
    for branch, count in db.execute(
        select(lot_stock.c.branch_id, func.count())
        .join(
            InventoryLot,
            InventoryLot.id == lot_stock.c.lot_id,
        )
        .join(Product, Product.id == InventoryLot.product_id)
        .where(
            InventoryLot.tenant_id == tenant,
            Product.tenant_id == tenant,
            Product.is_active.is_(True),
            Product.track_lots.is_(True),
            lot_stock.c.quantity > 0,
            InventoryLot.expires_on <= today + timedelta(days=7),
        )
        .group_by(lot_stock.c.branch_id)
    ):
        result["expiring_lots"][branch] = count

    # Same conflict definition as customer_orders: aggregate reservations exceed
    # physical stock, or a reserved lot has a deficit. Count distinct orders.
    lot_reserved = (
        select(
            InventoryLotReservation.branch_id,
            InventoryLotReservation.lot_id,
            func.sum(InventoryLotReservation.quantity).label("quantity"),
        )
        .join(
            InventoryReservation,
            and_(
                InventoryReservation.id == InventoryLotReservation.reservation_id,
                InventoryReservation.tenant_id == InventoryLotReservation.tenant_id,
                InventoryReservation.branch_id == InventoryLotReservation.branch_id,
            ),
        )
        .where(
            InventoryLotReservation.tenant_id == tenant,
            InventoryLotReservation.branch_id.in_(branches),
            InventoryReservation.status == "active",
        )
        .group_by(InventoryLotReservation.branch_id, InventoryLotReservation.lot_id)
        .subquery()
    )
    conflicting_lots = (
        select(
            InventoryLotReservation.reservation_id,
        )
        .join(
            lot_reserved,
            and_(
                lot_reserved.c.branch_id == InventoryLotReservation.branch_id,
                lot_reserved.c.lot_id == InventoryLotReservation.lot_id,
            ),
        )
        .outerjoin(
            lot_stock,
            and_(
                lot_stock.c.branch_id == lot_reserved.c.branch_id,
                lot_stock.c.lot_id == lot_reserved.c.lot_id,
            ),
        )
        .where(
            InventoryLotReservation.tenant_id == tenant,
            InventoryLotReservation.branch_id.in_(branches),
            lot_reserved.c.quantity > func.coalesce(lot_stock.c.quantity, 0),
        )
    )
    for branch, count in db.execute(
        select(
            InventoryReservation.branch_id,
            func.count(func.distinct(InventoryReservation.customer_order_id)),
        )
        .join(
            CustomerOrder,
            and_(
                CustomerOrder.id == InventoryReservation.customer_order_id,
                CustomerOrder.tenant_id == InventoryReservation.tenant_id,
                CustomerOrder.branch_id == InventoryReservation.branch_id,
            ),
        )
        .join(
            positions,
            and_(
                positions.c.branch_id == InventoryReservation.branch_id,
                positions.c.product_id == InventoryReservation.product_id,
            ),
        )
        .where(
            InventoryReservation.tenant_id == tenant,
            InventoryReservation.branch_id.in_(branches),
            CustomerOrder.tenant_id == tenant,
            CustomerOrder.status.in_(ACTIVE_ORDERS),
            CustomerOrder.sale_order_id.is_(None),
            InventoryReservation.status == "active",
            (positions.c.reserved > positions.c.stock)
            | InventoryReservation.id.in_(conflicting_lots),
        )
        .group_by(InventoryReservation.branch_id)
    ):
        result["stock_conflicts"][branch] = count
    return result


def _cash(db, tenant, branches):
    # Same drawer equation as shifts.calculator, aggregated once across all open shifts.
    movement_totals = (
        select(
            CashMovement.shift_id,
            func.sum(
                case(
                    (CashMovement.type.in_(("opening_balance", "cash_in")), CashMovement.amount),
                    (CashMovement.type.in_(("cash_out", "refund_payout")), -CashMovement.amount),
                    else_=0,
                )
            ).label("amount"),
        )
        .where(CashMovement.tenant_id == tenant, CashMovement.branch_id.in_(branches))
        .group_by(
            CashMovement.shift_id,
        )
        .subquery()
    )
    cash_sales = (
        select(Order.shift_id, func.sum(Payment.amount_amount).label("amount"))
        .join(
            Payment,
            and_(Payment.order_id == Order.id, Payment.tenant_id == Order.tenant_id),
        )
        .where(
            Order.tenant_id == tenant,
            Order.branch_id.in_(branches),
            Order.status == "completed",
            Payment.method == "cash",
        )
        .group_by(Order.shift_id)
        .subquery()
    )
    return db.execute(
        select(
            func.coalesce(
                func.sum(
                    func.coalesce(movement_totals.c.amount, 0)
                    + func.coalesce(cash_sales.c.amount, 0),
                ),
                0,
            )
        )
        .select_from(Shift)
        .outerjoin(
            movement_totals,
            movement_totals.c.shift_id == Shift.id,
        )
        .outerjoin(cash_sales, cash_sales.c.shift_id == Shift.id)
        .where(
            Shift.tenant_id == tenant,
            Shift.branch_id.in_(branches),
            Shift.status == "open",
        )
    ).scalar_one()


def _unmatched(db, tenant, branches):
    confirmed = (
        select(
            ReconciliationMatch.settlement_entry_id,
            func.sum(ReconciliationMatch.matched_amount).label("amount"),
        )
        .where(
            ReconciliationMatch.tenant_id == tenant,
            ReconciliationMatch.branch_id.in_(branches),
            ReconciliationMatch.status == "confirmed",
        )
        .group_by(ReconciliationMatch.settlement_entry_id)
        .subquery()
    )
    remaining = SettlementEntry.net_amount - func.coalesce(confirmed.c.amount, 0)
    rows = db.execute(
        select(
            SettlementEntry.branch_id,
            func.count(),
            func.sum(remaining),
        )
        .outerjoin(confirmed, confirmed.c.settlement_entry_id == SettlementEntry.id)
        .where(
            SettlementEntry.tenant_id == tenant,
            SettlementEntry.branch_id.in_(branches),
            remaining > 0,
        )
        .group_by(SettlementEntry.branch_id)
    ).all()
    return {branch: count for branch, count, _ in rows}, sum(
        (amount for _, _, amount in rows),
        Decimal("0.00"),
    )


def read_control(
    db,
    *,
    tenant,
    role,
    branches,
    options,
    scope,
    story,
    now,
    billing,
    catalog_count,
    employee_count,
):
    """Projection authorized by reports.dashboard before entering this function."""
    flags = resolve_feature_flags(db.get(Tenant, tenant).feature_overrides)
    names = {branch.id: branch.name for branch in options}
    today = now.astimezone(service._tenant_timezone(db, tenant_id=tenant)).date()
    start, end = service._local_bounds(
        story.summary.start_date,
        story.summary.end_date,
        service._tenant_timezone(db, tenant_id=tenant),
    )
    today_start, today_end = service._local_bounds(
        today,
        today,
        service._tenant_timezone(db, tenant_id=tenant),
    )
    alerts = []
    areas = []
    values = {}

    def metric(key, label, value, route, *, fmt="count", basis="current", detail=None):
        return ControlMetric(
            key=key,
            label=label,
            value=str(value) if value is not None else None,
            format=fmt,
            scope=basis,
            route_key=route,
            detail=detail,
        )

    def total(key):
        return sum(values[key].values())

    def signal(key, title, route, priority="today", basis="current"):
        for branch, count in values.get(key, {}).items():
            if count:
                alerts.append(
                    ControlAlert(
                        key=key,
                        branch_id=branch,
                        branch_name=names[branch],
                        title=title,
                        count=count,
                        priority=priority,
                        route_key=route,
                        scope=basis,
                    )
                )

    def area(key, loader):
        before = len(alerts)
        try:
            with db.begin_nested():
                metrics = loader()
            areas.append(ControlArea(key=key, metrics=metrics))
        except SQLAlchemyError:
            # Never convert a source failure into an apparently clear business.
            del alerts[before:]
            areas.append(ControlArea(key=key, status="unavailable", metrics=[]))

    def sales():
        specs = [
            ("open_shifts", Shift, Shift.status == "open"),
            (
                "shift_differences",
                Shift,
                and_(
                    Shift.status == "closed",
                    Shift.closed_at >= start,
                    Shift.closed_at <= end,
                    Shift.variance_amount != 0,
                ),
            ),
        ]
        if flags[CUSTOMER_ORDERS]:
            specs += [
                ("orders_" + status, CustomerOrder, CustomerOrder.status == status)
                for status in ACTIVE_ORDERS
            ] + [
                (
                    "orders_overdue",
                    CustomerOrder,
                    and_(
                        CustomerOrder.status.in_(ACTIVE_ORDERS),
                        CustomerOrder.promised_at < now,
                    ),
                ),
                (
                    "orders_unpaid",
                    CustomerOrder,
                    and_(
                        CustomerOrder.status.in_(ACTIVE_ORDERS),
                        CustomerOrder.sale_order_id.is_(None),
                    ),
                ),
            ]
        values.update(_counts(db, tenant, branches, specs))
        signal("shift_differences", "Cortes con diferencias", "shifts", basis="period")
        rows = [
            metric("open_shifts", "Turnos abiertos", total("open_shifts"), "shifts"),
            metric(
                "expected_cash",
                "Efectivo esperado en cajas abiertas",
                _cash(db, tenant, branches),
                "shifts",
                fmt="money",
            ),
            metric(
                "shift_differences",
                "Cortes con diferencias",
                total("shift_differences"),
                "shifts",
                basis="period",
            ),
        ]
        if flags[CUSTOMER_ORDERS]:
            for key, label in [
                ("new", "Por confirmar"),
                ("confirmed", "Confirmados"),
                ("in_progress", "En preparación"),
                ("ready", "Listos para entregar"),
                ("overdue", "Pedidos con entrega vencida"),
                ("unpaid", "Pedidos sin cobrar"),
            ]:
                rows.append(
                    metric("orders_" + key, label, total("orders_" + key), "customer_orders")
                )
            signal("orders_overdue", "Pedidos con entrega vencida", "customer_orders", "now")
        return rows

    def products():
        values.update(_inventory(db, tenant, branches, today))
        values.update(
            _counts(
                db,
                tenant,
                branches,
                [
                    ("purchases_pending", PurchaseOrder, PurchaseOrder.status == "pending"),
                    ("purchases_partial", PurchaseOrder, PurchaseOrder.status == "partial"),
                ],
            )
        )
        signal("out_of_stock", "Productos sin existencias disponibles", "inventory", "now")
        signal("low_stock", "Productos con stock bajo", "replenishment")
        signal("expiring_lots", "Lotes vencidos o por vencer en 7 días", "inventory")
        rows = [
            metric(
                "catalog_active",
                "Productos activos del negocio",
                catalog_count,
                "inventory",
                basis="business",
            )
        ] + [
            metric(key, label, total(key), route)
            for key, label, route in [
                ("out_of_stock", "Sin existencias disponibles", "inventory"),
                ("low_stock", "Stock bajo", "replenishment"),
                ("reserved_units", "Unidades reservadas", "inventory"),
                ("expiring_lots", "Lotes vencidos o por vencer en 7 días", "inventory"),
                ("purchases_pending", "Compras pendientes de recibir", "purchasing"),
                ("purchases_partial", "Compras con recepción parcial", "purchasing"),
            ]
        ]
        if flags[CUSTOMER_ORDERS]:
            signal(
                "stock_conflicts", "Pedidos con conflicto de inventario", "customer_orders", "now"
            )
            rows.append(
                metric(
                    "stock_conflicts",
                    "Pedidos con conflicto de stock",
                    total("stock_conflicts"),
                    "customer_orders",
                )
            )
        return rows

    def customers():
        active_opportunity = Opportunity.stage.in_(("new", "contacted", "proposal"))
        next_action = and_(
            Opportunity.next_action.is_not(None),
            func.btrim(Opportunity.next_action, " \t\r\n") != "",
        )
        values.update(
            _counts(
                db,
                tenant,
                branches,
                [
                    ("opportunities", Opportunity, active_opportunity),
                    (
                        "opportunities_overdue",
                        Opportunity,
                        and_(active_opportunity, next_action, Opportunity.due_at < now),
                    ),
                    ("catalog_requests", CatalogRequest, CatalogRequest.status == "new"),
                    ("followups", FollowupTask, FollowupTask.status == "pending"),
                    (
                        "followups_overdue",
                        FollowupTask,
                        and_(FollowupTask.status == "pending", FollowupTask.due_at < now),
                    ),
                    (
                        "quotes",
                        CustomerQuote,
                        and_(
                            CustomerQuote.status.in_(("draft", "sent")),
                            CustomerQuote.expires_at >= now,
                        ),
                    ),
                ],
            )
        )
        signal("opportunities_overdue", "Próximas acciones comerciales vencidas", "crm")
        signal("followups_overdue", "Seguimientos de postventa vencidos", "followups")
        signal(
            "catalog_requests",
            "Solicitudes del catálogo por atender",
            "commercial_requests",
            "followup",
        )
        count = (
            db.query(func.count(Customer.id))
            .filter(Customer.tenant_id == tenant, Customer.is_active.is_(True))
            .scalar()
        )
        rows = [
            metric(
                "customers", "Clientes activos del negocio", count, "customers", basis="business"
            )
        ]
        rows += [
            metric(key, label, total(key), route)
            for key, label, route in [
                ("opportunities", "Oportunidades abiertas", "crm"),
                ("opportunities_overdue", "Acciones comerciales vencidas", "crm"),
                ("catalog_requests", "Solicitudes por atender", "commercial_requests"),
                ("followups", "Seguimientos pendientes", "followups"),
                ("quotes", "Cotizaciones vigentes por continuar", "quotes"),
            ]
        ]
        if role == "owner":
            latest = (
                select(
                    LoyaltyPolicyRevision.branch_id,
                    func.max(LoyaltyPolicyRevision.version).label("version"),
                )
                .where(
                    LoyaltyPolicyRevision.tenant_id == tenant,
                    LoyaltyPolicyRevision.branch_id.in_(branches),
                )
                .group_by(LoyaltyPolicyRevision.branch_id)
                .subquery()
            )
            enabled = (
                db.query(func.count(LoyaltyPolicyRevision.id))
                .join(
                    latest,
                    and_(
                        latest.c.branch_id == LoyaltyPolicyRevision.branch_id,
                        latest.c.version == LoyaltyPolicyRevision.version,
                    ),
                )
                .filter(
                    LoyaltyPolicyRevision.tenant_id == tenant,
                    LoyaltyPolicyRevision.enabled.is_(True),
                )
                .scalar()
            )
            rows.append(metric("loyalty", "Sucursales con lealtad habilitada", enabled, "loyalty"))
        return rows

    def attention():
        values.update(
            _counts(
                db,
                tenant,
                branches,
                [
                    ("cases_open", ServiceCase, ServiceCase.status.in_(ACTIVE_CASES)),
                    (
                        "cases_overdue",
                        ServiceCase,
                        and_(ServiceCase.status.in_(ACTIVE_CASES), ServiceCase.due_at < now),
                    ),
                    (
                        "appointments_today",
                        Appointment,
                        and_(
                            Appointment.status == "scheduled",
                            Appointment.starts_at >= today_start,
                            Appointment.starts_at <= today_end,
                        ),
                    ),
                    (
                        "appointments_past",
                        Appointment,
                        and_(Appointment.status == "scheduled", Appointment.ends_at < now),
                    ),
                    ("conversations", Conversation, Conversation.status == "open"),
                    ("drafts", Message, Message.state == "draft"),
                ],
            )
        )
        # Reminders must still refer to the current scheduled appointment version.
        reminder_counts = dict(
            db.execute(
                select(AppointmentReminder.branch_id, func.count())
                .join(
                    Appointment,
                    and_(
                        Appointment.id == AppointmentReminder.appointment_id,
                        Appointment.tenant_id == AppointmentReminder.tenant_id,
                        Appointment.branch_id == AppointmentReminder.branch_id,
                    ),
                )
                .where(
                    AppointmentReminder.tenant_id == tenant,
                    AppointmentReminder.branch_id.in_(branches),
                    Appointment.tenant_id == tenant,
                    Appointment.status == "scheduled",
                    AppointmentReminder.status == "pending",
                    Appointment.version == AppointmentReminder.appointment_version,
                    AppointmentReminder.due_at <= now,
                )
                .group_by(AppointmentReminder.branch_id)
            ).all()
        )
        values["reminders"] = reminder_counts
        signal("cases_overdue", "Casos de atención con plazo vencido", "service_cases", "now")
        signal("appointments_past", "Citas que requieren actualizar su estado", "appointments")
        signal("reminders", "Recordatorios de agenda pendientes", "appointments")
        return [
            metric(key, label, total(key), route, basis=basis)
            for key, label, route, basis in [
                ("cases_open", "Casos abiertos", "service_cases", "current"),
                ("cases_overdue", "Casos con plazo vencido", "service_cases", "current"),
                ("appointments_today", "Citas programadas para hoy", "appointments", "today"),
                ("reminders", "Recordatorios pendientes de revisar", "appointments", "current"),
                ("conversations", "Conversaciones abiertas", "inbox", "current"),
                ("drafts", "Borradores de respuesta", "inbox", "current"),
            ]
        ]

    def money():
        pending, amount = _unmatched(db, tenant, branches)
        values["unmatched"] = pending
        signal("unmatched", "Liquidaciones pendientes de conciliar", "reconciliation", "followup")
        rows = [
            metric(
                "unmatched",
                "Liquidaciones pendientes de conciliar",
                total("unmatched"),
                "reconciliation",
            ),
            metric(
                "unmatched_amount",
                "Importe pendiente de conciliar",
                amount,
                "reconciliation",
                fmt="money",
            ),
            metric(
                "refunds", "Devoluciones", story.summary.refund_count, "reports", basis="period"
            ),
        ]
        if flags[MARGIN_REPORTS] and has_permission(role, Permission.EXPENSES_MANAGE):
            rows += [
                metric(
                    "expenses",
                    "Gastos registrados",
                    story.operating_expenses.total,
                    "expenses",
                    fmt="money",
                    basis="period",
                ),
                metric(
                    "gross_profit",
                    "Utilidad bruta",
                    story.margin.summary.gross_profit,
                    "reports",
                    fmt="money",
                    basis="period",
                    detail="Sin costos suficientes"
                    if not story.margin.summary.complete
                    else "Con costos registrados de las ventas",
                ),
                metric(
                    "missing_costs",
                    "Productos vendidos sin costo registrado",
                    story.margin.summary.sold_products_without_cost,
                    "reports",
                    basis="period",
                ),
            ]
        return rows

    def business():
        values.update(
            _counts(
                db,
                tenant,
                branches,
                [
                    ("automation_pending", AutomationRun, AutomationRun.status == "pending"),
                    ("automation_rules", AutomationRule, AutomationRule.enabled.is_(True)),
                    ("catalog_published", PublicCatalog, PublicCatalog.enabled.is_(True)),
                ],
            )
        )
        signal(
            "automation_pending", "Tareas de automatización por revisar", "automations", "followup"
        )
        rows = [
            metric(
                "automation_pending",
                "Tareas internas pendientes",
                total("automation_pending"),
                "automations",
            ),
            metric(
                "automation_rules",
                "Reglas internas habilitadas",
                total("automation_rules"),
                "automations",
            ),
            metric(
                "catalog_published",
                "Catálogos públicos habilitados",
                total("catalog_published"),
                "public_catalog",
            ),
            metric(
                "whatsapp",
                "WhatsApp externo",
                "Sin conexión" if readiness().status == "not_connected" else "Consultar",
                "channels",
                fmt="text",
                basis="business",
            ),
        ]
        if has_permission(role, Permission.USERS_MANAGE):
            rows.append(
                metric(
                    "employees",
                    "Personas activas en el equipo",
                    employee_count,
                    "settings",
                    basis="business",
                )
            )
        if has_permission(role, Permission.BILLING_VIEW):
            subscription = billing.subscription.status if billing and billing.subscription else None
            reason = billing.access.reason if billing and billing.access else None
            label = {
                "active": "Activa",
                "trialing": "En prueba",
                "past_due": "Pago pendiente",
                "canceled": "Cancelada",
                "unpaid": "Sin pago",
            }.get(subscription)
            if label is None and reason == "signup_trial":
                label = "En prueba de registro"
            rows.append(
                metric(
                    "subscription",
                    "Suscripción de Kova",
                    label,
                    "billing",
                    fmt="text",
                    basis="business",
                )
            )
        if has_permission(role, Permission.FISCAL_MANAGE):
            values.update(
                _counts(
                    db,
                    tenant,
                    branches,
                    [
                        (
                            "cfdi_pending",
                            CfdiDocument,
                            and_(
                                CfdiDocument.environment == "live",
                                CfdiDocument.state.in_(
                                    (
                                        "prepared",
                                        "submitting",
                                        "pending",
                                        "unknown",
                                        "integrity_error",
                                        "cancel_pending",
                                    )
                                ),
                            ),
                        ),
                    ],
                )
            )
            signal("cfdi_pending", "Documentos CFDI de producción por revisar", "integrations")
            live = (
                db.query(CfdiConnection.production_ready)
                .filter(CfdiConnection.tenant_id == tenant, CfdiConnection.environment == "live")
                .scalar()
            )
            rows += [
                metric(
                    "cfdi_live",
                    "Preparación fiscal de producción",
                    "Preparación registrada" if live else "Por configurar o validar",
                    "integrations",
                    fmt="text",
                    basis="business",
                    detail=(
                        "Consulta certificados y aceptación en Facturación; "
                        "no verifica al proveedor."
                    ),
                ),
                metric(
                    "cfdi_pending",
                    "CFDI de producción por revisar",
                    total("cfdi_pending"),
                    "integrations",
                ),
            ]
        return rows

    for key, loader in [
        ("sales", sales),
        ("products", products),
        ("customers", customers),
        ("attention", attention),
        ("money", money),
        ("business", business),
    ]:
        area(key, loader)
    priority = {"now": 0, "today": 1, "followup": 2}
    alerts.sort(
        key=lambda alert: (priority[alert.priority], -alert.count, alert.branch_name, alert.key)
    )
    sales_rows = _branch_sales(db, tenant, branches, start, end)
    sales_total = sum((row.net_sales for row in sales_rows), Decimal("0.00"))
    ready = {area.key for area in areas if area.status == "ready"}
    sales_by_branch = {row.branch: row for row in sales_rows}

    def branch_summary(branch):
        row = sales_by_branch.get(branch)
        orders = row.orders if row else 0
        net = round_money(row.net_sales) if row else Decimal("0.00")
        return ControlBranchSales(
            branch_id=branch,
            branch_name=names[branch],
            completed_orders=orders,
            net_sales=str(net),
            average_ticket=str(round_money(net / orders) if orders else Decimal("0.00")),
            share_pct=str(
                (net / sales_total * 100).quantize(Decimal("0.01"))
                if sales_total > 0
                else Decimal("0.00")
            ),
            low_stock_count=values["low_stock"].get(branch, 0) if "products" in ready else None,
            open_shift_count=values["open_shifts"].get(branch, 0) if "sales" in ready else None,
            attention_signals=sum(alert.branch_id == branch for alert in alerts),
        )

    return DashboardControl(
        generated_at=now,
        scope=scope,
        branches=[ControlBranch(id=branch.id, name=branch.name) for branch in options],
        branch_sales=[branch_summary(branch) for branch in branches],
        areas=areas,
        alerts=alerts[:ALERT_LIMIT],
        alert_groups_total=len(alerts),
        priority_counts={
            key: sum(alert.priority == key for alert in alerts)
            for key in ("now", "today", "followup")
        },
        alerts_has_more=len(alerts) > ALERT_LIMIT,
    )


def _branch_sales(db, tenant, branches, start, end):
    # Same sale-cohort/refund basis as reports.branches; no duplicate order rows.
    from app.orders.models import Refund

    refunds = (
        select(Refund.order_id, func.sum(Refund.refunded_amount).label("amount"))
        .where(
            Refund.tenant_id == tenant,
            Refund.branch_id.in_(branches),
        )
        .group_by(Refund.order_id)
        .subquery()
    )
    return db.execute(
        select(
            Order.branch_id.label("branch"),
            func.count(Order.id).label("orders"),
            func.sum(Order.total_amount - func.coalesce(refunds.c.amount, 0)).label("net_sales"),
        )
        .outerjoin(refunds, refunds.c.order_id == Order.id)
        .where(
            Order.tenant_id == tenant,
            Order.branch_id.in_(branches),
            Order.status == "completed",
            func.coalesce(Order.occurred_at, Order.created_at) >= start,
            func.coalesce(Order.occurred_at, Order.created_at) <= end,
        )
        .group_by(Order.branch_id)
    ).all()
