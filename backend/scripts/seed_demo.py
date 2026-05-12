#!/usr/bin/env python3
"""
Seed a demo tenant with a bakery catalog for local development and demos.

Usage:
    uv run python scripts/seed_demo.py

The script is idempotent — running it twice won't create duplicate records.
It prints credentials so you can log in right away.
"""
import sys
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.auth.models import Membership, User
from app.auth.service import hash_password
from app.catalog.models import Category, Product
from app.config import settings
from app.tenants.models import Tenant

DEMO_EMAIL = "demo@bakery.local"
DEMO_PASSWORD = "demo1234"
TENANT_SLUG = "demo-bakery"

CATEGORIES = [
    ("Panes", "Pan artesanal y de caja"),
    ("Pasteles", "Pasteles de cumpleaños, bodas y celebraciones"),
    ("Galletas", "Galletas decoradas y sencillas"),
    ("Bebidas", "Café, té y atole"),
    ("Especiales", "Productos de temporada y edición limitada"),
]

PRODUCTS = [
    # (name, category_index, price, sku, description)
    ("Pan de caja integral", 0, Decimal("35.00"), "PAN-001", "Pan integral rebanado 680 g"),
    ("Baguette artesanal", 0, Decimal("42.00"), "PAN-002", "Baguette crujiente horneada"),
    ("Pastel de chocolate 1 kg", 1, Decimal("380.00"), "PAS-001", "Pastel húmedo con ganache"),
    ("Pastel de vainilla 1 kg", 1, Decimal("350.00"), "PAS-002", "Pastel esponjoso con betún"),
    ("Galleta de avena con pasas", 2, Decimal("18.00"), "GAL-001", "Galleta grande con avena"),
    ("Galleta decorada", 2, Decimal("25.00"), "GAL-002", "Galleta de mantequilla artesanal"),
    ("Café americano", 3, Decimal("35.00"), "BEB-001", "Café de grano tostado artesanal"),
    ("Atole de guayaba", 3, Decimal("28.00"), "BEB-002", "Atole tradicional 355 ml"),
    ("Pan de muerto", 4, Decimal("55.00"), "ESP-001", "Pan de muerto con anís — temporada"),
    ("Rosca de reyes (porción)", 4, Decimal("45.00"), "ESP-002", "Porción individual de rosca"),
]


def main() -> None:
    engine = create_engine(settings.database_url, echo=False)

    with Session(engine) as db:
        existing = db.query(Tenant).filter(Tenant.slug == TENANT_SLUG).first()
        if existing:
            print(f"Demo tenant '{TENANT_SLUG}' already exists — skipping.")
            print(f"  Login: {DEMO_EMAIL} / {DEMO_PASSWORD}")
            return

        now = datetime.now(UTC)

        tenant = Tenant(
            id=uuid4(),
            name="Panadería Demo",
            slug=TENANT_SLUG,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(tenant)
        db.flush()

        user = User(
            id=uuid4(),
            email=DEMO_EMAIL,
            hashed_password=hash_password(DEMO_PASSWORD),
            is_email_verified=True,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        db.flush()

        membership = Membership(
            id=uuid4(),
            tenant_id=tenant.id,
            user_id=user.id,
            role="owner",
            is_active=True,
            created_at=now,
        )
        db.add(membership)
        db.flush()

        category_ids = []
        for i, (name, description) in enumerate(CATEGORIES):
            cat = Category(
                id=uuid4(),
                tenant_id=tenant.id,
                name=name,
                description=description,
                sort_order=i,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(cat)
            db.flush()
            category_ids.append(cat.id)

        for name, cat_idx, price, sku, description in PRODUCTS:
            product = Product(
                id=uuid4(),
                tenant_id=tenant.id,
                category_id=category_ids[cat_idx],
                name=name,
                description=description,
                sku=sku,
                price_amount=price,
                track_inventory=False,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(product)

        db.commit()

    print("Demo tenant seeded successfully.")
    print(f"  Tenant:  Panadería Demo  (slug: {TENANT_SLUG})")
    print(f"  Login:   {DEMO_EMAIL}")
    print(f"  Password:{DEMO_PASSWORD}")
    print("  Role:    owner")
    print(f"  Categories: {len(CATEGORIES)}")
    print(f"  Products:   {len(PRODUCTS)}")


if __name__ == "__main__":
    main()
