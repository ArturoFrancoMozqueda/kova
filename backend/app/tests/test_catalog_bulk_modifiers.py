from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event

from app.catalog.models import Product
from app.modifiers import service
from app.modifiers.models import ModifierGroup, ModifierOption, ProductModifierGroup
from app.tenants.models import Tenant
from app.tests.test_catalog import _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


@pytest.mark.parametrize("product_count", [1, 20])
def test_catalog_bulk_modifiers_preserve_order_active_filters_and_tenant_scope(
    client, db, product_count, monkeypatch
):
    signup = _signup_verify_login(client, "bulk-catalog@example.com", "Bulk catalog")
    tenant_id = UUID(signup["tenant_id"])
    other = Tenant(name="Other business", slug=str(uuid4()))
    db.add(other)
    db.flush()
    products = [Product(tenant_id=tenant_id, name=f"Product {i:02}", price_amount=Decimal("10"))
                for i in range(product_count)]
    foreign_product = Product(tenant_id=other.id, name="Foreign", price_amount=Decimal("20"))
    shared = ModifierGroup(tenant_id=tenant_id, name="Shared", sort_order=1)
    empty = ModifierGroup(tenant_id=tenant_id, name="Empty", sort_order=20)
    inactive = ModifierGroup(tenant_id=tenant_id, name="Inactive", is_active=False)
    foreign = ModifierGroup(tenant_id=other.id, name="Foreign")
    db.add_all([*products, foreign_product, shared, empty, inactive, foreign])
    db.flush()
    db.add_all([
        ModifierOption(tenant_id=tenant_id, group_id=shared.id, name="Z", sort_order=0),
        ModifierOption(tenant_id=tenant_id, group_id=shared.id, name="A", sort_order=0),
        ModifierOption(tenant_id=tenant_id, group_id=shared.id, name="Hidden", is_active=False),
        ModifierOption(tenant_id=other.id, group_id=foreign.id, name="Foreign"),
        ProductModifierGroup(tenant_id=other.id, product_id=foreign_product.id,
                             modifier_group_id=foreign.id),
    ])
    for product in products:
        for order, group in enumerate([empty, shared, inactive]):
            db.add(ProductModifierGroup(tenant_id=tenant_id, product_id=product.id,
                                        modifier_group_id=group.id, sort_order=order))
    db.flush()
    expected = {product.id: service.get_product_modifier_groups(
        db, tenant_id=tenant_id, product_id=product.id
    ) for product in products}
    product_ids = [product.id for product in products]
    foreign_id = foreign_product.id
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        actual = service.get_products_modifier_groups(
            db, tenant_id=tenant_id, product_ids=[*product_ids, foreign_id]
        )
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert len(statements) == 2
    assert actual == expected
    assert foreign_id not in actual
    assert [group.name for group in actual[product_ids[0]]] == ["Empty", "Shared"]
    assert [option.name for option in actual[product_ids[0]][1].options] == ["A", "Z"]

    def reject_per_product_read(*args, **kwargs):
        raise AssertionError("Catalog used a per-product modifier query")

    monkeypatch.setattr(service, "get_product_modifier_groups", reject_per_product_read)
    response = client.get("/api/v1/catalog/products")
    assert response.status_code == 200
    assert len(response.json()) == product_count
    for product in response.json():
        assert product["modifier_groups"] == [
            group.model_dump(mode="json") for group in expected[UUID(product["id"])]]


def test_empty_catalog_does_not_query_modifier_tables(db):
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        assert service.get_products_modifier_groups(db, tenant_id=uuid4(), product_ids=[]) == {}
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert statements == []
