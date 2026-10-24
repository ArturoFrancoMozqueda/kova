from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.auth.models import Membership
from app.branches.scope import bind_branch, tenant_wide_branches
from app.crm.models import Opportunity
from app.customers.models import Customer
from app.db import set_tenant_context
from app.reports import control
from app.service_cases.models import ServiceCase
from app.tenants.models import Tenant
from app.tests.test_catalog import _signup_verify_login
from app.tests.test_orders import _create_cash_order, _create_product, _open_shift

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/reports/dashboard"


def owner(client):
    signup = _signup_verify_login(client, f"control-{uuid4().hex}@example.com", "Control real")
    return UUID(signup["tenant_id"]), UUID(signup["user_id"])


def branch(client, name="Norte"):
    response = client.post(
        "/api/v1/branches", json={"name": name}, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["id"])


def read(client, scope="all", **kwargs):
    response = client.get(BASE, params={"period": "day", "branch_id": str(scope)}, **kwargs)
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["Cache-Control"]
    data = response.json()
    assert all(area["status"] == "ready" for area in data["control_center"]["areas"]), data[
        "control_center"
    ]["areas"]
    return data


def metrics(data):
    return {
        metric["key"]: metric
        for area in data["control_center"]["areas"]
        for metric in area["metrics"]
    }


def seed_case(db, tenant, actor, selected, *, amount=1):
    bind_branch(db, tenant_id=tenant, branch_id=selected)
    customer = Customer(tenant_id=tenant, name="Cliente de control")
    db.add(customer)
    db.flush()
    for _ in range(amount):
        db.add(
            ServiceCase(
                tenant_id=tenant,
                branch_id=selected,
                customer_id=customer.id,
                title="Revisión vencida",
                status="open",
                created_by_user_id=actor,
                due_at=datetime.now(UTC) - timedelta(days=1),
            )
        )
    db.commit()
    return customer.id


def test_all_branches_reuses_sale_definitions_and_does_not_change_operating_branch(client, db):
    tenant, _ = owner(client)
    north = branch(client)
    _open_shift(client)
    product = _create_product(client)
    sale = _create_cash_order(client, product["id"])
    assert sale.status_code == 201, sale.text
    local_total = Decimal(sale.json()["total_amount"])
    # A second branch sale is recorded under an explicit operating header.
    bind_branch(db, tenant_id=tenant, branch_id=north)
    from app.orders.models import Order

    db.add(
        Order(
            tenant_id=tenant,
            branch_id=north,
            subtotal_amount=Decimal("50.00"),
            total_amount=Decimal("50.00"),
            status="completed",
        )
    )
    db.commit()
    global_data = read(client)
    assert Decimal(global_data["story"]["summary"]["net_sales"]) == local_total + Decimal("50.00")
    center = global_data["control_center"]
    assert center["scope"] == {
        "kind": "all",
        "branch_id": None,
        "label": "Todas las sucursales",
        "can_view_all": True,
    }
    assert {row["branch_id"] for row in center["branch_sales"]} == {str(tenant), str(north)}
    assert sum(
        Decimal(row["net_sales"]) for row in center["branch_sales"]
    ) == local_total + Decimal("50.00")
    selected = read(client, north)
    assert Decimal(selected["story"]["summary"]["net_sales"]) == Decimal("50.00")
    assert [row["branch_id"] for row in selected["control_center"]["branch_sales"]] == [str(north)]
    # The older endpoint and current drawer still use the original operating branch.
    assert Decimal(client.get(BASE).json()["story"]["summary"]["net_sales"]) == local_total
    assert client.get("/api/v1/shifts/current").json()["id"] is not None


def test_inventory_does_not_pool_stock_across_branches_or_omit_zero_ledger_positions(client, db):
    tenant, _ = owner(client)
    north = branch(client)
    product = _create_product(client, track_inventory=True)
    from app.orders.models import InventoryMovement

    db.add(
        InventoryMovement(
            tenant_id=tenant,
            branch_id=tenant,
            product_id=UUID(product["id"]),
            movement_type="adjustment",
            quantity_delta=100,
            reason="Prueba",
        )
    )
    db.commit()
    data = read(client)
    assert metrics(data)["out_of_stock"]["value"] == "1"
    assert metrics(read(client, tenant))["out_of_stock"]["value"] == "0"
    assert metrics(read(client, north))["out_of_stock"]["value"] == "1"
    signal = next(
        alert for alert in data["control_center"]["alerts"] if alert["key"] == "out_of_stock"
    )
    assert signal["branch_id"] == str(north)
    assert signal["priority"] == "now"


def test_pending_counts_are_exact_beyond_queue_page_limits_and_keep_branch_origin(client, db):
    tenant, actor = owner(client)
    north = branch(client)
    seed_case(db, tenant, actor, tenant, amount=31)
    seed_case(db, tenant, actor, north, amount=2)
    data = read(client)
    assert metrics(data)["cases_open"]["value"] == "33"
    assert metrics(data)["cases_overdue"]["value"] == "33"
    assert metrics(read(client, north))["cases_overdue"]["value"] == "2"
    alerts = [row for row in data["control_center"]["alerts"] if row["key"] == "cases_overdue"]
    assert {row["branch_name"]: row["count"] for row in alerts} == {
        "Sucursal principal": 31,
        "Norte": 2,
    }


def test_foreign_branch_and_membership_restrictions_never_expand_scope(client, db):
    foreign, _ = owner(client)
    client.cookies.clear()
    tenant, actor = owner(client)
    north = branch(client)
    seed_case(db, tenant, actor, tenant, amount=4)
    seed_case(db, tenant, actor, north, amount=1)
    assert client.get(BASE, params={"branch_id": str(foreign)}).status_code == 404
    member = db.query(Membership).filter_by(tenant_id=tenant, user_id=actor).one()
    member.role = "manager"
    member.allowed_branch_id = north
    db.commit()
    data = read(client, headers={"X-Kova-Branch": str(north)})
    assert data["control_center"]["scope"]["can_view_all"] is False
    assert data["control_center"]["scope"]["branch_id"] == str(north)
    assert [row["id"] for row in data["control_center"]["branches"]] == [str(north)]
    assert metrics(data)["cases_open"]["value"] == "1"
    response = client.get(
        BASE, params={"branch_id": str(tenant)}, headers={"X-Kova-Branch": str(north)}
    )
    assert response.status_code == 403


def test_features_and_owner_only_financial_fields_are_preserved(client, db):
    tenant, actor = owner(client)
    account = db.get(Tenant, tenant)
    account.feature_overrides = {"customer_orders": False, "margin_reports": False}
    db.commit()
    data = read(client)
    assert not any(key.startswith("orders_") for key in metrics(data))
    assert "gross_profit" not in metrics(data)
    member = db.query(Membership).filter_by(tenant_id=tenant, user_id=actor).one()
    member.role = "manager"
    db.commit()
    data = read(client)
    for key in ("loyalty", "cfdi_live", "cfdi_pending", "subscription", "employees"):
        assert key not in metrics(data)
    assert data["billing"] is None
    member.role = "cashier"
    db.commit()
    assert client.get(BASE, params={"branch_id": "all"}).status_code == 403


def test_optional_source_failure_is_unavailable_without_zero_or_clear_claim(
    client, db, monkeypatch
):
    owner(client)

    def unavailable(*_args, **_kwargs):
        _args[0].execute(text("SELECT dashboard_missing_source_column"))

    monkeypatch.setattr(control, "_inventory", unavailable)
    response = client.get(BASE, params={"branch_id": "all"})
    assert response.status_code == 200, response.text
    data = response.json()["control_center"]
    area = next(area for area in data["areas"] if area["key"] == "products")
    assert area == {"key": "products", "status": "unavailable", "metrics": []}
    assert all(row["low_stock_count"] is None for row in data["branch_sales"])
    assert all(alert["key"] not in {"out_of_stock", "low_stock"} for alert in data["alerts"])


def test_opportunity_deadlines_only_apply_to_real_next_actions(client, db):
    tenant, actor = owner(client)
    customer = seed_case(db, tenant, actor, tenant)
    bind_branch(db, tenant_id=tenant)
    for action in (None, "   ", "Llamar al cliente"):
        db.add(
            Opportunity(
                tenant_id=tenant,
                branch_id=tenant,
                customer_id=customer,
                title="Oportunidad",
                stage="new",
                estimated_amount=Decimal("100"),
                next_action=action,
                due_at=datetime.now(UTC) - timedelta(days=1),
                created_by_user_id=actor,
                updated_by_user_id=actor,
            )
        )
    db.commit()
    data = read(client)
    assert metrics(data)["opportunities"]["value"] == "3"
    assert metrics(data)["opportunities_overdue"]["value"] == "1"


def test_control_count_queries_keep_database_rls(client, db, kova_app_engine):
    first, actor = owner(client)
    seed_case(db, first, actor, first, amount=2)
    second, actor2 = owner(client)
    seed_case(db, second, actor2, second, amount=3)
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, first)
    specs = [("cases", ServiceCase, ServiceCase.status == "open")]
    with tenant_wide_branches(db):
        assert sum(control._counts(db, first, [first], specs)["cases"].values()) == 2
        assert sum(control._counts(db, second, [second], specs)["cases"].values()) == 0
    db.execute(text("RESET ROLE"))


def test_operational_metrics_cover_orders_agenda_purchases_money_and_automation(client, db):
    from zoneinfo import ZoneInfo

    from app.appointments.models import Appointment, AppointmentReminder, AppointmentResource
    from app.automations.models import AutomationRule, AutomationRun, BusinessEvent
    from app.cfdi.models import CfdiConnection
    from app.customer_orders.models import CustomerOrder
    from app.expenses.models import Expense
    from app.messaging.models import Conversation, Message
    from app.orders.models import Payment
    from app.purchasing.models import PurchaseOrder, Supplier
    from app.reconciliation.models import ImportBatch, ReconciliationMatch, SettlementEntry
    from app.storefront.models import PublicCatalog

    tenant, actor = owner(client)
    _open_shift(client)
    product = _create_product(client)
    sale = _create_cash_order(client, product["id"]).json()
    customer = seed_case(db, tenant, actor, tenant)
    bind_branch(db, tenant_id=tenant)
    now = datetime.now(UTC)
    today = now.astimezone(ZoneInfo("America/Mexico_City")).date()
    db.get(Tenant, tenant).feature_overrides = {"margin_reports": True}
    pending = CustomerOrder(
        tenant_id=tenant,
        branch_id=tenant,
        folio="CTRL000001",
        status="ready",
        total_amount=Decimal("100"),
        subtotal_amount=Decimal("100"),
        promised_at=now - timedelta(hours=1),
    )
    resource = AppointmentResource(
        tenant_id=tenant, branch_id=tenant, name="Atención", timezone="America/Mexico_City"
    )
    supplier = Supplier(tenant_id=tenant, name="Proveedor local")
    batch = ImportBatch(
        tenant_id=tenant,
        branch_id=tenant,
        content_sha256="a" * 64,
        row_count=1,
        created_by_user_id=actor,
    )
    rule = AutomationRule(
        tenant_id=tenant,
        branch_id=tenant,
        template_key="order_ready",
        enabled=True,
        authorized_by_user_id=actor,
    )
    conversation = Conversation(
        tenant_id=tenant,
        branch_id=tenant,
        customer_id=customer,
        subject="Consulta real",
        origin="manual",
        status="open",
    )
    db.add_all([pending, resource, supplier, batch, rule, conversation])
    db.flush()
    appointment = Appointment(
        tenant_id=tenant,
        branch_id=tenant,
        resource_id=resource.id,
        customer_id=customer,
        title="Cita del día",
        starts_at=datetime.combine(today, datetime.min.time(), ZoneInfo("America/Mexico_City"))
        + timedelta(hours=12),
        ends_at=datetime.combine(today, datetime.min.time(), ZoneInfo("America/Mexico_City"))
        + timedelta(hours=13),
        status="scheduled",
        created_by_user_id=actor,
    )
    event = BusinessEvent(
        tenant_id=tenant,
        branch_id=tenant,
        event_type="customer_order.ready",
        entity_id=pending.id,
        entity_version=1,
    )
    entry = SettlementEntry(
        tenant_id=tenant,
        branch_id=tenant,
        batch_id=batch.id,
        settled_at=now,
        gross_amount=Decimal("100"),
        fee_amount=Decimal("10"),
        net_amount=Decimal("90"),
        currency="MXN",
        payment_method="manual_card",
        external_reference_masked="***",
        row_fingerprint="b" * 64,
    )
    db.add_all([appointment, event, entry])
    db.flush()
    payment = db.query(Payment).filter(Payment.order_id == UUID(sale["id"])).one()
    db.add_all(
        [
            AppointmentReminder(
                tenant_id=tenant,
                branch_id=tenant,
                appointment_id=appointment.id,
                appointment_version=1,
                status="pending",
                due_at=now - timedelta(minutes=5),
            ),
            AppointmentReminder(
                tenant_id=tenant,
                branch_id=tenant,
                appointment_id=appointment.id,
                appointment_version=2,
                status="pending",
                due_at=now - timedelta(minutes=5),
            ),
            PurchaseOrder(
                tenant_id=tenant,
                branch_id=tenant,
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                status="partial",
                created_by_user_id=actor,
            ),
            Expense(
                tenant_id=tenant,
                branch_id=tenant,
                category="servicios",
                amount=Decimal("20"),
                expense_date=today,
            ),
            ReconciliationMatch(
                tenant_id=tenant,
                branch_id=tenant,
                settlement_entry_id=entry.id,
                payment_id=payment.id,
                order_id=payment.order_id,
                matched_amount=Decimal("20"),
                status="confirmed",
                reasons=[],
                confirmed_by_user_id=actor,
            ),
            AutomationRun(
                tenant_id=tenant,
                branch_id=tenant,
                event_id=event.id,
                rule_id=rule.id,
                rule_version=1,
                template_key="order_ready",
                title="Revisar entrega",
                entity_id=pending.id,
                entity_type="customer_order",
                entity_version=1,
                status="pending",
            ),
            Message(
                tenant_id=tenant,
                branch_id=tenant,
                conversation_id=conversation.id,
                direction="outbound",
                body="Borrador local",
                state="draft",
            ),
            PublicCatalog(tenant_id=tenant, branch_id=tenant, title="Catálogo", enabled=True),
            # A configured test connection must never look like live preparation.
            CfdiConnection(
                tenant_id=tenant,
                environment="test",
                organization_id="test-only",
                encrypted_api_key="unused-test-placeholder",
                production_ready=True,
            ),
        ]
    )
    db.commit()
    data = read(client)
    actual = metrics(data)
    for key in (
        "orders_ready",
        "orders_overdue",
        "orders_unpaid",
        "appointments_today",
        "reminders",
        "purchases_partial",
        "unmatched",
        "automation_pending",
        "automation_rules",
        "conversations",
        "drafts",
        "catalog_published",
    ):
        assert actual[key]["value"] == "1", (key, actual[key])
    assert Decimal(actual["unmatched_amount"]["value"]) == Decimal("70")
    assert Decimal(actual["expenses"]["value"]) == Decimal("20")
    assert actual["gross_profit"]["value"] is None
    assert actual["missing_costs"]["value"] == "1"
    assert actual["cfdi_live"]["value"] == "Por configurar o validar"
    assert actual["whatsapp"]["value"] == "Sin conexión"
    assert actual["customers"]["scope"] == "business"
    assert actual["expenses"]["scope"] == "period"
    assert actual["appointments_today"]["scope"] == "today"


def test_open_cash_uses_real_sales_movements_and_refund_payouts(client, db):
    from app.shifts.models import CashMovement

    tenant, actor = owner(client)
    shift = _open_shift(client)
    product = _create_product(client)
    sale = _create_cash_order(client, product["id"]).json()
    result = client.post(
        f"/api/v1/orders/{sale['id']}/refunds",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "reason": "customer_return",
            "refund_payment_method": "cash",
            "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
        },
    )
    assert result.status_code == 201, result.text
    bind_branch(db, tenant_id=tenant)
    for kind, amount in [("cash_in", "5.00"), ("cash_out", "10.00")]:
        db.add(
            CashMovement(
                tenant_id=tenant,
                branch_id=tenant,
                shift_id=UUID(shift["id"]),
                type=kind,
                amount=Decimal(amount),
                reason="Movimiento de prueba",
                created_by_user_id=actor,
            )
        )
    db.commit()
    assert Decimal(metrics(read(client))["expected_cash"]["value"]) == Decimal("113.50")
    assert Decimal(client.get("/api/v1/shifts/current").json()["expected_cash_amount"]) == Decimal(
        "113.50"
    )


def test_full_dashboard_projection_runs_under_runtime_rls(client, db, kova_app_engine):
    tenant, actor = owner(client)
    north = branch(client)
    seed_case(db, tenant, actor, north, amount=2)
    db.info.pop("kova_branch_id", None)
    db.execute(text("SET LOCAL ROLE kova_app"))
    data = read(client)
    assert metrics(data)["cases_open"]["value"] == "2"
    assert len(data["control_center"]["branches"]) == 2
    db.execute(text("RESET ROLE"))


def test_reserved_lot_deficit_and_expiry_keep_branch_and_order_counts(client, db):
    from app.catalog.models import Product
    from app.customer_orders.models import CustomerOrder, InventoryReservation
    from app.inventory.models import InventoryLot, InventoryLotAllocation, InventoryLotReservation
    from app.orders.models import InventoryMovement

    tenant, _ = owner(client)
    north = branch(client)
    product = _create_product(client, track_inventory=True)
    bind_branch(db, tenant_id=tenant)
    db.get(Product, UUID(product["id"])).track_lots = True
    now = datetime.now(UTC)
    pending = CustomerOrder(
        tenant_id=tenant,
        branch_id=tenant,
        folio="CTRLLOT001",
        status="confirmed",
        total_amount=Decimal("100"),
        subtotal_amount=Decimal("100"),
    )
    movement = InventoryMovement(
        tenant_id=tenant,
        branch_id=tenant,
        product_id=UUID(product["id"]),
        movement_type="adjustment",
        quantity_delta=20,
    )
    expired = InventoryLot(
        tenant_id=tenant,
        product_id=UUID(product["id"]),
        code="EXPIRED",
        expires_on=(now - timedelta(days=1)).date(),
    )
    soon = InventoryLot(
        tenant_id=tenant,
        product_id=UUID(product["id"]),
        code="SOON",
        expires_on=(now + timedelta(days=2)).date(),
    )
    db.add_all([pending, movement, expired, soon])
    db.flush()
    reservation = InventoryReservation(
        tenant_id=tenant,
        branch_id=tenant,
        product_id=UUID(product["id"]),
        customer_order_id=pending.id,
        quantity=7,
        status="active",
        lot_tracked=True,
    )
    db.add(reservation)
    db.flush()
    db.add_all(
        [
            InventoryLotAllocation(
                tenant_id=tenant,
                branch_id=tenant,
                product_id=UUID(product["id"]),
                movement_id=movement.id,
                lot_id=expired.id,
                quantity_delta=5,
            ),
            InventoryLotAllocation(
                tenant_id=tenant,
                branch_id=tenant,
                product_id=UUID(product["id"]),
                movement_id=movement.id,
                lot_id=soon.id,
                quantity_delta=15,
            ),
            InventoryLotReservation(
                tenant_id=tenant,
                branch_id=tenant,
                product_id=UUID(product["id"]),
                reservation_id=reservation.id,
                lot_id=expired.id,
                quantity=7,
            ),
        ]
    )
    db.commit()
    data = read(client)
    assert metrics(data)["reserved_units"]["value"] == "7"
    assert metrics(data)["stock_conflicts"]["value"] == "1"
    assert metrics(data)["expiring_lots"]["value"] == "2"
    # Another branch has no lot movements or reservations for this product.
    assert metrics(read(client, north))["stock_conflicts"]["value"] == "0"
    assert metrics(read(client, north))["expiring_lots"]["value"] == "0"


def test_alert_cap_preserves_exact_counts_and_all_branch_attribution(client, db):
    from app.branches.models import Branch

    tenant, actor = owner(client)
    for index in range(13):
        row = Branch(tenant_id=tenant, name=f"Local {index:02}")
        db.add(row)
        db.flush()
        seed_case(db, tenant, actor, row.id)
    data = read(client)
    center = data["control_center"]
    assert metrics(data)["cases_open"]["value"] == "13"
    assert center["alert_groups_total"] == 13
    assert center["priority_counts"]["now"] == 13
    assert len(center["alerts"]) == 12
    assert center["alerts_has_more"] is True
    assert sum(branch["attention_signals"] for branch in center["branch_sales"]) == 13
