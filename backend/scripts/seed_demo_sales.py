#!/usr/bin/env python3
"""Seed the demo bakery tenant with realistic sales, shifts and inventory.

This is what makes the marketing-showcase screens (POS, Inventario, Caja, Panel)
look full instead of empty: it adds tracked stock, a second cashier, an open
shift with cash movements, a closed shift from "yesterday", a couple dozen
orders across the day with mixed payment methods, and one refund.

It builds everything through the real domain services (orders/shifts/refunds),
then backdates timestamps so the reports spread across hours and days.

Idempotent: if the demo tenant already has orders, it exits without adding more.
Runs the catalog seed (scripts/seed_demo.py) first if the tenant doesn't exist.

Usage (inside the backend container or env):
    uv run python scripts/seed_demo.py        # catalog (idempotent)
    uv run python scripts/seed_demo_sales.py  # this script
"""
import sys
import urllib.request
from datetime import UTC, datetime, timedelta
from decimal import ROUND_CEILING, Decimal
from io import BytesIO
from pathlib import Path
from uuid import uuid4

sys.path.append(str(Path(__file__).resolve().parents[1]))

import seed_demo
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.auth.models import Membership, User
from app.auth.service import hash_password
from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.catalog.models import Product, ProductImageFile
from app.config import settings
from app.inventory import repository as inventory_repo
from app.orders import service as orders_service
from app.orders.models import InventoryMovement, Order, Payment
from app.orders.schemas import (
    OrderCreate,
    OrderItemCreate,
    PaymentCreate,
    RefundCreate,
    RefundItemCreate,
)
from app.shifts import calculator as shift_calc
from app.shifts import repository as shifts_repo
from app.shifts import service as shifts_service
from app.shifts.models import CashMovement, Shift
from app.shifts.schemas import CashMovementCreate, ShiftCloseCreate, ShiftOpenCreate
from app.tenants.models import Tenant

CASHIER_EMAIL = "sofia@bakery.local"

# Per-SKU starting stock + low-stock threshold. A few perishables are left thin
# so the "productos que necesitan atención" banner has something to show.
STOCK = {
    "PAN-001": (40, 12),
    "PAN-002": (30, 10),
    "PAS-001": (8, 4),
    "PAS-002": (6, 4),
    "GAL-001": (120, 30),
    "GAL-002": (90, 24),
    "BEB-001": (60, 15),
    "BEB-002": (45, 12),
    "ESP-001": (10, 6),
    "ESP-002": (14, 6),
}

# Order baskets (sku, qty). Cheaper items recur more, like a real café day.
RECIPES = [
    [("BEB-001", 2), ("GAL-001", 3)],
    [("PAN-002", 1), ("BEB-002", 1)],
    [("PAS-001", 1)],
    [("GAL-002", 4)],
    [("BEB-001", 1), ("PAN-001", 1), ("GAL-001", 2)],
    [("ESP-001", 1), ("BEB-002", 2)],
    [("PAS-002", 1), ("BEB-001", 2)],
    [("PAN-001", 2)],
    [("ESP-002", 1), ("GAL-002", 2)],
    [("BEB-002", 1), ("GAL-001", 1)],
]
# cash dominates, with transfers and card mixed in (index → method).
METHODS = ["cash", "cash", "bank_transfer", "cash", "manual_card",
           "cash", "cash", "manual_card", "bank_transfer", "cash"]

# Per-SKU photo keywords (real bakery photos fetched by keyword). The marketing
# showcase looks far better with product photos than placeholder icons.
IMAGE_KEYWORDS = {
    "PAN-001": "bread,loaf",
    "PAN-002": "baguette,bread",
    "PAS-001": "chocolate,cake",
    "PAS-002": "vanilla,cake",
    "GAL-001": "oatmeal,cookie",
    "GAL-002": "cookie,biscuit",
    "BEB-001": "coffee,cup",
    "BEB-002": "hot,chocolate,drink",
    "ESP-001": "sweet,bread,pastry",
    "ESP-002": "pastry,bun",
}


def _fetch_photo(keywords: str, lock: int) -> bytes | None:
    """Download a real photo for the given keywords, or None if offline."""
    url = f"https://loremflickr.com/640/480/{keywords}?lock={lock}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "kova-seed"})
        with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 (trusted URL)
            data = resp.read()
        return data if data and len(data) < 1_000_000 else None
    except Exception:
        return None


def _generated_tile(label: str, index: int) -> tuple[bytes, str]:
    """Fallback: a warm gradient tile with the product name (needs no network)."""
    from PIL import Image, ImageDraw

    w, h = 640, 480
    palettes = [
        ((247, 224, 198), (214, 162, 116)),
        ((236, 213, 226), (190, 142, 170)),
        ((214, 230, 245), (140, 178, 214)),
        ((226, 240, 219), (150, 196, 142)),
    ]
    top, bottom = palettes[index % len(palettes)]
    img = Image.new("RGB", (w, h), top)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        draw.line(
            [(0, y), (w, y)],
            fill=tuple(int(top[c] + (bottom[c] - top[c]) * t) for c in range(3)),
        )
    draw.text((28, h - 56), label, fill=(60, 40, 30))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), "image/png"


def _seed_product_images(db: Session, *, tenant_id, products: dict) -> int:
    """Attach a photo to each product that doesn't have one yet (idempotent)."""
    seeded = 0
    for index, (sku, product) in enumerate(sorted(products.items())):
        exists = (
            db.query(ProductImageFile)
            .filter(ProductImageFile.product_id == product.id)
            .first()
        )
        if exists is not None:
            continue
        keywords = IMAGE_KEYWORDS.get(sku, "bakery,food")
        data = _fetch_photo(keywords, lock=index + 1)
        content_type = "image/jpeg"
        if data is None:
            data, content_type = _generated_tile(product.name, index)
        now = datetime.now(UTC)
        db.add(ProductImageFile(
            id=uuid4(), tenant_id=tenant_id, product_id=product.id,
            content_type=content_type, bytes_data=data, byte_size=len(data),
            created_at=now, updated_at=now,
        ))
        product.image_url = f"/api/v1/catalog/products/{product.id}/image?v={int(now.timestamp())}"
        product.updated_at = now
        db.flush()
        seeded += 1
    return seeded


def _ceil_50(total: Decimal) -> Decimal:
    """Round a cash amount up to the next $50 bill for a realistic 'tendered'."""
    fifties = (total / Decimal(50)).to_integral_value(rounding=ROUND_CEILING)
    return max(total, fifties * Decimal(50))


def _backdate_order(db: Session, *, order_id, when: datetime) -> None:
    order = db.get(Order, order_id)
    if order is not None:
        order.created_at = when
        order.updated_at = when
    for p in db.query(Payment).filter(Payment.order_id == order_id).all():
        p.created_at = when
    for m in db.query(InventoryMovement).filter(InventoryMovement.order_id == order_id).all():
        m.created_at = when
    db.flush()


def _backdate_shift(db: Session, *, shift_id, opened: datetime, closed: datetime | None) -> None:
    shift = db.get(Shift, shift_id)
    if shift is not None:
        shift.opened_at = opened
        if closed is not None:
            shift.closed_at = closed
    db.flush()


def _build_payments(method: str, total: Decimal) -> list[PaymentCreate]:
    if method == "split":
        half = (total / 2).quantize(Decimal("0.01"))
        return [
            PaymentCreate(method="cash", amount=half, amount_tendered=half),
            PaymentCreate(method="manual_card", amount=total - half),
        ]
    if method == "cash":
        return [PaymentCreate(method="cash", amount=total, amount_tendered=_ceil_50(total))]
    return [PaymentCreate(method=method, amount=total, reference="DEMO-REF")]


def main() -> None:
    # 1. Ensure the catalog tenant exists (idempotent).
    seed_demo.main()

    engine = create_engine(settings.database_url, echo=False)
    with Session(engine) as db:
        tenant = db.query(Tenant).filter(Tenant.slug == seed_demo.TENANT_SLUG).first()
        if tenant is None:
            print("Demo tenant missing after catalog seed — aborting.")
            return

        # Business profile + receipt so the dashboard onboarding checklist is
        # complete (a real, set-up business shouldn't show a setup checklist).
        # Done before the idempotency guard so re-runs can backfill them.
        if db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first() is None:
            db.add(BusinessProfile(
                tenant_id=tenant.id, public_name="Panadería Demo",
                support_email="hola@kovademo.com", support_phone="55 1234 5678",
                timezone="America/Mexico_City", locale="es-MX", currency="MXN",
            ))
        if db.query(ReceiptSettings).filter(ReceiptSettings.tenant_id == tenant.id).first() is None:
            db.add(ReceiptSettings(
                tenant_id=tenant.id, receipt_business_name="Panadería Demo",
                footer="¡Gracias por tu compra! Síguenos @panaderiademo",
            ))
        db.commit()

        # Product photos so the POS catalog shows real images, not placeholder
        # icons. Idempotent + before the guard so re-runs backfill them.
        catalog = {
            p.sku: p
            for p in db.query(Product).filter(Product.tenant_id == tenant.id).all()
            if p.sku
        }
        image_count = _seed_product_images(db, tenant_id=tenant.id, products=catalog)
        db.commit()
        if image_count:
            print(f"  Seeded {image_count} product photos.")

        # 2. Idempotency: bail if this tenant already has orders.
        if db.query(Order).filter(Order.tenant_id == tenant.id).first() is not None:
            print(f"Demo tenant '{tenant.slug}' already has sales — skipping.")
            return

        owner = db.query(User).filter(User.email == seed_demo.DEMO_EMAIL).one()
        products = {
            p.sku: p
            for p in db.query(Product).filter(Product.tenant_id == tenant.id).all()
            if p.sku
        }
        price = {sku: p.price_amount for sku, p in products.items()}

        # 3. Second employee (cashier) for employee ranking.
        cashier = db.query(User).filter(User.email == CASHIER_EMAIL).first()
        if cashier is None:
            now = datetime.now(UTC)
            cashier = User(
                id=uuid4(), email=CASHIER_EMAIL, hashed_password=hash_password("demo1234"),
                is_email_verified=True, is_active=True, created_at=now, updated_at=now,
            )
            db.add(cashier)
            db.flush()
            db.add(Membership(
                id=uuid4(), tenant_id=tenant.id, user_id=cashier.id,
                role="cashier", is_active=True, created_at=now,
            ))
            db.flush()

        # 4. Enable inventory tracking + seed opening stock (backdated ~2 days).
        stock_time = datetime.now(UTC) - timedelta(days=2)
        for sku, (qty, threshold) in STOCK.items():
            product = products.get(sku)
            if product is None:
                continue
            product.track_inventory = True
            product.low_stock_threshold = threshold
            db.add(product)
            db.flush()
            movement = inventory_repo.create_movement(
                db, tenant_id=tenant.id, product_id=product.id, user_id=owner.id,
                movement_type="adjustment", quantity_delta=qty, reason="Inventario inicial",
            )
            movement.created_at = stock_time
        db.commit()

        now = datetime.now(UTC)
        staff = [owner.id, cashier.id]
        seq = 0  # global idempotency-key counter

        def ring(recipe, method, when, user_id):
            nonlocal seq
            seq += 1
            total = sum(price[sku] * qty for sku, qty in recipe)
            items = [
                OrderItemCreate(product_id=products[sku].id, quantity=qty)
                for sku, qty in recipe
            ]
            _, body = orders_service.create_order(
                db, tenant_id=tenant.id, user_id=user_id,
                body=OrderCreate(items=items, payments=_build_payments(method, total)),
                idempotency_key=f"seed-order-{seq}",
            )
            _backdate_order(db, order_id=body["id"], when=when)
            db.commit()
            return body

        # 5. "Yesterday": a closed shift with eight orders.
        y_open = now - timedelta(hours=31)
        _, y_shift = shifts_service.open_shift(
            db, tenant_id=tenant.id, user_id=owner.id,
            body=ShiftOpenCreate(opening_cash_amount=Decimal("500.00")),
            idempotency_key="seed-shift-yesterday",
        )
        y_shift_id = y_shift["id"]
        for i in range(8):
            ring(RECIPES[i % len(RECIPES)], METHODS[i % len(METHODS)],
                 now - timedelta(hours=30 - i * 0.7), staff[i % 2])
        # Close balanced: hand back exactly the expected drawer.
        expected = shift_calc.calculate_expected_cash(db, tenant_id=tenant.id, shift_id=y_shift_id)
        shifts_service.close_shift(
            db, tenant_id=tenant.id, user_id=owner.id, shift_id=y_shift_id,
            body=ShiftCloseCreate(actual_cash_amount=expected),
            idempotency_key="seed-close-yesterday",
        )
        _backdate_shift(db, shift_id=y_shift_id, opened=y_open, closed=now - timedelta(hours=24.5))
        db.commit()

        # 6. "Today": an open shift with sixteen orders across the last ~7 hours.
        t_open = now - timedelta(hours=7, minutes=30)
        _, t_shift = shifts_service.open_shift(
            db, tenant_id=tenant.id, user_id=owner.id,
            body=ShiftOpenCreate(opening_cash_amount=Decimal("500.00")),
            idempotency_key="seed-shift-today",
        )
        t_shift_id = t_shift["id"]
        # Backdate the opening so it precedes today's first sale.
        _backdate_shift(db, shift_id=t_shift_id, opened=t_open, closed=None)
        for m in shifts_repo.list_cash_movements(db, shift_id=t_shift_id):
            m.created_at = t_open
        db.commit()

        today_offsets = [7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.75, 0.5, 0.25]
        today_methods = ["cash", "cash", "bank_transfer", "cash", "split", "cash",
                         "manual_card", "cash", "cash", "bank_transfer", "cash",
                         "manual_card", "cash", "cash", "split", "cash"]
        first_order = None
        for i, hours_ago in enumerate(today_offsets):
            body = ring(RECIPES[i % len(RECIPES)], today_methods[i],
                        now - timedelta(hours=hours_ago), staff[i % 2])
            if first_order is None:
                first_order = body

        # Cash movements on the open drawer.
        for mv_type, amount, reason, hrs in [
            ("cash_in", Decimal("200.00"), "Fondo adicional", 5),
            ("cash_out", Decimal("150.00"), "Compra de leche", 3),
        ]:
            _, mv = shifts_service.record_cash_movement(
                db, tenant_id=tenant.id, user_id=owner.id, shift_id=t_shift_id,
                body=CashMovementCreate(type=mv_type, amount=amount, reason=reason),
            )
            moved = db.get(CashMovement, mv["id"])
            if moved is not None:
                moved.created_at = now - timedelta(hours=hrs)
        db.commit()

        # 7. One refund (customer return) on today's first order.
        if first_order is not None:
            orders_service.create_refund(
                db, tenant_id=tenant.id, user_id=owner.id, order_id=first_order["id"],
                body=RefundCreate(
                    items=[
                        RefundItemCreate(
                            order_item_id=first_order["items"][0]["id"],
                            quantity=1,
                        )
                    ],
                    reason="customer_return", refund_payment_method="cash",
                ),
                idempotency_key="seed-refund-today",
            )
            db.commit()

        order_count = db.query(Order).filter(Order.tenant_id == tenant.id).count()

    print("Demo sales seeded successfully.")
    print(f"  Tenant:  {tenant.name} (slug: {seed_demo.TENANT_SLUG})")
    print(f"  Orders:  {order_count}")
    print(f"  Login:   {seed_demo.DEMO_EMAIL} / {seed_demo.DEMO_PASSWORD}")
    print("  Open shift with cash movements + one closed shift (yesterday).")


if __name__ == "__main__":
    main()
