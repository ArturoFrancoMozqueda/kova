from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.rbac.permissions import Permission, has_permission
from app.recipes import production, service
from app.recipes.schemas import (
    BatchRecipeResponse,
    BatchRecipeWrite,
    OptionConsumptionResponse,
    OptionConsumptionWrite,
    ProductionCreate,
    ProductionResponse,
    RecipeResponse,
    RecipeWrite,
)
from app.shared.dependencies import get_current_session
from app.shared.exceptions import bad_request, forbidden

router = APIRouter(tags=["recipes"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value or len(value) > 200:
        raise bad_request("Idempotency-Key es obligatorio y debe tener hasta 200 caracteres")
    return value


def _require_cost_view(membership: Membership) -> None:
    # Recipes reveal ingredient costs; the catalog only shows costs to editors.
    if not has_permission(membership.role, Permission.CATALOG_UPDATE):
        raise forbidden("No tienes permiso para ver recetas y costos")


@router.get("/api/v1/catalog/products/{product_id}/recipe", response_model=RecipeResponse)
def get_recipe(
    product_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _require_cost_view(ctx[1])
    return service.recipe_body(db, tenant_id=ctx[1].tenant_id, product_id=product_id)


@router.put("/api/v1/catalog/products/{product_id}/recipe", response_model=RecipeResponse)
def put_recipe(
    product_id: UUID,
    body: RecipeWrite,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.CATALOG_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, body_out = service.save_recipe(
        db, tenant_id=membership.tenant_id, user_id=user.id, product_id=product_id,
        body=body, idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return body_out


@router.get(
    "/api/v1/catalog/modifier-options/{option_id}/consumption",
    response_model=OptionConsumptionResponse,
)
def get_option_consumption(
    option_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _require_cost_view(ctx[1])
    return service.option_body(db, tenant_id=ctx[1].tenant_id, option_id=option_id)


@router.put(
    "/api/v1/catalog/modifier-options/{option_id}/consumption",
    response_model=OptionConsumptionResponse,
)
def put_option_consumption(
    option_id: UUID,
    body: OptionConsumptionWrite,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.CATALOG_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, body_out = service.save_option_consumption(
        db, tenant_id=membership.tenant_id, user_id=user.id, option_id=option_id,
        body=body, idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return body_out


@router.get(
    "/api/v1/catalog/products/{product_id}/batch-recipe", response_model=BatchRecipeResponse
)
def get_batch_recipe(
    product_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _require_cost_view(ctx[1])
    return production.batch_recipe_body(db, tenant_id=ctx[1].tenant_id, product_id=product_id)


@router.put(
    "/api/v1/catalog/products/{product_id}/batch-recipe", response_model=BatchRecipeResponse
)
def put_batch_recipe(
    product_id: UUID,
    body: BatchRecipeWrite,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.CATALOG_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, body_out = production.save_batch_recipe(
        db, tenant_id=membership.tenant_id, user_id=user.id, product_id=product_id,
        body=body, idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return body_out


@router.get("/api/v1/inventory/production", response_model=list[ProductionResponse])
def list_production(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    if not has_permission(ctx[1].role, Permission.INVENTORY_ADJUST):
        raise forbidden("No tienes permiso para ver la producción")
    return production.list_batches(db, tenant_id=ctx[1].tenant_id)


@router.post("/api/v1/inventory/production", response_model=ProductionResponse, status_code=201)
def create_production(
    body: ProductionCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.INVENTORY_ADJUST)
    ),
):
    user, membership, _ = ctx
    status_code, body_out = production.produce(
        db, tenant_id=membership.tenant_id, user_id=user.id, body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return body_out
