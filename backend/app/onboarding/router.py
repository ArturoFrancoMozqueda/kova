from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db
from app.onboarding import service
from app.onboarding.schemas import (
    OnboardingStateResponse,
    PresetApplyRequest,
    PresetApplyResponse,
)
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session, require_permission

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


@router.get("/state", response_model=OnboardingStateResponse)
def get_state(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
) -> OnboardingStateResponse:
    _, membership, _ = ctx
    return OnboardingStateResponse(
        **service.get_onboarding_state(db, tenant_id=membership.tenant_id)
    )


@router.post("/apply-preset", response_model=PresetApplyResponse, status_code=200)
def apply_preset(
    body: PresetApplyRequest,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_CREATE)
    ),
) -> PresetApplyResponse:
    user, membership, _ = ctx
    result = service.apply_preset(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        preset_name=body.preset,
    )
    return PresetApplyResponse(**result)
