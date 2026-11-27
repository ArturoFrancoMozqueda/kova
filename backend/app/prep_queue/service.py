"""Preparation queue for counter sales and customer orders (ADR-045).

- A counter sale whose products name a station gets one ticket per station and
  a short daily number per branch. Tickets move received → preparing → ready →
  delivered; going back is a manager correction and is audited.
- Customer orders are shown with their own status (confirmed → received,
  in_progress → preparing, ready, fulfilled → delivered); the queue never keeps
  a second state for them. Their changes go through Pedidos.
- A sale synced from offline long after it was rung is not queued: by then it
  was already prepared.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.branches.scope import active_branch_id
from app.catalog.models import Product
from app.customers.models import Customer
from app.modifiers.models import OrderItemModifier
from app.orders.models import Order, OrderItem
from app.prep_queue.models import PrepDailyNumber, PrepStation, PrepTicket
from app.prep_queue.schemas import StationCreate, StationUpdate, TicketStatusChange
from app.shared.exceptions import bad_request, conflict, forbidden, not_found
from app.shared.timezone import tenant_timezone

FLOW = ("received", "preparing", "ready", "delivered")
_TIMESTAMP = {"preparing": "preparing_at", "ready": "ready_at", "delivered": "delivered_at"}
# Delivered cards stay visible briefly so a mistake can be corrected.
RECENT_DELIVERED = timedelta(minutes=15)
# Offline sales synced later than this were already prepared at the counter.
LATE_SYNC = timedelta(minutes=20)
_MANAGERS = {"owner", "manager"}
_ORDER_STATUS = {"confirmed": "received", "in_progress": "preparing", "ready": "ready",
                 "fulfilled": "delivered"}


def _now() -> datetime:
    return datetime.now(UTC)


# --- stations -----------------------------------------------------------------


def list_stations(db: Session, *, tenant_id: UUID, include_inactive: bool = False):
    query = db.query(PrepStation).filter(PrepStation.tenant_id == tenant_id)
    if not include_inactive:
        query = query.filter(PrepStation.is_active.is_(True))
    return query.order_by(PrepStation.position, PrepStation.name).all()


def _name_taken(db: Session, *, tenant_id: UUID, name: str, exclude: UUID | None = None) -> bool:
    query = db.query(PrepStation.id).filter(
        PrepStation.tenant_id == tenant_id,
        PrepStation.is_active.is_(True),
        func.lower(PrepStation.name) == name.lower(),
    )
    if exclude:
        query = query.filter(PrepStation.id != exclude)
    return query.first() is not None


def create_station(db: Session, *, tenant_id: UUID, user_id: UUID, body: StationCreate):
    if _name_taken(db, tenant_id=tenant_id, name=body.name):
        raise conflict("Ya existe una estación con ese nombre")
    position = (
        db.query(func.coalesce(func.max(PrepStation.position), -1))
        .filter(PrepStation.tenant_id == tenant_id)
        .scalar()
    ) + 1
    station = PrepStation(
        tenant_id=tenant_id, name=body.name, alert_minutes=body.alert_minutes, position=position
    )
    db.add(station)
    db.flush()
    audit_service.log(
        db, action="prep.station.create", tenant_id=tenant_id, user_id=user_id,
        resource_type="prep_station", resource_id=station.id,
        changes={"name": station.name, "alert_minutes": station.alert_minutes},
    )
    db.commit()
    return station


def update_station(
    db: Session, *, tenant_id: UUID, user_id: UUID, station_id: UUID, body: StationUpdate
):
    station = (
        db.query(PrepStation)
        .filter(PrepStation.tenant_id == tenant_id, PrepStation.id == station_id)
        .with_for_update()
        .first()
    )
    if station is None:
        raise not_found("Estación no encontrada")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name") and _name_taken(
        db, tenant_id=tenant_id, name=changes["name"], exclude=station.id
    ):
        raise conflict("Ya existe una estación con ese nombre")
    if changes.get("is_active") and not station.is_active and _name_taken(
        db, tenant_id=tenant_id, name=changes.get("name") or station.name, exclude=station.id
    ):
        raise conflict("Ya existe una estación activa con ese nombre")
    for field, value in changes.items():
        if value is not None:
            setattr(station, field, value)
    db.flush()
    audit_service.log(
        db, action="prep.station.update", tenant_id=tenant_id, user_id=user_id,
        resource_type="prep_station", resource_id=station.id, changes=changes,
    )
    db.commit()
    return station


def ensure_station(db: Session, *, tenant_id: UUID, station_id: UUID | None) -> None:
    """A product may only name an active station of its own business."""
    if station_id is None:
        return
    found = (
        db.query(PrepStation.id)
        .filter(
            PrepStation.tenant_id == tenant_id,
            PrepStation.id == station_id,
            PrepStation.is_active.is_(True),
        )
        .first()
    )
    if found is None:
        raise bad_request("La estación de preparación no existe o está desactivada")


# --- tickets from sales ---------------------------------------------------------


def _next_number(db: Session, *, tenant_id: UUID, branch_id: UUID, local_date) -> int:
    statement = (
        insert(PrepDailyNumber)
        .values(tenant_id=tenant_id, branch_id=branch_id, local_date=local_date, last_number=1)
        .on_conflict_do_update(
            index_elements=["tenant_id", "branch_id", "local_date"],
            set_={"last_number": PrepDailyNumber.last_number + 1},
        )
        .returning(PrepDailyNumber.last_number)
    )
    return db.execute(statement).scalar_one()


def queue_sale(
    db: Session,
    *,
    tenant_id: UUID,
    order: Order,
    products: list[Product],
    synced_offline: bool = False,
) -> int | None:
    """Open one ticket per active station in this sale; returns the daily number."""
    station_ids = {product.prep_station_id for product in products if product.prep_station_id}
    if not station_ids:
        return None
    rung_at = order.occurred_at or order.created_at or _now()
    if synced_offline and _now() - rung_at > LATE_SYNC:
        return None
    active = sorted(
        (
            station_id
            for (station_id,) in db.query(PrepStation.id).filter(
                PrepStation.tenant_id == tenant_id,
                PrepStation.id.in_(station_ids),
                PrepStation.is_active.is_(True),
            )
        ),
        key=str,
    )
    if not active:
        return None
    local_date = rung_at.astimezone(tenant_timezone(db, tenant_id=tenant_id)).date()
    number = _next_number(db, tenant_id=tenant_id, branch_id=order.branch_id, local_date=local_date)
    for station_id in active:
        db.add(
            PrepTicket(
                tenant_id=tenant_id,
                branch_id=order.branch_id,
                order_id=order.id,
                station_id=station_id,
                number=number,
                local_date=local_date,
                received_at=rung_at,
            )
        )
    db.flush()
    return number


def cancel_for_sale(db: Session, *, tenant_id: UUID, order_id: UUID) -> None:
    """A voided sale leaves the queue; work already delivered keeps its history."""
    now = _now()
    for ticket in db.query(PrepTicket).filter(
        PrepTicket.tenant_id == tenant_id,
        PrepTicket.order_id == order_id,
        PrepTicket.status.in_(("received", "preparing", "ready")),
    ):
        ticket.status = "cancelled"
        ticket.version += 1
        ticket.updated_at = now


def number_for_sale(db: Session, *, tenant_id: UUID, order_id: UUID) -> int | None:
    return (
        db.query(PrepTicket.number)
        .filter(PrepTicket.tenant_id == tenant_id, PrepTicket.order_id == order_id)
        .limit(1)
        .scalar()
    )


# --- the queue ------------------------------------------------------------------


def _sale_items(db: Session, *, tenant_id: UUID, order_ids: list[UUID]):
    """Items of these sales by (order, station), with modifiers in order."""
    if not order_ids:
        return {}
    rows = (
        db.query(OrderItem, Product.prep_station_id)
        .join(Product, Product.id == OrderItem.product_id)
        .filter(OrderItem.tenant_id == tenant_id, OrderItem.order_id.in_(order_ids))
        .order_by(OrderItem.id)
        .all()
    )
    modifiers: dict[UUID, list[str]] = defaultdict(list)
    item_ids = [item.id for item, _ in rows]
    if item_ids:
        for modifier in (
            db.query(OrderItemModifier)
            .filter(
                OrderItemModifier.tenant_id == tenant_id,
                OrderItemModifier.order_item_id.in_(item_ids),
            )
            .order_by(OrderItemModifier.modifier_group_name, OrderItemModifier.modifier_option_name)
        ):
            modifiers[modifier.order_item_id].append(modifier.modifier_option_name)
    grouped: dict[tuple[UUID, UUID], list[dict]] = defaultdict(list)
    for item, station_id in rows:
        if station_id is None:
            continue
        grouped[(item.order_id, station_id)].append(
            {"product_name": item.product_name, "quantity": item.quantity,
             "modifiers": modifiers[item.id], "note": None}
        )
    return grouped


def _ticket_cards(db: Session, *, tenant_id: UUID, now: datetime) -> list[dict]:
    tickets = (
        db.query(PrepTicket)
        .filter(
            PrepTicket.tenant_id == tenant_id,
            or_(
                PrepTicket.status.in_(("received", "preparing", "ready")),
                (PrepTicket.status == "delivered")
                & (PrepTicket.delivered_at >= now - RECENT_DELIVERED),
            ),
        )
        .order_by(PrepTicket.received_at, PrepTicket.number)
        .limit(300)
        .all()
    )
    order_ids = list({ticket.order_id for ticket in tickets})
    items = _sale_items(db, tenant_id=tenant_id, order_ids=order_ids)
    names = dict(
        db.query(Order.id, Customer.name)
        .join(Customer, Customer.id == Order.customer_id)
        .filter(Order.tenant_id == tenant_id, Order.id.in_(order_ids))
        .all()
    ) if order_ids else {}
    return [
        {
            "kind": "sale", "id": ticket.id, "station_id": ticket.station_id,
            "status": ticket.status, "version": ticket.version, "number": ticket.number,
            "customer_name": names.get(ticket.order_id), "sale_order_id": ticket.order_id,
            "received_at": ticket.received_at, "preparing_at": ticket.preparing_at,
            "ready_at": ticket.ready_at, "delivered_at": ticket.delivered_at,
            "items": items.get((ticket.order_id, ticket.station_id), []),
        }
        for ticket in tickets
    ]


def _customer_order_cards(db: Session, *, tenant_id: UUID, now: datetime) -> list[dict]:
    from app.customer_orders import repository as order_repo
    from app.customer_orders.models import (
        CustomerOrder,
        CustomerOrderItem,
        CustomerOrderItemModifier,
    )
    from app.tenants import repository as tenant_repo
    from app.tenants.feature_flags import CUSTOMER_ORDERS, resolve_feature_flags

    tenant = tenant_repo.get_by_id(db, tenant_id)
    if not resolve_feature_flags(tenant.feature_overrides if tenant else None)[CUSTOMER_ORDERS]:
        return []
    tz = tenant_timezone(db, tenant_id=tenant_id)
    end_of_today = datetime.combine(
        now.astimezone(tz).date() + timedelta(days=1), datetime.min.time(), tzinfo=tz
    )
    orders = (
        db.query(CustomerOrder)
        .filter(
            CustomerOrder.tenant_id == tenant_id,
            or_(
                CustomerOrder.status.in_(("confirmed", "in_progress", "ready")),
                (CustomerOrder.status == "fulfilled")
                & (CustomerOrder.fulfilled_at >= now - RECENT_DELIVERED),
            ),
            # Orders promised for a later day wait outside today's queue.
            or_(CustomerOrder.promised_at.is_(None), CustomerOrder.promised_at < end_of_today),
        )
        .order_by(func.coalesce(CustomerOrder.promised_at, CustomerOrder.confirmed_at))
        .limit(200)
        .all()
    )
    if not orders:
        return []
    rows = (
        db.query(CustomerOrderItem, Product.prep_station_id)
        .join(Product, Product.id == CustomerOrderItem.product_id)
        .filter(
            CustomerOrderItem.tenant_id == tenant_id,
            CustomerOrderItem.customer_order_id.in_([order.id for order in orders]),
            Product.prep_station_id.is_not(None),
        )
        .order_by(CustomerOrderItem.id)
        .all()
    )
    modifiers: dict[UUID, list[str]] = defaultdict(list)
    if rows:
        for modifier in db.query(CustomerOrderItemModifier).filter(
            CustomerOrderItemModifier.tenant_id == tenant_id,
            CustomerOrderItemModifier.customer_order_item_id.in_([item.id for item, _ in rows]),
        ):
            modifiers[modifier.customer_order_item_id].append(modifier.modifier_option_name)
    grouped: dict[tuple[UUID, UUID], list[dict]] = defaultdict(list)
    for item, station_id in rows:
        grouped[(item.customer_order_id, station_id)].append(
            {"product_name": item.product_name, "quantity": item.quantity,
             "modifiers": modifiers[item.id], "note": item.note}
        )
    cards = []
    for order in orders:
        stations = sorted({station for (order_id, station) in grouped if order_id == order.id},
                          key=str)
        for station_id in stations:
            cards.append({
                "kind": "customer_order", "id": order.id, "station_id": station_id,
                "status": _ORDER_STATUS[order.status], "version": order.version,
                "folio": order.folio, "customer_name": order.customer_name,
                "sale_order_id": order.sale_order_id,
                "payment_status": order_repo.payment_status(db, order=order),
                "promised_at": order.promised_at,
                "received_at": order.confirmed_at or order.created_at,
                "ready_at": order.ready_at, "delivered_at": order.fulfilled_at,
                "items": grouped[(order.id, station_id)],
            })
    return cards


def queue(db: Session, *, tenant_id: UUID) -> dict:
    now = _now()
    stations = list_stations(db, tenant_id=tenant_id)
    active = {station.id for station in stations}
    cards = [
        card
        for card in _ticket_cards(db, tenant_id=tenant_id, now=now)
        + _customer_order_cards(db, tenant_id=tenant_id, now=now)
        if card["station_id"] in active
    ]
    cards.sort(key=lambda card: card.get("promised_at") or card["received_at"])
    return {"stations": stations, "cards": cards, "generated_at": now}


def change_ticket_status(
    db: Session, *, tenant_id: UUID, user_id: UUID, role: str, ticket_id: UUID,
    body: TicketStatusChange,
) -> dict:
    ticket = (
        db.query(PrepTicket)
        .filter(
            PrepTicket.tenant_id == tenant_id,
            PrepTicket.id == ticket_id,
            PrepTicket.branch_id == active_branch_id(db, tenant_id),
        )
        .with_for_update()
        .first()
    )
    if ticket is None:
        raise not_found("Orden de preparación no encontrada")
    if ticket.status == body.status:
        # A retry of a change that already happened answers with the current card.
        return _ticket_body(ticket)
    if ticket.status == "cancelled":
        raise conflict("Esta venta se canceló; ya no se prepara")
    if ticket.version != body.version:
        raise conflict("Otra persona actualizó esta orden; revisa su estado")
    backwards = FLOW.index(body.status) < FLOW.index(ticket.status)
    if backwards and role not in _MANAGERS:
        raise forbidden("Solo gerencia puede regresar una orden a un estado anterior")
    now = _now()
    previous = ticket.status
    for status in FLOW[1:]:
        field = _TIMESTAMP[status]
        if FLOW.index(status) <= FLOW.index(body.status):
            if getattr(ticket, field) is None:
                setattr(ticket, field, now)
        else:
            setattr(ticket, field, None)
    ticket.status = body.status
    ticket.version += 1
    ticket.updated_by_user_id = user_id
    ticket.updated_at = now
    db.flush()
    if backwards:
        audit_service.log(
            db, action="prep.ticket.reopen", tenant_id=tenant_id, user_id=user_id,
            resource_type="prep_ticket", resource_id=ticket.id,
            changes={"from": previous, "to": body.status, "number": ticket.number},
        )
    body_out = _ticket_body(ticket)
    db.commit()
    return body_out


def _ticket_body(ticket: PrepTicket) -> dict:
    return {
        "id": ticket.id, "status": ticket.status, "version": ticket.version,
        "number": ticket.number, "station_id": ticket.station_id,
        "preparing_at": ticket.preparing_at, "ready_at": ticket.ready_at,
        "delivered_at": ticket.delivered_at,
    }
