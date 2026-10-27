"""Reviewable commercial intake and opt-in, internal-only retention tasks."""

import hashlib
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import exists, or_

from app.audit import service as audit
from app.auth.models import Membership, User
from app.billing.access import get_billing_access_status
from app.branches.scope import active_branch_id
from app.crm.engagement_models import CatalogRequest, FollowupPolicy, FollowupTask
from app.crm.engagement_schemas import CatalogRequestResponse, FollowupResponse, PolicyResponse
from app.crm.models import Opportunity, now
from app.crm.service import _assignee, _customer, _request
from app.customers.models import Customer
from app.idempotency import service as idempotency
from app.orders.models import Order, Refund
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.models import Tenant


def request_response(row):
    return CatalogRequestResponse(
        **{k: getattr(row, k) for k in CatalogRequestResponse.model_fields}
    ).model_dump(mode="json")


def _finish(db, tenant_id, user_id, key, fingerprint, row, result, action, status=200):
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type=row.__tablename__,
        resource_id=row.id,
        changes={"version": row.version},
    )
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=status,
        response_body=result,
    )
    db.commit()
    return status, result


def capture_request(db, catalog, body):
    # Serialize against withdrawal/rotation and public retries without a global identity key.
    from app.catalog.models import Product
    from app.storefront.models import PublicCatalog, PublicCatalogItem

    expected_link_version = catalog.link_version
    current = (
        db.query(PublicCatalog)
        .filter_by(id=catalog.id, tenant_id=catalog.tenant_id)
        .populate_existing()
        .with_for_update()
        .one()
    )
    if not current.enabled or current.link_version != expected_link_version:
        raise not_found("Catálogo no disponible")
    # New optional structure must not change fingerprints of existing clients.
    legacy = {"order_lines", "origin"} if body.order_lines is None else set()
    fingerprint = hashlib.sha256(body.model_dump_json(exclude=legacy).encode()).hexdigest()
    existing = (
        db.query(CatalogRequest)
        .filter_by(
            tenant_id=current.tenant_id, catalog_id=current.id, submission_id=body.submission_id
        )
        .first()
    )
    if existing:
        if existing.request_hash != fingerprint:
            raise conflict("La referencia de solicitud ya fue utilizada")
        from app.storefront.order_tracking import receipt

        return receipt(db, existing)
    selected = (
        db.query(Product)
        .select_from(PublicCatalogItem)
        .join(
            Product,
            (Product.id == PublicCatalogItem.product_id)
            & (Product.tenant_id == PublicCatalogItem.tenant_id),
        )
        .filter(
            PublicCatalogItem.tenant_id == current.tenant_id,
            PublicCatalogItem.catalog_id == current.id,
            PublicCatalogItem.product_id.in_(body.product_ids),
            Product.is_active.is_(True),
        )
        .all()
    )
    if len(selected) != len(body.product_ids):
        raise bad_request("Selecciona productos disponibles en este catálogo")
    snapshots = None
    if body.order_lines is not None:
        products = {product.id: product for product in selected}
        snapshots = [{
            "product_id": str(line.product_id),
            "product_name": products[line.product_id].name,
            "quantity": line.quantity,
            "unit_price_amount": str(products[line.product_id].price_amount),
            "line_total_amount": str(products[line.product_id].price_amount * line.quantity),
        } for line in body.order_lines]
    row = CatalogRequest(
        tenant_id=current.tenant_id,
        branch_id=current.branch_id,
        catalog_id=current.id,
        submission_id=body.submission_id,
        request_hash=fingerprint,
        name=body.name,
        contact=body.contact,
        message=body.message,
        product_ids=[str(x) for x in body.product_ids],
        order_lines=snapshots,
        origin=body.origin,
    )
    db.add(row)
    db.flush()
    from app.storefront.order_tracking import receipt

    result = receipt(db, row)
    db.commit()
    return result


def list_requests(db, tenant_id, limit=100, offset=0):
    rows = (
        db.query(CatalogRequest)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id))
        .order_by(CatalogRequest.created_at.desc(), CatalogRequest.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {"requests": [request_response(r) for r in rows[:limit]], "has_more": len(rows) > limit}


def resolve_request(db, tenant_id, user_id, request_id, body, key):
    fingerprint, replay = _request(db, tenant_id, key, f"request-resolve:{request_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    row = (
        db.query(CatalogRequest)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=request_id)
        .with_for_update()
        .first()
    )
    if row is None:
        raise not_found("Solicitud no encontrada")
    if row.version != body.expected_version or row.status != "new":
        raise conflict("La solicitud cambió. Actualiza antes de continuar")
    if body.status == "converted":
        customer = _customer(db, tenant_id, body.customer_id)
        if not customer.is_active:
            raise bad_request("Reactiva al cliente antes de convertir la solicitud")
        opportunity = Opportunity(
            tenant_id=tenant_id,
            branch_id=row.branch_id,
            customer_id=customer.id,
            title="Solicitud del catálogo",
            estimated_amount=Decimal("0.00"),
            next_action="Revisar productos y preparar cotización",
            note=row.message,
            created_by_user_id=user_id,
            updated_by_user_id=user_id,
        )
        db.add(opportunity)
        db.flush()
        row.customer_id, row.opportunity_id = customer.id, opportunity.id
    row.status = body.status
    row.version += 1
    row.resolved_at = now()
    db.flush()
    return _finish(
        db, tenant_id, user_id, key, fingerprint, row, request_response(row), "crm.request.resolved"
    )


def _policy(db, tenant_id, *, lock=False):
    q = db.query(FollowupPolicy).filter_by(
        tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id)
    )
    return (q.with_for_update() if lock else q).first()


def policy_response(row):
    return (
        PolicyResponse(
            enabled=row.enabled,
            review_delay_days=row.review_delay_days,
            rebuy_delay_days=row.rebuy_delay_days,
            version=row.version,
        ).model_dump(mode="json")
        if row
        else {"enabled": False, "review_delay_days": 2, "rebuy_delay_days": 30, "version": 0}
    )


def task_response(db, row):
    fields = {k: getattr(row, k) for k in FollowupResponse.model_fields if k != "customer_name"}
    return FollowupResponse(
        **fields, customer_name=_customer(db, row.tenant_id, row.customer_id).name
    ).model_dump(mode="json")


def get_followup(db, tenant_id, task_id):
    row = db.query(FollowupTask).filter_by(
        tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=task_id
    ).first()
    if row is None:
        raise not_found("Seguimiento no encontrado")
    return task_response(db, row)


def followup_overview(db, tenant_id, limit=100, offset=0):
    rows = (
        db.query(FollowupTask)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id))
        .order_by(FollowupTask.due_at, FollowupTask.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "policy": policy_response(_policy(db, tenant_id)),
        "tasks": [task_response(db, r) for r in rows[:limit]],
        "has_more": len(rows) > limit,
    }


def save_policy(db, tenant_id, user_id, body, key):
    from app.branches.models import Branch

    fingerprint, replay = _request(db, tenant_id, key, "followup-policy", body)
    if replay:
        return replay.response_status, replay.response_body
    branch_id = active_branch_id(db, tenant_id)
    db.query(Branch).filter_by(tenant_id=tenant_id, id=branch_id).with_for_update().one()
    row = _policy(db, tenant_id, lock=True)
    if body.expected_version != (row.version if row else 0):
        raise conflict("La política cambió. Actualiza antes de guardar")
    if row is None:
        row = FollowupPolicy(tenant_id=tenant_id, branch_id=branch_id, version=0, enabled=False)
        db.add(row)
    if body.enabled and not row.enabled:
        row.enabled_since = now()
    row.enabled = body.enabled
    row.review_delay_days, row.rebuy_delay_days = body.review_delay_days, body.rebuy_delay_days
    row.authorized_by_user_id = user_id
    row.version += 1
    row.updated_at = now()
    if not body.enabled:
        for task in (
            db.query(FollowupTask)
            .filter_by(tenant_id=tenant_id, branch_id=branch_id, status="pending")
            .filter(FollowupTask.kind.in_(["review", "rebuy"]))
            .with_for_update()
            .all()
        ):
            task.status, task.resolved_at = "dismissed", now()
            task.version += 1
    db.flush()
    return _finish(
        db, tenant_id, user_id, key, fingerprint, row, policy_response(row), "crm.followup.policy"
    )


def _sale(db, tenant_id, sale_id, customer_id):
    sale = (
        db.query(Order)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=active_branch_id(db, tenant_id),
            id=sale_id,
            customer_id=customer_id,
            status="completed",
        )
        .with_for_update()
        .first()
    )
    if sale is None:
        raise not_found("Venta completada de este cliente no encontrada")
    return sale


def create_incident(db, tenant_id, user_id, body, key):
    fingerprint, replay = _request(db, tenant_id, key, "followup-incident", body)
    if replay:
        return replay.response_status, replay.response_body
    _customer(db, tenant_id, body.customer_id)
    _assignee(db, tenant_id, body.assigned_user_id)
    if body.sale_order_id:
        _sale(db, tenant_id, body.sale_order_id, body.customer_id)
        if (
            db.query(FollowupTask.id)
            .filter_by(tenant_id=tenant_id, sale_order_id=body.sale_order_id, kind="incident")
            .first()
        ):
            raise conflict("Esta venta ya tiene una incidencia; actualiza la existente")
    row = FollowupTask(
        tenant_id=tenant_id,
        branch_id=active_branch_id(db, tenant_id),
        kind="incident",
        **body.model_dump(),
    )
    db.add(row)
    db.flush()
    return _finish(
        db,
        tenant_id,
        user_id,
        key,
        fingerprint,
        row,
        task_response(db, row),
        "crm.followup.incident",
        201,
    )


def update_task(db, tenant_id, user_id, task_id, body, key):
    fingerprint, replay = _request(db, tenant_id, key, f"followup-update:{task_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    row = (
        db.query(FollowupTask)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=task_id)
        .with_for_update()
        .first()
    )
    if row is None:
        raise not_found("Seguimiento no encontrado")
    if row.version != body.expected_version or row.status != "pending":
        raise conflict("El seguimiento cambió. Actualiza antes de guardar")
    fields = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    if "assigned_user_id" in fields:
        _assignee(db, tenant_id, fields["assigned_user_id"])
    for field, value in fields.items():
        setattr(row, field, value)
    if row.status != "pending":
        row.resolved_at = now()
    row.version += 1
    db.flush()
    return _finish(
        db,
        tenant_id,
        user_id,
        key,
        fingerprint,
        row,
        task_response(db, row),
        "crm.followup.updated",
    )


def process_due_followups(db, tenant_id, *, limit=100):
    """Called within an authorized tenant+branch; caller owns commit. Bounded, no network."""
    policy = _policy(db, tenant_id, lock=True)
    if not policy or not policy.enabled or not policy.enabled_since:
        return 0
    branch_id = active_branch_id(db, tenant_id)
    permitted = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant_id,
            Membership.user_id == policy.authorized_by_user_id,
            Membership.is_active.is_(True),
            Membership.role.in_(["owner", "manager"]),
            User.is_active.is_(True),
            or_(Membership.allowed_branch_id.is_(None), Membership.allowed_branch_id == branch_id),
        )
        .first()
    )
    if (
        not permitted
        or not db.query(Tenant.id).filter_by(id=tenant_id, is_active=True).first()
        or not get_billing_access_status(db, tenant_id=tenant_id).allowed
    ):
        return 0
    # Missing-effect anti-joins make each bounded pass advance, even with historical volume.
    missing = [
        ~exists().where(
            FollowupTask.tenant_id == tenant_id,
            FollowupTask.sale_order_id == Order.id,
            FollowupTask.kind == kind,
        )
        for kind in ("review", "rebuy")
    ]
    sales = (
        db.query(Order)
        .join(
            Customer, (Customer.id == Order.customer_id) & (Customer.tenant_id == Order.tenant_id)
        )
        .filter(
            Order.tenant_id == tenant_id,
            Order.branch_id == branch_id,
            Order.status == "completed",
            Order.created_at >= policy.enabled_since,
            Customer.is_active.is_(True),
            or_(*missing),
            ~exists().where(Refund.tenant_id == tenant_id, Refund.order_id == Order.id),
        )
        .order_by(Order.created_at, Order.id)
        .limit(min(max(limit, 1), 100))
        .all()
    )
    created = 0
    for sale in sales:
        for kind, delay, title in (
            ("review", policy.review_delay_days, "Solicitar una reseña honesta sobre la compra"),
            ("rebuy", policy.rebuy_delay_days, "Revisar si corresponde seguimiento de recompra"),
        ):
            if (
                not db.query(FollowupTask.id)
                .filter_by(tenant_id=tenant_id, sale_order_id=sale.id, kind=kind)
                .first()
            ):
                db.add(
                    FollowupTask(
                        tenant_id=tenant_id,
                        branch_id=branch_id,
                        customer_id=sale.customer_id,
                        sale_order_id=sale.id,
                        kind=kind,
                        title=title,
                        due_at=sale.created_at + timedelta(days=delay),
                    )
                )
                created += 1
    db.flush()
    return created
