from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db
from app.modifiers import service
from app.modifiers.schemas import (
    ModifierGroupCreate,
    ModifierGroupResponse,
    ModifierGroupUpdate,
    ModifierOptionCreate,
    ModifierOptionResponse,
    ModifierOptionUpdate,
    SetProductModifierGroups,
)
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session, require_permission
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/catalog", tags=["modifiers"])


def _idempotency_key(
    value: str | None = Header(default=None, alias="Idempotency-Key"),
) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


@router.get("/modifier-groups", response_model=list[ModifierGroupResponse])
def list_modifier_groups(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
) -> list[ModifierGroupResponse]:
    _, membership, _ = ctx
    return service.list_modifier_groups(db, tenant_id=membership.tenant_id)


@router.post("/modifier-groups", response_model=ModifierGroupResponse, status_code=201)
def create_modifier_group(
    body: ModifierGroupCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_CREATE)
    ),
) -> ModifierGroupResponse:
    user, membership, _ = ctx
    status_code, result = service.create_modifier_group(
        db, tenant_id=membership.tenant_id, user_id=user.id,
        body=body, idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return result


@router.patch("/modifier-groups/{group_id}", response_model=ModifierGroupResponse)
def update_modifier_group(
    group_id: UUID,
    body: ModifierGroupUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_UPDATE)
    ),
) -> ModifierGroupResponse:
    user, membership, _ = ctx
    status_code, result = service.update_modifier_group(
        db, tenant_id=membership.tenant_id, user_id=user.id,
        group_id=group_id, body=body, idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return result


@router.delete("/modifier-groups/{group_id}", response_model=ModifierGroupResponse)
def deactivate_modifier_group(
    group_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_DELETE)
    ),
) -> ModifierGroupResponse:
    user, membership, _ = ctx
    status_code, result = service.deactivate_modifier_group(
        db, tenant_id=membership.tenant_id, user_id=user.id,
        group_id=group_id, idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return result


@router.post(
    "/modifier-groups/{group_id}/options",
    response_model=ModifierOptionResponse,
    status_code=201,
)
def create_modifier_option(
    group_id: UUID,
    body: ModifierOptionCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_CREATE)
    ),
) -> ModifierOptionResponse:
    user, membership, _ = ctx
    status_code, result = service.create_modifier_option(
        db, tenant_id=membership.tenant_id, user_id=user.id,
        group_id=group_id, body=body, idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return result


@router.patch(
    "/modifier-groups/{group_id}/options/{option_id}",
    response_model=ModifierOptionResponse,
)
def update_modifier_option(
    group_id: UUID,
    option_id: UUID,
    body: ModifierOptionUpdate,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_UPDATE)
    ),
) -> ModifierOptionResponse:
    user, membership, _ = ctx
    return service.update_modifier_option(
        db, tenant_id=membership.tenant_id, user_id=user.id,
        group_id=group_id, option_id=option_id, body=body,
    )


@router.delete(
    "/modifier-groups/{group_id}/options/{option_id}",
    response_model=ModifierOptionResponse,
)
def deactivate_modifier_option(
    group_id: UUID,
    option_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_DELETE)
    ),
) -> ModifierOptionResponse:
    user, membership, _ = ctx
    return service.deactivate_modifier_option(
        db, tenant_id=membership.tenant_id, user_id=user.id,
        group_id=group_id, option_id=option_id,
    )


@router.put(
    "/products/{product_id}/modifier-groups",
    response_model=list[ModifierGroupResponse],
)
def set_product_modifier_groups(
    product_id: UUID,
    body: SetProductModifierGroups,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_UPDATE)
    ),
) -> list[ModifierGroupResponse]:
    user, membership, _ = ctx
    return service.set_product_modifier_groups(
        db, tenant_id=membership.tenant_id, user_id=user.id,
        product_id=product_id, body=body,
    )


@router.get(
    "/products/{product_id}/modifier-groups",
    response_model=list[ModifierGroupResponse],
)
def get_product_modifier_groups(
    product_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
) -> list[ModifierGroupResponse]:
    _, membership, _ = ctx
    return service.get_product_modifier_groups(
        db, tenant_id=membership.tenant_id, product_id=product_id,
    )
