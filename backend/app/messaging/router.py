from fastapi import APIRouter, Depends

from app.crm.router import require_crm
from app.messaging.readiness import MessagingReadiness, readiness

router = APIRouter(prefix="/api/v1/messaging", tags=["messaging"])


@router.get("/readiness", response_model=MessagingReadiness)
def messaging_readiness(_ctx=Depends(require_crm)):
    return readiness()
