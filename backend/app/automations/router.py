from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.automations import service
from app.automations.schemas import (
    AutomationOverview,
    ProcessResponse,
    RuleResponse,
    RuleWrite,
    RunResolve,
    RunResponse,
    TemplateKey,
)
from app.billing.access import require_commercial_access
from app.db import get_db
from app.rbac.permissions import Permission

router = APIRouter(prefix="/api/v1/automations", tags=["automations"])
_access = require_commercial_access(Permission.SETTINGS_MANAGE)


@router.get("", response_model=AutomationOverview)
def overview(
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    return service.overview(db, tenant_id=ctx[1].tenant_id, limit=limit)


@router.put("/rules/{template_key}", response_model=RuleResponse)
def configure(
    template_key: TemplateKey,
    body: RuleWrite,
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    result = service.configure(
        db,
        tenant_id=ctx[1].tenant_id,
        user_id=ctx[0].id,
        template_key=template_key,
        enabled=body.enabled,
        expected_version=body.expected_version,
    )
    db.commit()
    return result


@router.post("/process", response_model=ProcessResponse)
def process(db: Session = Depends(get_db), ctx=Depends(_access)):
    result = service.process_pending(db, tenant_id=ctx[1].tenant_id)
    db.commit()
    return result


@router.post("/runs/{run_id}/resolve", response_model=RunResponse)
def resolve(
    run_id: UUID,
    body: RunResolve,
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    result = service.resolve(
        db,
        tenant_id=ctx[1].tenant_id,
        user_id=ctx[0].id,
        run_id=run_id,
        expected_version=body.expected_version,
        status=body.status,
    )
    db.commit()
    return result
