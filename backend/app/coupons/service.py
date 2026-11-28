"""Coupons: validate a code and its limits, and price its discount on the server (E8).

A coupon gives a percentage or an amount off the whole sale, before tax. Any
cashier can apply a valid code because the server computes the amount; creating
and pausing coupons is a manager decision. One discount per sale: a coupon does
not combine with a loyalty reward or a manual discount. Checkout is online only
and locks the coupon so its limits hold under concurrent sales. Voiding the
sale releases the use.
"""

import hashlib
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.catalog.models import Product
from app.coupons.models import Coupon, CouponRedemption
from app.coupons.schemas import CouponCheckout, CouponCreate, CouponPreview, CouponUpdate
from app.idempotency import service as idempotency
from app.modifiers import service as modifier_service
from app.orders import service as orders
from app.pricing import calculator
from app.shared.exceptions import bad_request, conflict, not_found


def _now() -> datetime:
    return datetime.now(UTC)


def _uses(db: Session, *, tenant_id: UUID, coupon_ids: list[UUID]) -> dict[UUID, int]:
    if not coupon_ids:
        return {}
    return dict(
        db.query(CouponRedemption.coupon_id, func.count())
        .filter(
            CouponRedemption.tenant_id == tenant_id,
            CouponRedemption.coupon_id.in_(coupon_ids),
            CouponRedemption.status == "applied",
        )
        .group_by(CouponRedemption.coupon_id)
        .all()
    )


def _body(coupon: Coupon, uses: int) -> dict:
    return {
        "id": coupon.id, "code": coupon.code, "description": coupon.description,
        "kind": coupon.kind, "value": coupon.value, "min_purchase": coupon.min_purchase,
        "starts_at": coupon.starts_at, "ends_at": coupon.ends_at, "max_uses": coupon.max_uses,
        "max_uses_per_customer": coupon.max_uses_per_customer, "is_active": coupon.is_active,
        "version": coupon.version, "uses": uses, "created_at": coupon.created_at,
    }


def list_coupons(db: Session, *, tenant_id: UUID) -> list[dict]:
    coupons = (
        db.query(Coupon)
        .filter(Coupon.tenant_id == tenant_id)
        .order_by(Coupon.is_active.desc(), Coupon.created_at.desc())
        .all()
    )
    uses = _uses(db, tenant_id=tenant_id, coupon_ids=[coupon.id for coupon in coupons])
    return [_body(coupon, uses.get(coupon.id, 0)) for coupon in coupons]


def create_coupon(db: Session, *, tenant_id: UUID, user_id: UUID, body: CouponCreate) -> dict:
    exists = db.query(Coupon.id).filter(Coupon.tenant_id == tenant_id, Coupon.code == body.code)
    if exists.first() is not None:
        raise conflict("Ya existe un cupón con ese código")
    coupon = Coupon(tenant_id=tenant_id, created_by_user_id=user_id, **body.model_dump())
    db.add(coupon)
    db.flush()
    audit.log(db, action="coupons.create", tenant_id=tenant_id, user_id=user_id,
              resource_type="coupon", resource_id=coupon.id,
              changes={"code": coupon.code, "kind": coupon.kind, "value": str(coupon.value)})
    db.commit()
    return _body(coupon, 0)


def update_coupon(
    db: Session, *, tenant_id: UUID, user_id: UUID, coupon_id: UUID, body: CouponUpdate
) -> dict:
    coupon = (
        db.query(Coupon)
        .filter(Coupon.tenant_id == tenant_id, Coupon.id == coupon_id)
        .with_for_update()
        .first()
    )
    if coupon is None:
        raise not_found("Cupón no encontrado")
    if coupon.version != body.version:
        raise conflict("Otra persona cambió este cupón; actualiza antes de guardar")
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    for field, value in changes.items():
        if field == "is_active" and value is None:
            continue
        setattr(coupon, field, value)
    if coupon.kind == "percent" and coupon.value > 100:
        raise bad_request("Un porcentaje no puede pasar de 100")
    if coupon.starts_at and coupon.ends_at and coupon.ends_at <= coupon.starts_at:
        raise bad_request("La fecha final debe ser posterior a la inicial")
    coupon.version += 1
    db.flush()
    audit.log(db, action="coupons.update", tenant_id=tenant_id, user_id=user_id,
              resource_type="coupon", resource_id=coupon.id,
              changes={key: str(value) for key, value in changes.items()})
    uses = _uses(db, tenant_id=tenant_id, coupon_ids=[coupon.id]).get(coupon.id, 0)
    db.commit()
    return _body(coupon, uses)


def _find(db: Session, *, tenant_id: UUID, code: str, lock: bool = False) -> Coupon:
    query = db.query(Coupon).filter(
        Coupon.tenant_id == tenant_id, Coupon.code == code.strip().upper()
    )
    coupon = (query.with_for_update() if lock else query).first()
    if coupon is None:
        raise not_found("No encontramos ese cupón. Revisa el código.")
    return coupon


def discount_for(
    db: Session, *, tenant_id: UUID, coupon: Coupon, subtotal: Decimal,
    customer_id: UUID | None, now: datetime | None = None,
) -> Decimal:
    """The discount this coupon gives on a subtotal, or a clear reason it does not apply."""
    now = now or _now()
    if not coupon.is_active:
        raise conflict("Este cupón está pausado.")
    if coupon.starts_at and now < coupon.starts_at:
        raise conflict("Este cupón aún no está vigente.")
    if coupon.ends_at and now >= coupon.ends_at:
        raise conflict("Este cupón ya venció.")
    if coupon.min_purchase is not None and subtotal < coupon.min_purchase:
        raise conflict(f"Este cupón aplica en compras desde ${coupon.min_purchase}.")
    applied = db.query(func.count()).select_from(CouponRedemption).filter(
        CouponRedemption.tenant_id == tenant_id,
        CouponRedemption.coupon_id == coupon.id,
        CouponRedemption.status == "applied",
    )
    if coupon.max_uses is not None and applied.scalar() >= coupon.max_uses:
        raise conflict("Este cupón ya alcanzó su límite de usos.")
    if coupon.max_uses_per_customer is not None:
        if customer_id is None:
            raise bad_request("Selecciona al cliente para usar este cupón.")
        used = applied.filter(CouponRedemption.customer_id == customer_id).scalar()
        if used >= coupon.max_uses_per_customer:
            raise conflict("Este cliente ya usó este cupón las veces permitidas.")
    if coupon.kind == "percent":
        discount = calculator.money(subtotal * coupon.value / Decimal(100))
    else:
        discount = min(coupon.value, subtotal)
    if discount <= 0:
        raise conflict("Este cupón no da descuento en esta venta.")
    return discount


def _subtotal(db: Session, *, tenant_id: UUID, order) -> Decimal:
    """Catalog subtotal of a cart, priced like a counter sale (price plus modifiers)."""
    products = {
        product.id: product
        for product in db.query(Product).filter(
            Product.tenant_id == tenant_id,
            Product.id.in_({item.product_id for item in order.items}),
            Product.is_active.is_(True),
        )
    }
    if len(products) != len({item.product_id for item in order.items}):
        raise not_found("Producto no encontrado")
    deltas = modifier_service.validate_and_price_modifiers_batch(
        db, tenant_id=tenant_id,
        lines=[(item.product_id, item.modifier_option_ids) for item in order.items],
    )
    return calculator.order_total([
        calculator.line_total(
            calculator.money(products[item.product_id].price_amount + delta), item.quantity
        )
        for item, (delta, _) in zip(order.items, deltas, strict=True)
    ])


def preview(db: Session, *, tenant_id: UUID, body: CouponPreview) -> dict:
    coupon = _find(db, tenant_id=tenant_id, code=body.code)
    subtotal = _subtotal(db, tenant_id=tenant_id, order=body.order)
    discount = discount_for(db, tenant_id=tenant_id, coupon=coupon, subtotal=subtotal,
                            customer_id=body.order.customer_id)
    uses = _uses(db, tenant_id=tenant_id, coupon_ids=[coupon.id]).get(coupon.id, 0)
    return {"coupon": _body(coupon, uses), "subtotal_amount": subtotal,
            "discount_amount": discount}


def checkout(db: Session, *, tenant_id: UUID, user_id: UUID, body: CouponCheckout, key: str):
    """One sale with the coupon's discount, its use recorded in the same transaction."""
    try:
        if not key or len(key) > 200 or not key.strip():
            raise bad_request("Idempotency-Key debe contener de 1 a 200 caracteres")
        digest = hashlib.sha256(f"coupon-checkout:{body.model_dump_json()}".encode()).hexdigest()
        replay = idempotency.claim(db, tenant_id=tenant_id, key=key, request_hash=digest)
        if replay:
            return replay.response_status, replay.response_body
        if body.order.discount_amount:
            raise bad_request("El cupón no se combina con otro descuento.")
        coupon = _find(db, tenant_id=tenant_id, code=body.code, lock=True)
        applied: dict[str, Decimal] = {}

        def resolve(subtotal: Decimal) -> Decimal:
            discount = discount_for(db, tenant_id=tenant_id, coupon=coupon, subtotal=subtotal,
                                    customer_id=body.order.customer_id)
            if discount != body.expected_discount:
                raise conflict("El descuento del cupón cambió. Revisa antes de cobrar.")
            applied["discount"] = discount
            return discount

        _, result = orders.create_order(
            db, tenant_id=tenant_id, user_id=user_id, body=body.order, idempotency_key=key,
            external_transaction=True, discount_resolver=resolve,
        )
        sale_id = UUID(result["id"])
        redemption = CouponRedemption(
            tenant_id=tenant_id, branch_id=UUID(result["branch_id"]), coupon_id=coupon.id,
            sale_order_id=sale_id, customer_id=body.order.customer_id, code=coupon.code,
            discount_amount=applied["discount"], created_by_user_id=user_id,
        )
        db.add(redemption)
        db.flush()
        result["coupon"] = {"code": coupon.code, "discount_amount": str(applied["discount"])}
        audit.log(db, action="coupons.redeem", tenant_id=tenant_id, user_id=user_id,
                  resource_type="coupon_redemption", resource_id=redemption.id,
                  changes={"order_id": str(sale_id), "code": coupon.code,
                           "discount_amount": str(applied["discount"])})
        idempotency.store(db, tenant_id=tenant_id, key=key, request_hash=digest,
                          response_status=201, response_body=result)
        db.commit()
        return 201, result
    except Exception:
        db.rollback()
        raise


def release_for_sale(db: Session, *, tenant_id: UUID, order_id: UUID) -> None:
    """A voided sale gives its coupon use back."""
    for redemption in db.query(CouponRedemption).filter(
        CouponRedemption.tenant_id == tenant_id,
        CouponRedemption.sale_order_id == order_id,
        CouponRedemption.status == "applied",
    ):
        redemption.status = "released"
        redemption.released_at = _now()


def order_coupon(db: Session, *, tenant_id: UUID, order_id: UUID) -> dict | None:
    row = (
        db.query(CouponRedemption)
        .filter(CouponRedemption.tenant_id == tenant_id, CouponRedemption.sale_order_id == order_id)
        .first()
    )
    return None if row is None else {"code": row.code, "discount_amount": str(row.discount_amount),
                                     "status": row.status}
