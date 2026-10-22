from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.crm.router import require_crm
from app.db import get_db
from app.operations_queue.schemas import OperationsQueueResponse
from app.operations_queue.service import read_queue

router = APIRouter(prefix="/api/v1/operations", tags=["operations-queue"])


@router.get("/queue", response_model=OperationsQueueResponse)
def queue(db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return read_queue(db, tenant_id=ctx[1].tenant_id)
