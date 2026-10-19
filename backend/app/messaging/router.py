from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.crm.router import require_crm
from app.db import get_db
from app.messaging import service
from app.messaging.readiness import MessagingReadiness, readiness
from app.messaging.schemas import (
    AutomationDraftCreate,
    ConversationCreate,
    ConversationList,
    ConversationResponse,
    ConversationUpdate,
    MessageCreate,
    MessageList,
    MessageResponse,
    MessageTransition,
)

router = APIRouter(prefix="/api/v1/messaging", tags=["messaging"])


@router.get("/readiness", response_model=MessagingReadiness)
def messaging_readiness(_ctx=Depends(require_crm)):
    return readiness()


@router.get("/conversations", response_model=ConversationList)
def list_conversations(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.conversations(db, ctx[1].tenant_id, limit=limit, offset=offset)


@router.post("/conversations", response_model=ConversationResponse, status_code=201)
def create_conversation(
    body: ConversationCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.create_conversation(db, ctx[1].tenant_id, ctx[0].id, body, key)
    response.status_code = status
    return result


@router.patch("/conversations/{conversation_id}", response_model=ConversationResponse)
def update_conversation(
    conversation_id: UUID,
    body: ConversationUpdate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.update_conversation(
        db, ctx[1].tenant_id, ctx[0].id, conversation_id, body, key
    )
    response.status_code = status
    return result


@router.get("/conversations/{conversation_id}/messages", response_model=MessageList)
def list_messages(
    conversation_id: UUID,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.messages(db, ctx[1].tenant_id, conversation_id, limit=limit, offset=offset)


@router.post(
    "/conversations/{conversation_id}/messages", response_model=MessageResponse, status_code=201
)
def create_message(
    conversation_id: UUID,
    body: MessageCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.create_message(
        db, ctx[1].tenant_id, ctx[0].id, conversation_id, body, key
    )
    response.status_code = status
    return result


@router.post("/messages/{message_id}/transition", response_model=MessageResponse)
def transition_message(
    message_id: UUID,
    body: MessageTransition,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.transition_message(
        db, ctx[1].tenant_id, ctx[0].id, message_id, body, key
    )
    response.status_code = status
    return result


@router.post("/drafts/from-automation", response_model=MessageResponse, status_code=201)
def draft_from_automation(
    body: AutomationDraftCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.draft_from_automation(db, ctx[1].tenant_id, ctx[0].id, body, key)
    response.status_code = status
    return result
