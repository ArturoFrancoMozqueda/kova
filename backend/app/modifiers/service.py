from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog.models import Product
from app.idempotency import service as idempotency_service
from app.modifiers.models import ModifierGroup, ModifierOption, ProductModifierGroup
from app.modifiers.schemas import (
    ModifierGroupCreate,
    ModifierGroupResponse,
    ModifierGroupUpdate,
    ModifierOptionCreate,
    ModifierOptionResponse,
    ModifierOptionUpdate,
    SetProductModifierGroups,
)
from app.shared.exceptions import bad_request, not_found

# ─── Modifier groups ─────────────────────────────────────────────────────────

def list_modifier_groups(db: Session, *, tenant_id: UUID) -> list[ModifierGroupResponse]:
    groups = (
        db.query(ModifierGroup)
        .filter(ModifierGroup.tenant_id == tenant_id)
        .order_by(ModifierGroup.sort_order, ModifierGroup.name)
        .all()
    )
    return [_group_response(db, group) for group in groups]


def create_modifier_group(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: ModifierGroupCreate,
    idempotency_key: str,
) -> tuple[int, ModifierGroupResponse]:
    existing = idempotency_service.get(db, tenant_id=tenant_id, key=idempotency_key)
    if existing:
        group = db.query(ModifierGroup).filter(
            ModifierGroup.tenant_id == tenant_id,
            ModifierGroup.name == body.name,
        ).first()
        return 200, _group_response(db, group) if group else (200, existing.response_body)

    group = ModifierGroup(
        id=uuid4(),
        tenant_id=tenant_id,
        name=body.name,
        is_required=body.is_required,
        min_selections=body.min_selections,
        max_selections=body.max_selections,
        sort_order=body.sort_order,
    )
    db.add(group)
    audit_service.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="catalog.modifier_group.create",
        resource_type="modifier_group",
        resource_id=group.id,
        changes={"name": body.name},
    )
    db.commit()
    db.refresh(group)
    response = _group_response(db, group)
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=idempotency_key,
        response_status=201,
        response_body=response.model_dump(mode="json"),
    )
    return 201, response


def update_modifier_group(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    group_id: UUID,
    body: ModifierGroupUpdate,
    idempotency_key: str,
) -> tuple[int, ModifierGroupResponse]:
    group = _get_group(db, tenant_id=tenant_id, group_id=group_id)
    changes: dict = {}
    for field in ("name", "is_required", "min_selections", "max_selections", "sort_order",
                  "is_active"):
        value = getattr(body, field)
        if value is not None:
            setattr(group, field, value)
            changes[field] = value
    if changes:
        audit_service.log(
            db, tenant_id=tenant_id, user_id=user_id,
            action="catalog.modifier_group.update",
            resource_type="modifier_group", resource_id=group.id, changes=changes,
        )
        db.commit()
        db.refresh(group)
    return 200, _group_response(db, group)


def deactivate_modifier_group(
    db: Session, *, tenant_id: UUID, user_id: UUID, group_id: UUID, idempotency_key: str
) -> tuple[int, ModifierGroupResponse]:
    group = _get_group(db, tenant_id=tenant_id, group_id=group_id)
    group.is_active = False
    audit_service.log(
        db, tenant_id=tenant_id, user_id=user_id,
        action="catalog.modifier_group.deactivate",
        resource_type="modifier_group", resource_id=group.id, changes={},
    )
    db.commit()
    db.refresh(group)
    return 200, _group_response(db, group)


# ─── Modifier options ─────────────────────────────────────────────────────────

def create_modifier_option(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    group_id: UUID,
    body: ModifierOptionCreate,
    idempotency_key: str,
) -> tuple[int, ModifierOptionResponse]:
    group = _get_group(db, tenant_id=tenant_id, group_id=group_id)
    option = ModifierOption(
        id=uuid4(),
        tenant_id=tenant_id,
        group_id=group.id,
        name=body.name,
        price_delta=body.price_delta,
        sort_order=body.sort_order,
    )
    db.add(option)
    audit_service.log(
        db, tenant_id=tenant_id, user_id=user_id,
        action="catalog.modifier_option.create",
        resource_type="modifier_option", resource_id=option.id,
        changes={"name": body.name, "price_delta": str(body.price_delta)},
    )
    db.commit()
    db.refresh(option)
    return 201, ModifierOptionResponse.model_validate(option)


def update_modifier_option(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    group_id: UUID,
    option_id: UUID,
    body: ModifierOptionUpdate,
) -> ModifierOptionResponse:
    option = _get_option(db, tenant_id=tenant_id, group_id=group_id, option_id=option_id)
    changes: dict = {}
    for field in ("name", "price_delta", "sort_order", "is_active"):
        value = getattr(body, field)
        if value is not None:
            setattr(option, field, value)
            changes[field] = str(value)
    if changes:
        audit_service.log(
            db, tenant_id=tenant_id, user_id=user_id,
            action="catalog.modifier_option.update",
            resource_type="modifier_option", resource_id=option.id, changes=changes,
        )
        db.commit()
        db.refresh(option)
    return ModifierOptionResponse.model_validate(option)


def deactivate_modifier_option(
    db: Session, *, tenant_id: UUID, user_id: UUID, group_id: UUID, option_id: UUID
) -> ModifierOptionResponse:
    option = _get_option(db, tenant_id=tenant_id, group_id=group_id, option_id=option_id)
    option.is_active = False
    audit_service.log(
        db, tenant_id=tenant_id, user_id=user_id,
        action="catalog.modifier_option.deactivate",
        resource_type="modifier_option", resource_id=option.id, changes={},
    )
    db.commit()
    db.refresh(option)
    return ModifierOptionResponse.model_validate(option)


# ─── Product-modifier group assignments ───────────────────────────────────────

def set_product_modifier_groups(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    body: SetProductModifierGroups,
) -> list[ModifierGroupResponse]:
    _get_product(db, tenant_id=tenant_id, product_id=product_id)

    # Validate all groups belong to tenant
    for assignment in body.assignments:
        _get_group(db, tenant_id=tenant_id, group_id=assignment.modifier_group_id)

    # Replace existing assignments
    db.query(ProductModifierGroup).filter(
        ProductModifierGroup.tenant_id == tenant_id,
        ProductModifierGroup.product_id == product_id
    ).delete()

    for assignment in body.assignments:
        db.add(ProductModifierGroup(
            id=uuid4(),
            tenant_id=tenant_id,
            product_id=product_id,
            modifier_group_id=assignment.modifier_group_id,
            sort_order=assignment.sort_order,
        ))

    audit_service.log(
        db, tenant_id=tenant_id, user_id=user_id,
        action="catalog.product.modifier_groups.set",
        resource_type="product", resource_id=product_id,
        changes={"group_ids": [str(a.modifier_group_id) for a in body.assignments]},
    )
    db.commit()
    return get_product_modifier_groups(db, tenant_id=tenant_id, product_id=product_id)


def get_product_modifier_groups(
    db: Session, *, tenant_id: UUID, product_id: UUID
) -> list[ModifierGroupResponse]:
    _get_product(db, tenant_id=tenant_id, product_id=product_id)
    assignments = (
        db.query(ProductModifierGroup)
        .filter(
            ProductModifierGroup.tenant_id == tenant_id,
            ProductModifierGroup.product_id == product_id,
        )
        .order_by(ProductModifierGroup.sort_order)
        .all()
    )
    groups = []
    for assignment in assignments:
        group = db.query(ModifierGroup).filter(
            ModifierGroup.id == assignment.modifier_group_id,
            ModifierGroup.tenant_id == tenant_id,
        ).first()
        if group and group.is_active:
            groups.append(_group_response(db, group))
    return groups


# ─── Order validation helper ──────────────────────────────────────────────────

def validate_and_price_modifiers(
    db: Session,
    *,
    tenant_id: UUID,
    product_id: UUID,
    modifier_option_ids: list[UUID],
) -> tuple[Decimal, list[dict]]:
    """
    Validate selected modifier options against product's modifier groups.
    Returns (total_price_delta, list of snapshot dicts for order_item_modifiers).
    Raises 400 on validation failure.
    """
    assignments = (
        db.query(ProductModifierGroup)
        .filter(
            ProductModifierGroup.tenant_id == tenant_id,
            ProductModifierGroup.product_id == product_id,
        )
        .order_by(ProductModifierGroup.sort_order)
        .all()
    )

    # Build map of group_id → selected options
    selected_by_group: dict[UUID, list[ModifierOption]] = {}
    option_map: dict[UUID, ModifierOption] = {}

    for opt_id in modifier_option_ids:
        option = db.query(ModifierOption).filter(
            ModifierOption.id == opt_id,
            ModifierOption.tenant_id == tenant_id,
            ModifierOption.is_active == True,  # noqa: E712
        ).first()
        if not option:
            raise bad_request(f"Modifier option {opt_id} not found")
        option_map[opt_id] = option
        selected_by_group.setdefault(option.group_id, []).append(option)

    total_delta = Decimal("0")
    snapshots: list[dict] = []

    for assignment in assignments:
        group = db.query(ModifierGroup).filter(
            ModifierGroup.id == assignment.modifier_group_id,
            ModifierGroup.tenant_id == tenant_id,
            ModifierGroup.is_active == True,  # noqa: E712
        ).first()
        if not group:
            continue

        selected = selected_by_group.get(group.id, [])
        count = len(selected)

        if group.is_required and count < group.min_selections:
            raise bad_request(
                f"Modifier group '{group.name}' requires at least "
                f"{group.min_selections} selection(s)"
            )
        if count > group.max_selections:
            raise bad_request(
                f"Modifier group '{group.name}' allows at most {group.max_selections} selection(s)"
            )

        for option in selected:
            if option.group_id != group.id:
                raise bad_request("Modifier option not valid for this product")
            total_delta += option.price_delta
            snapshots.append({
                "modifier_group_id": group.id,
                "modifier_group_name": group.name,
                "modifier_option_id": option.id,
                "modifier_option_name": option.name,
                "price_delta_amount": option.price_delta,
            })

    # Validate no option was for a group not assigned to this product
    assigned_group_ids = {a.modifier_group_id for a in assignments}
    for option in option_map.values():
        if option.group_id not in assigned_group_ids:
            raise bad_request("Modifier option not valid for this product")

    return total_delta, snapshots


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_group(db: Session, *, tenant_id: UUID, group_id: UUID) -> ModifierGroup:
    group = db.query(ModifierGroup).filter(
        ModifierGroup.id == group_id,
        ModifierGroup.tenant_id == tenant_id,
    ).first()
    if not group:
        raise not_found("Modifier group not found")
    return group


def _get_product(db: Session, *, tenant_id: UUID, product_id: UUID) -> Product:
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.tenant_id == tenant_id,
    ).first()
    if not product:
        raise not_found("Product not found")
    return product


def _get_option(
    db: Session, *, tenant_id: UUID, group_id: UUID, option_id: UUID
) -> ModifierOption:
    option = db.query(ModifierOption).filter(
        ModifierOption.id == option_id,
        ModifierOption.tenant_id == tenant_id,
        ModifierOption.group_id == group_id,
    ).first()
    if not option:
        raise not_found("Modifier option not found")
    return option


def _group_response(db: Session, group: ModifierGroup) -> ModifierGroupResponse:
    options = (
        db.query(ModifierOption)
        .filter(ModifierOption.group_id == group.id, ModifierOption.is_active == True)  # noqa: E712
        .order_by(ModifierOption.sort_order, ModifierOption.name)
        .all()
    )
    return ModifierGroupResponse(
        id=group.id,
        tenant_id=group.tenant_id,
        name=group.name,
        is_required=group.is_required,
        min_selections=group.min_selections,
        max_selections=group.max_selections,
        sort_order=group.sort_order,
        is_active=group.is_active,
        options=[ModifierOptionResponse.model_validate(o) for o in options],
    )
