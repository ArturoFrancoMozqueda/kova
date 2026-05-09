from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.catalog import service
from app.catalog.schemas import (
    CategoryCreate,
    CategoryResponse,
    CategoryUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
)
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session, require_permission
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


@router.get("/categories", response_model=list[CategoryResponse])
def list_categories(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.list_categories(db, tenant_id=membership.tenant_id)


@router.post("/categories", response_model=CategoryResponse, status_code=201)
def create_category(
    body: CategoryCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_CREATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_category(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.patch("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: UUID,
    body: CategoryUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.update_category(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        category_id=category_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.delete("/categories/{category_id}", response_model=CategoryResponse)
def deactivate_category(
    category_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_DELETE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.deactivate_category(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        category_id=category_id,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.get("/products", response_model=list[ProductResponse])
def list_products(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.list_products(db, tenant_id=membership.tenant_id)


@router.post("/products", response_model=ProductResponse, status_code=201)
def create_product(
    body: ProductCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_CREATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_product(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.patch("/products/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: UUID,
    body: ProductUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.update_product(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        product_id=product_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.delete("/products/{product_id}", response_model=ProductResponse)
def deactivate_product(
    product_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_DELETE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.deactivate_product(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        product_id=product_id,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body
