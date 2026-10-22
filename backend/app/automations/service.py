"""Transactional domain events and a small catalog of deterministic internal tasks.

No provider requests, LLM calls or financial effects are performed in this module.
All functions use the caller's transaction; HTTP/worker callers own commit/rollback.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, cast, exists, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.audit.service import log
from app.auth.models import Membership, User
from app.automations.models import AutomationRule, AutomationRun, BusinessEvent, now
from app.automations.schemas import AutomationOverview, RuleResponse, RunResponse
from app.billing.access import get_billing_access_status
from app.branches.scope import active_branch_id
from app.catalog.models import Product
from app.customer_orders.models import CustomerOrder, InventoryReservation
from app.inventory.repository import stock_on_hand
from app.inventory.service import list_low_stock
from app.orders.models import InventoryMovement
from app.rbac.permissions import Permission, has_permission
from app.service_cases.models import ServiceCase
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.feature_flags import CUSTOMER_ORDERS, resolve_feature_flags
from app.tenants.models import Tenant

TEMPLATES = {
    "service_case_overdue": {
        "title": "Revisión de atención vencida",
        "description": (
            "Crea una revisión interna para vencimientos posteriores a la activación. "
            "No envía avisos ni modifica el caso."
        ),
        "event_type": "service_case.review_due",
        "task": "Revisa el seguimiento de la atención vencida",
    },
    "order_ready": {
        "title": "Pedido listo para entregar",
        "description": "Crea una tarea interna para revisar la entrega de un pedido listo.",
        "event_type": "customer_order.ready",
        "task": "Revisa la entrega del pedido listo",
    },
    "order_fulfilled": {
        "title": "Seguimiento después de la entrega",
        "description": "Crea una tarea interna para revisar la postventa de un pedido entregado.",
        "event_type": "customer_order.fulfilled",
        "task": "Revisa el seguimiento del pedido entregado",
    },
    "restock_review": {
        "title": "Revisión de reposición",
        "description": "Crea una tarea interna si el inventario disponible requiere revisión.",
        "event_type": "inventory.restock_review",
        "task": "Revisa la reposición del producto",
    },
}
EVENT_TYPES = {item["event_type"] for item in TEMPLATES.values()} | {"customer_order.cancelled"}


def _lock(db: Session, tenant_id: UUID, branch_id: UUID) -> None:
    # All rule/run mutations share one bounded branch lock, including the worker.
    # This also serializes absent-rule creation without a failed outer transaction.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"automations:{tenant_id}:{branch_id}"},
    )


def record_event(
    db: Session,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    entity_id: UUID,
    entity_version: int,
    event_type: str,
) -> None:
    """Add an immutable, PII-free event in the domain mutation's transaction.

    Repeating the same entity version/type is harmless. Rollback also rolls back
    this insert; processing never trusts client-created event payloads.
    """
    if event_type not in EVENT_TYPES or entity_version < 1:
        raise ValueError("Unsupported automation event or entity version")
    db.execute(
        insert(BusinessEvent)
        .values(
            id=uuid4(),
            tenant_id=tenant_id,
            branch_id=branch_id,
            entity_id=entity_id,
            entity_version=entity_version,
            event_type=event_type,
            created_at=now(),
        )
        .on_conflict_do_nothing(constraint="uq_business_event_identity")
    )


def _rule_query(db: Session, tenant_id: UUID, branch_id: UUID):
    return db.query(AutomationRule).filter(
        AutomationRule.tenant_id == tenant_id, AutomationRule.branch_id == branch_id
    )


def _run_query(db: Session, tenant_id: UUID, branch_id: UUID):
    return db.query(AutomationRun).filter(
        AutomationRun.tenant_id == tenant_id, AutomationRun.branch_id == branch_id
    )


def _rule_response(key: str, row: AutomationRule | None) -> RuleResponse:
    template = TEMPLATES[key]
    return RuleResponse(
        template_key=key,
        title=template["title"],
        description=template["description"],
        enabled=bool(row and row.enabled),
        version=row.version if row else 0,
    )


def overview(db: Session, *, tenant_id: UUID, limit: int = 100) -> AutomationOverview:
    branch_id = active_branch_id(db, tenant_id)
    rows = {row.template_key: row for row in _rule_query(db, tenant_id, branch_id).all()}
    runs = (
        _run_query(db, tenant_id, branch_id)
        .order_by(AutomationRun.created_at.desc(), AutomationRun.id.desc())
        .limit(limit)
        .all()
    )
    return AutomationOverview(
        rules=[_rule_response(key, rows.get(key)) for key in TEMPLATES],
        runs=[RunResponse.model_validate(run) for run in runs],
    )


def configure(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    template_key: str,
    enabled: bool,
    expected_version: int,
) -> RuleResponse:
    if template_key not in TEMPLATES:
        raise not_found("Automatización no encontrada")
    branch_id = active_branch_id(db, tenant_id)
    _lock(db, tenant_id, branch_id)
    rule = _rule_query(db, tenant_id, branch_id).filter_by(template_key=template_key).first()
    if (rule.version if rule else 0) != expected_version:
        raise conflict("La automatización cambió; actualiza antes de continuar")
    stamp = now()
    if rule is None:
        rule = AutomationRule(
            tenant_id=tenant_id,
            branch_id=branch_id,
            template_key=template_key,
            enabled=enabled,
            version=1,
            authorized_by_user_id=user_id,
            enabled_since=stamp if enabled else None,
            updated_at=stamp,
        )
        db.add(rule)
    else:
        rule.enabled = enabled
        rule.version += 1
        rule.authorized_by_user_id = user_id
        rule.enabled_since = stamp if enabled else None
        rule.updated_at = stamp
    db.flush()
    # A changed authorization/version never keeps old pending work alive.
    for run in (
        _run_query(db, tenant_id, branch_id).filter_by(rule_id=rule.id, status="pending").all()
    ):
        _suppress(run, stamp)
    log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="automation.rule.updated",
        resource_type="automation_rule",
        resource_id=rule.id,
        changes={"template_key": template_key, "enabled": enabled, "version": rule.version},
    )
    return _rule_response(template_key, rule)


def _authorized(db: Session, rule: AutomationRule) -> bool:
    member = (
        db.query(Membership)
        .filter(
            Membership.tenant_id == rule.tenant_id,
            Membership.user_id == rule.authorized_by_user_id,
            Membership.is_active.is_(True),
        )
        .first()
    )
    user = (
        db.query(User)
        .filter(
            User.id == rule.authorized_by_user_id,
            User.is_active.is_(True),
            User.is_email_verified.is_(True),
        )
        .first()
    )
    domain_permission = (
        Permission.SETTINGS_MANAGE
        if rule.template_key == "service_case_overdue"
        else (
            Permission.INVENTORY_ADJUST
            if rule.template_key == "restock_review"
            else Permission.CUSTOMER_ORDERS_VIEW
        )
    )
    return bool(
        member
        and user
        and has_permission(member.role, Permission.SETTINGS_MANAGE)
        and has_permission(member.role, domain_permission)
        and (member.allowed_branch_id is None or member.allowed_branch_id == rule.branch_id)
    )


def _source_valid(
    db: Session,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    template_key: str,
    entity_id: UUID,
    entity_version: int,
) -> bool:
    if template_key == "service_case_overdue":
        return (
            db.query(ServiceCase.id)
            .filter(
                ServiceCase.tenant_id == tenant_id,
                ServiceCase.branch_id == branch_id,
                ServiceCase.id == entity_id,
                ServiceCase.status.in_(("open", "in_progress", "reopened")),
                ServiceCase.due_at < now(),
                _case_due_revision() == entity_version,
            )
            # Serialize only case reviews with closure/rescheduling until caller commits.
            .with_for_update(read=True)
            .first()
            is not None
        )
    if template_key == "restock_review":
        product = (
            db.query(Product)
            .filter(
                Product.tenant_id == tenant_id,
                Product.id == entity_id,
                Product.is_active.is_(True),
                Product.track_inventory.is_(True),
            )
            .first()
        )
        if product is None or product.low_stock_threshold is None:
            return False
        reserved = (
            db.query(func.coalesce(func.sum(InventoryReservation.quantity), 0))
            .filter(
                InventoryReservation.tenant_id == tenant_id,
                InventoryReservation.branch_id == branch_id,
                InventoryReservation.product_id == entity_id,
                InventoryReservation.status == "active",
            )
            .scalar()
        )
        available = stock_on_hand(db, tenant_id=tenant_id, product_id=entity_id) - int(
            reserved or 0
        )
        return available <= product.low_stock_threshold
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant is None or not resolve_feature_flags(tenant.feature_overrides)[CUSTOMER_ORDERS]:
        return False
    desired_status = "ready" if template_key == "order_ready" else "fulfilled"
    return (
        db.query(CustomerOrder.id)
        .filter(
            CustomerOrder.tenant_id == tenant_id,
            CustomerOrder.branch_id == branch_id,
            CustomerOrder.id == entity_id,
            CustomerOrder.version == entity_version,
            CustomerOrder.status == desired_status,
        )
        .first()
        is not None
    )


def _suppress(run: AutomationRun, stamp) -> None:
    run.status = "suppressed"
    run.version += 1
    run.resolved_at = stamp


def scan_stock(db: Session, *, tenant_id: UUID, branch_id: UUID, limit: int = 100) -> int:
    """Derive low-stock changes from authoritative movements and reservations.

    The latest source timestamp captures threshold edits and reservation updates
    as well as new movements. It is stored as integer UTC microseconds, avoiding
    float rounding and fitting safely within current JavaScript integer precision.
    Existing identities are skipped before the insert limit so unchanged low
    products cannot starve newly depleted products on later sweeps.
    """
    lows = list_low_stock(db, tenant_id=tenant_id)
    ids = [UUID(row["product_id"]) for row in lows]
    if not ids:
        return 0
    products = dict(
        db.query(Product.id, Product.updated_at)
        .filter(Product.tenant_id == tenant_id, Product.id.in_(ids))
        .all()
    )
    movement_dates = dict(
        db.query(InventoryMovement.product_id, func.max(InventoryMovement.created_at))
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.branch_id == branch_id,
            InventoryMovement.product_id.in_(ids),
        )
        .group_by(InventoryMovement.product_id)
        .all()
    )
    reservation_dates = dict(
        db.query(InventoryReservation.product_id, func.max(InventoryReservation.updated_at))
        .filter(
            InventoryReservation.tenant_id == tenant_id,
            InventoryReservation.branch_id == branch_id,
            InventoryReservation.product_id.in_(ids),
        )
        .group_by(InventoryReservation.product_id)
        .all()
    )
    existing = set(
        db.query(BusinessEvent.entity_id, BusinessEvent.entity_version)
        .filter(
            BusinessEvent.tenant_id == tenant_id,
            BusinessEvent.branch_id == branch_id,
            BusinessEvent.event_type == "inventory.restock_review",
            BusinessEvent.entity_id.in_(ids),
        )
        .all()
    )
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    inserted = 0
    for identifier in ids:
        dates = [
            stamp
            for stamp in (
                products[identifier],
                movement_dates.get(identifier),
                reservation_dates.get(identifier),
            )
            if stamp is not None
        ]
        stamp = max(value.replace(tzinfo=UTC) if value.tzinfo is None else value for value in dates)
        delta = stamp - epoch
        version = (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
        if (identifier, version) in existing:
            continue
        record_event(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
            entity_id=identifier,
            entity_version=version,
            event_type="inventory.restock_review",
        )
        inserted += 1
        if inserted >= limit:
            break
    return inserted


def _case_due_revision():
    # PostgreSQL numeric arithmetic preserves all stored microseconds without floats.
    return cast(func.extract("epoch", ServiceCase.due_at) * 1_000_000, BigInteger)


def scan_case_deadlines(db: Session, *, rule: AutomationRule, limit: int = 100) -> int:
    """Skip existing identities in SQL before LIMIT to avoid starving later cases."""
    revision = _case_due_revision()
    already_recorded = exists(
        select(BusinessEvent.id).where(
            BusinessEvent.tenant_id == rule.tenant_id,
            BusinessEvent.branch_id == rule.branch_id,
            BusinessEvent.event_type == "service_case.review_due",
            BusinessEvent.entity_id == ServiceCase.id,
            BusinessEvent.entity_version == revision,
        )
    )
    candidates = (
        db.query(ServiceCase.id, revision)
        .filter(
            ServiceCase.tenant_id == rule.tenant_id,
            ServiceCase.branch_id == rule.branch_id,
            ServiceCase.status.in_(("open", "in_progress", "reopened")),
            ServiceCase.due_at >= rule.enabled_since,
            ServiceCase.due_at < now(),
            ~already_recorded,
        )
        .order_by(ServiceCase.due_at, ServiceCase.id)
        .limit(limit)
        .all()
    )
    for identifier, due_revision in candidates:
        record_event(
            db,
            tenant_id=rule.tenant_id,
            branch_id=rule.branch_id,
            entity_id=identifier,
            entity_version=due_revision,
            event_type="service_case.review_due",
        )
    return len(candidates)


def process_pending(
    db: Session,
    *,
    tenant_id: UUID,
    branch_id: UUID | None = None,
    limit: int = 100,
) -> dict[str, int]:
    """Bounded deterministic work; safe for authenticated API and tenant worker.

    The worker must bind tenant context and branch scope before invoking this.
    It must commit this transaction before releasing its existing scheduling lease.
    """
    selected = active_branch_id(db, tenant_id)
    if branch_id is not None and branch_id != selected:
        raise ValueError("Automation worker branch scope must be bound before processing")
    branch_id = selected
    limit = min(max(limit, 1), 200)
    _lock(db, tenant_id, branch_id)
    result = {"processed": 0, "created": 0, "suppressed": 0}
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.is_active.is_(True)).first()
    if tenant is None or not get_billing_access_status(db, tenant_id=tenant_id).allowed:
        return result
    rules = {row.template_key: row for row in _rule_query(db, tenant_id, branch_id).all()}
    permitted = {key: rule.enabled and _authorized(db, rule) for key, rule in rules.items()}
    if permitted.get("restock_review"):
        scan_stock(db, tenant_id=tenant_id, branch_id=branch_id, limit=limit)
    if permitted.get("service_case_overdue") and rules["service_case_overdue"].enabled_since:
        scan_case_deadlines(db, rule=rules["service_case_overdue"], limit=limit)
    stamp = now()
    case_source_current = exists(
        select(ServiceCase.id).where(
            ServiceCase.tenant_id == tenant_id,
            ServiceCase.branch_id == branch_id,
            ServiceCase.id == AutomationRun.entity_id,
            ServiceCase.status.in_(("open", "in_progress", "reopened")),
            ServiceCase.due_at < stamp,
            _case_due_revision() == AutomationRun.entity_version,
        )
    )
    # A full batch of still-valid reviews must not starve obsolete case reviews.
    obsolete_case = (AutomationRun.template_key == "service_case_overdue") & ~case_source_current
    pending = (
        _run_query(db, tenant_id, branch_id)
        .filter_by(status="pending")
        .order_by(obsolete_case.desc(), AutomationRun.created_at, AutomationRun.id)
        .limit(limit)
        .all()
    )
    for run in pending:
        rule = rules.get(run.template_key)
        if not (
            rule
            and permitted.get(run.template_key)
            and run.rule_version == rule.version
            and _source_valid(
                db,
                tenant_id=tenant_id,
                branch_id=branch_id,
                template_key=run.template_key,
                entity_id=run.entity_id,
                entity_version=run.entity_version,
            )
        ):
            _suppress(run, stamp)
            result["suppressed"] += 1
    events = (
        db.query(BusinessEvent)
        .filter(
            BusinessEvent.tenant_id == tenant_id,
            BusinessEvent.branch_id == branch_id,
            BusinessEvent.processed_at.is_(None),
        )
        .order_by(BusinessEvent.created_at, BusinessEvent.id)
        .limit(limit)
        .all()
    )
    for event in events:
        for key, template in TEMPLATES.items():
            rule = rules.get(key)
            if (
                template["event_type"] != event.event_type
                or rule is None
                or not permitted.get(key)
                or rule.enabled_since is None
                or event.created_at < rule.enabled_since
            ):
                continue
            if not _source_valid(
                db,
                tenant_id=tenant_id,
                branch_id=branch_id,
                template_key=key,
                entity_id=event.entity_id,
                entity_version=event.entity_version,
            ):
                continue
            # One unresolved review per source and template; later events remain
            # auditable but cannot flood the owner's task list.
            existing = (
                _run_query(db, tenant_id, branch_id)
                .filter_by(template_key=key, entity_id=event.entity_id, status="pending")
                .first()
            )
            if existing is None:
                db.add(
                    AutomationRun(
                        tenant_id=tenant_id,
                        branch_id=branch_id,
                        event_id=event.id,
                        rule_id=rule.id,
                        rule_version=rule.version,
                        template_key=key,
                        title=template["task"],
                        entity_id=event.entity_id,
                        entity_type=(
                            "product"
                            if key == "restock_review"
                            else "service_case"
                            if key == "service_case_overdue"
                            else "customer_order"
                        ),
                        entity_version=event.entity_version,
                        status="pending",
                        version=1,
                    )
                )
                db.flush()
                result["created"] += 1
        event.processed_at = stamp
        result["processed"] += 1
    db.flush()
    return result


def resolve(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    run_id: UUID,
    expected_version: int,
    status: str,
) -> RunResponse:
    if status not in {"completed", "dismissed"}:
        raise bad_request("Estado de automatización inválido")
    branch_id = active_branch_id(db, tenant_id)
    _lock(db, tenant_id, branch_id)
    run = _run_query(db, tenant_id, branch_id).filter_by(id=run_id).first()
    if run is None:
        raise not_found("Tarea no encontrada")
    if run.version != expected_version:
        # Same final operation/version retry is safe without another mutation.
        if run.version == expected_version + 1 and run.status == status:
            return RunResponse.model_validate(run)
        raise conflict("La tarea cambió; actualiza antes de continuar")
    if run.status != "pending":
        raise conflict("La tarea ya no está pendiente")
    rule = _rule_query(db, tenant_id, branch_id).filter_by(id=run.rule_id).first()
    if not (
        rule
        and rule.enabled
        and rule.version == run.rule_version
        and _authorized(db, rule)
        and _source_valid(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
            template_key=run.template_key,
            entity_id=run.entity_id,
            entity_version=run.entity_version,
        )
    ):
        raise conflict("La autorización o los datos de la tarea cambiaron")
    run.status = status
    run.version += 1
    run.resolved_at = now()
    log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="automation.run.resolved",
        resource_type="automation_run",
        resource_id=run.id,
        changes={"status": status, "version": run.version},
    )
    db.flush()
    return RunResponse.model_validate(run)
