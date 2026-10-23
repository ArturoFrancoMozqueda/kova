"""Immutable server-priced quotes; conversion never records revenue or reserves."""

import hashlib
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.audit.service import log
from app.branches.scope import active_branch_id
from app.catalog.models import Product
from app.crm.engagement_models import CatalogRequest
from app.crm.models import Opportunity
from app.customer_orders.models import CustomerOrder
from app.customer_orders.schemas import CustomerOrderCreate, CustomerOrderItemCreate
from app.customer_orders.service import create_customer_order
from app.customers.models import Customer
from app.idempotency import service as idempotency
from app.modifiers.models import ProductModifierGroup
from app.orders.models import Order, Payment
from app.pricing.calculator import line_total, order_total
from app.quotes.models import CustomerQuote, CustomerQuoteItem, now
from app.quotes.schemas import QuoteCreate, QuoteJourney, QuoteList, QuoteResponse
from app.shared.exceptions import bad_request, conflict, forbidden, not_found
from app.tenants.feature_flags import CUSTOMER_ORDERS, resolve_feature_flags
from app.tenants.models import Tenant

MAX_TOTAL = Decimal("9999999999.99")


def _query(db, tenant_id):
    return db.query(CustomerQuote).filter(
        CustomerQuote.tenant_id == tenant_id,
        CustomerQuote.branch_id == active_branch_id(db, tenant_id),
    )


def _get(db, tenant_id, quote_id):
    row = _query(db, tenant_id).filter(CustomerQuote.id == quote_id).with_for_update().first()
    if row is None:
        raise not_found("Cotización no encontrada")
    return row


def _customer(db, tenant_id, customer_id):
    customer = (
        db.query(Customer)
        .filter(
            Customer.tenant_id == tenant_id,
            Customer.id == customer_id,
            Customer.is_active.is_(True),
        )
        .first()
    )
    if customer is None:
        raise not_found("Cliente activo no encontrado")
    return customer


def _items(db, row):
    return (
        db.query(CustomerQuoteItem)
        .filter(
            CustomerQuoteItem.tenant_id == row.tenant_id,
            CustomerQuoteItem.branch_id == row.branch_id,
            CustomerQuoteItem.quote_id == row.id,
        )
        .order_by(CustomerQuoteItem.product_id)
        .all()
    )


def _effective_status(row):
    if row.status in {"draft", "sent"} and row.expires_at <= now():
        return "expired"
    return row.status


def _serialize(db, row):
    return QuoteResponse(
        id=row.id,
        folio=row.folio,
        status=_effective_status(row),
        customer_id=row.customer_id,
        opportunity_id=row.opportunity_id,
        customer_name=row.customer_name,
        expires_at=row.expires_at,
        items=_items(db, row),
        total_amount=row.total_amount,
        version=row.version,
        customer_order_id=row.customer_order_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    ).model_dump(mode="json")


def _request(db, tenant_id, key, operation, body):
    if not key or not key.strip() or len(key) > 200:
        raise bad_request("Idempotency-Key debe contener entre 1 y 200 caracteres")
    # An absent opportunity must preserve request identities created before
    # attribution existed, including retries that cross a deployment boundary.
    canonical = body.model_dump_json(exclude_none=True)
    fingerprint = hashlib.sha256(f"quote:{operation}:{canonical}".encode()).hexdigest()
    replay = idempotency.claim(db, tenant_id=tenant_id, key=key, request_hash=fingerprint)
    return fingerprint, replay


def _finish(db, *, tenant_id, user_id, key, fingerprint, row, action, status=200):
    result = _serialize(db, row)
    log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type="customer_quote",
        resource_id=row.id,
        changes={
            "status": row.status,
            "version": row.version,
            "customer_order_id": str(row.customer_order_id) if row.customer_order_id else None,
        },
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


def list_quotes(db: Session, *, tenant_id: UUID, limit=50, offset=0) -> QuoteList:
    query = _query(db, tenant_id)
    total = query.count()
    rows = (
        query.order_by(CustomerQuote.created_at.desc(), CustomerQuote.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return QuoteList(items=[_serialize(db, row) for row in rows], total=total)


def journey(db: Session, *, tenant_id: UUID, quote_id: UUID) -> QuoteJourney:
    """Read explicit immutable links only; never attribute by phone/name or amount."""
    row = _query(db, tenant_id).filter(CustomerQuote.id == quote_id).first()
    if row is None:
        raise not_found("Cotización no encontrada")
    opportunity = None
    request = None
    if row.opportunity_id is not None:
        opportunity = db.query(Opportunity).filter(
            Opportunity.tenant_id == tenant_id, Opportunity.branch_id == row.branch_id,
            Opportunity.id == row.opportunity_id,
        ).first()
        request = db.query(CatalogRequest).filter(
            CatalogRequest.tenant_id == tenant_id, CatalogRequest.branch_id == row.branch_id,
            CatalogRequest.opportunity_id == row.opportunity_id,
        ).order_by(CatalogRequest.created_at, CatalogRequest.id).first()
    order = None
    if row.customer_order_id is not None:
        order = db.query(CustomerOrder).filter(
            CustomerOrder.tenant_id == tenant_id, CustomerOrder.branch_id == row.branch_id,
            CustomerOrder.id == row.customer_order_id,
        ).first()
    sale = None
    if order is not None and order.sale_order_id is not None:
        sale = db.query(Order).filter(
            Order.tenant_id == tenant_id, Order.branch_id == row.branch_id,
            Order.id == order.sale_order_id,
        ).first()
    payments = None
    if sale is not None:
        payments = sum((payment.amount_amount for payment in db.query(Payment).filter(
            Payment.tenant_id == tenant_id, Payment.order_id == sale.id,
        )), Decimal("0.00"))
    return QuoteJourney(
        quote_id=row.id, catalog_request_id=request.id if request else None,
        opportunity_id=row.opportunity_id,
        opportunity_stage=opportunity.stage if opportunity else None,
        customer_order_id=row.customer_order_id,
        customer_order_status=order.status if order else None,
        sale_order_id=sale.id if sale else None,
        sale_status=sale.status if sale else None,
        sale_total_amount=sale.total_amount if sale else None,
        recorded_payments_amount=payments,
    )


def _products(db, tenant_id, ids, *, stale=False):
    rows = (
        db.query(Product)
        .filter(
            Product.tenant_id == tenant_id,
            Product.id.in_(ids),
            Product.is_active.is_(True),
        )
        .order_by(Product.id)
        .with_for_update()
        .all()
    )
    if len(rows) != len(ids):
        if stale:
            raise conflict("El catálogo cambió. Revisa y crea una cotización nueva.")
        raise not_found("Selecciona productos activos de este negocio")
    has_modifiers = (
        db.query(ProductModifierGroup.id)
        .filter(
            ProductModifierGroup.tenant_id == tenant_id, ProductModifierGroup.product_id.in_(ids)
        )
        .first()
    )
    if has_modifiers:
        if stale:
            raise conflict("Los modificadores cambiaron. Revisa y crea una cotización nueva.")
        raise bad_request("Cotizaciones admite productos sin modificadores en esta versión")
    return {row.id: row for row in rows}


def create(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: QuoteCreate,
    key: str,
):
    fingerprint, replay = _request(db, tenant_id, key, "create", body)
    if replay:
        return replay.response_status, replay.response_body
    if body.expires_at <= now():
        raise bad_request("La vigencia de la cotización debe ser futura")
    customer = _customer(db, tenant_id, body.customer_id)
    if body.opportunity_id is not None:
        opportunity = db.query(Opportunity).filter(
            Opportunity.tenant_id == tenant_id,
            Opportunity.branch_id == active_branch_id(db, tenant_id),
            Opportunity.id == body.opportunity_id,
            Opportunity.customer_id == customer.id,
        ).with_for_update().first()
        if opportunity is None:
            raise not_found("Oportunidad no encontrada para este cliente y sucursal")
    if customer.phone and not 7 <= len("".join(ch for ch in customer.phone if ch.isdigit())) <= 15:
        raise bad_request(
            "Actualiza el teléfono del cliente antes de cotizar; requiere 7 a 15 dígitos"
        )
    products = _products(db, tenant_id, [item.product_id for item in body.items])
    totals = [
        line_total(products[item.product_id].price_amount, item.quantity) for item in body.items
    ]
    total = order_total(totals)
    if total > MAX_TOTAL:
        raise bad_request("El total excede el importe máximo permitido")
    identifier = uuid4()
    row = CustomerQuote(
        id=identifier,
        tenant_id=tenant_id,
        branch_id=active_branch_id(db, tenant_id),
        customer_id=customer.id,
        opportunity_id=body.opportunity_id,
        folio=f"COT-{identifier.hex[-8:].upper()}",
        customer_name=customer.name,
        customer_phone=customer.phone,
        status="draft",
        total_amount=total,
        expires_at=body.expires_at,
        created_by_user_id=user_id,
        updated_by_user_id=user_id,
        version=1,
    )
    db.add(row)
    db.flush()
    for item, total_line in zip(body.items, totals, strict=True):
        product = products[item.product_id]
        db.add(
            CustomerQuoteItem(
                tenant_id=tenant_id,
                branch_id=row.branch_id,
                quote_id=row.id,
                product_id=product.id,
                product_name=product.name,
                quantity=item.quantity,
                unit_price_amount=product.price_amount,
                line_total_amount=total_line,
            )
        )
    db.flush()
    return _finish(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        key=key,
        fingerprint=fingerprint,
        row=row,
        action="quotes.create",
        status=201,
    )


def _version(row, expected_version):
    if row.version != expected_version:
        raise conflict("La cotización cambió. Actualiza antes de continuar.")
    if _effective_status(row) == "expired":
        raise conflict("La cotización venció. Revisa y crea una cotización nueva.")


def mark_sent(db: Session, *, tenant_id: UUID, user_id: UUID, quote_id: UUID, body, key: str):
    fingerprint, replay = _request(db, tenant_id, key, f"{quote_id}:mark-sent", body)
    if replay:
        return replay.response_status, replay.response_body
    row = _get(db, tenant_id, quote_id)
    _version(row, body.expected_version)
    if row.status != "draft":
        raise conflict("Sólo se registra el envío de una cotización en borrador")
    row.status = "sent"
    row.shared_at = now()
    row.updated_at = now()
    row.updated_by_user_id = user_id
    row.version += 1
    db.flush()
    return _finish(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        key=key,
        fingerprint=fingerprint,
        row=row,
        action="quotes.sharing_recorded",
    )


def cancel(db: Session, *, tenant_id: UUID, user_id: UUID, quote_id: UUID, body, key: str):
    fingerprint, replay = _request(db, tenant_id, key, f"{quote_id}:cancel", body)
    if replay:
        return replay.response_status, replay.response_body
    row = _get(db, tenant_id, quote_id)
    _version(row, body.expected_version)
    if row.status not in {"draft", "sent"}:
        raise conflict("Una cotización convertida se gestiona desde su pedido")
    row.status = "cancelled"
    row.updated_at = now()
    row.updated_by_user_id = user_id
    row.version += 1
    db.flush()
    return _finish(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        key=key,
        fingerprint=fingerprint,
        row=row,
        action="quotes.cancelled",
    )


def accept(db: Session, *, tenant_id: UUID, user_id: UUID, quote_id: UUID, body, key: str):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant is None or not resolve_feature_flags(tenant.feature_overrides)[CUSTOMER_ORDERS]:
        raise forbidden("Habilita Pedidos para convertir una cotización")
    fingerprint, replay = _request(db, tenant_id, key, f"{quote_id}:accept", body)
    if replay:
        return replay.response_status, replay.response_body
    row = _get(db, tenant_id, quote_id)
    _version(row, body.expected_version)
    if row.status != "sent":
        raise conflict("Registra primero que la cotización fue compartida con el cliente")
    _customer(db, tenant_id, row.customer_id)
    items = _items(db, row)
    products = _products(db, tenant_id, [item.product_id for item in items], stale=True)
    if any(
        products[item.product_id].price_amount != item.unit_price_amount
        or products[item.product_id].name != item.product_name
        for item in items
    ):
        raise conflict("Los precios o productos cambiaron. Revisa y crea una cotización nueva.")
    # A product lock may have waited beyond the quote's validity window.
    _version(row, body.expected_version)
    order_body = CustomerOrderCreate(
        fulfillment_type="pickup",
        source_channel="other",
        customer_id=row.customer_id,
        customer_name=row.customer_name,
        customer_phone=row.customer_phone,
        note=f"Cotización {row.folio} aceptada.",
        items=[
            CustomerOrderItemCreate(product_id=item.product_id, quantity=item.quantity)
            for item in items
        ],
    )
    internal_key = f"quote-order:{row.id}"
    _, order = create_customer_order(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        body=order_body,
        idempotency_key=internal_key,
        commit=False,
    )
    # The existing domain calculated the order. Never overwrite its prices.
    if Decimal(str(order["total_amount"])) != row.total_amount:
        raise conflict("El importe cambió. Revisa y crea una cotización nueva.")
    row.customer_order_id = UUID(order["id"])
    row.status = "accepted"
    row.accepted_at = now()
    row.updated_at = now()
    row.updated_by_user_id = user_id
    row.version += 1
    db.flush()
    return _finish(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        key=key,
        fingerprint=fingerprint,
        row=row,
        action="quotes.acceptance_recorded",
    )
