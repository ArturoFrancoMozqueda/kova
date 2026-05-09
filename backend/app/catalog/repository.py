from uuid import UUID

from sqlalchemy.orm import Session

from app.catalog.models import Category, Product


def list_categories(
    db: Session, *, tenant_id: UUID, include_inactive: bool = False
) -> list[Category]:
    query = db.query(Category).filter(Category.tenant_id == tenant_id)
    if not include_inactive:
        query = query.filter(Category.is_active.is_(True))
    return query.order_by(Category.sort_order, Category.name).all()


def get_category(db: Session, *, tenant_id: UUID, category_id: UUID) -> Category | None:
    return (
        db.query(Category)
        .filter(Category.tenant_id == tenant_id, Category.id == category_id)
        .first()
    )


def get_category_by_name(db: Session, *, tenant_id: UUID, name: str) -> Category | None:
    return (
        db.query(Category)
        .filter(Category.tenant_id == tenant_id, Category.name == name)
        .first()
    )


def create_category(
    db: Session,
    *,
    tenant_id: UUID,
    name: str,
    description: str | None,
    sort_order: int,
) -> Category:
    category = Category(
        tenant_id=tenant_id,
        name=name,
        description=description,
        sort_order=sort_order,
    )
    db.add(category)
    db.flush()
    return category


def list_products(db: Session, *, tenant_id: UUID, include_inactive: bool = False) -> list[Product]:
    query = db.query(Product).filter(Product.tenant_id == tenant_id)
    if not include_inactive:
        query = query.filter(Product.is_active.is_(True))
    return query.order_by(Product.name).all()


def get_product(db: Session, *, tenant_id: UUID, product_id: UUID) -> Product | None:
    return (
        db.query(Product)
        .filter(Product.tenant_id == tenant_id, Product.id == product_id)
        .first()
    )


def get_product_by_sku(db: Session, *, tenant_id: UUID, sku: str) -> Product | None:
    return db.query(Product).filter(Product.tenant_id == tenant_id, Product.sku == sku).first()


def create_product(db: Session, *, tenant_id: UUID, **values: object) -> Product:
    product = Product(tenant_id=tenant_id, **values)
    db.add(product)
    db.flush()
    return product
