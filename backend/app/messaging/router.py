from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.branches.scope import active_branch_id
from app.config import settings
from app.crm.router import require_crm
from app.db import get_db, get_privileged_db
from app.messaging import connections, delivery, onboarding, service
from app.messaging.readiness import MessagingReadiness, readiness
from app.messaging.schemas import (
    InboxAutomationDraftCreate,
    InboxCatalogDraft,
    InboxConnectionStatus,
    InboxConversationCreate,
    InboxConversationList,
    InboxConversationResponse,
    InboxConversationUpdate,
    InboxHumanSend,
    InboxMessageCreate,
    InboxMessageList,
    InboxMessageResponse,
    InboxMessageTransition,
    SendingSettings,
    SignupAvailability,
    SignupFinish,
    SignupStart,
)
from app.messaging.webhooks import MAX_WEBHOOK_BYTES, verify_subscription
from app.messaging.whatsapp import ChannelError
from app.middleware.rate_limit import rate_limit

router = APIRouter(prefix="/api/v1/messaging", tags=["messaging"])


@router.get("/onboarding", response_model=SignupAvailability)
def signup_status(response: Response, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    response.headers["Cache-Control"] = "no-store"
    return onboarding.status(db, ctx[1].tenant_id, owner=ctx[1].role == "owner")


@router.post(
    "/onboarding/start",
    response_model=SignupStart,
    dependencies=[Depends(rate_limit(5, key="whatsapp-signup-start"))],
)
def signup_start(
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
    platform_db: Session = Depends(get_privileged_db),
):
    if ctx[1].role != "owner":
        raise HTTPException(403, "El dueño del negocio debe autorizar esta conexión")
    response.headers["Cache-Control"] = "no-store"
    return onboarding.start(
        platform_db, ctx[1].tenant_id, active_branch_id(db, ctx[1].tenant_id), ctx[0].id
    )


@router.post(
    "/onboarding/finish",
    response_model=InboxConnectionStatus,
    dependencies=[Depends(rate_limit(10, key="whatsapp-signup-finish"))],
)
def signup_finish(
    body: SignupFinish,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
    platform_db: Session = Depends(get_privileged_db),
):
    if ctx[1].role != "owner":
        raise HTTPException(403, "El dueño del negocio debe autorizar esta conexión")
    response.headers["Cache-Control"] = "no-store"
    return onboarding.finish(
        platform_db, ctx[1].tenant_id, active_branch_id(db, ctx[1].tenant_id), ctx[0].id, body
    )


@router.patch("/connection/sending", response_model=InboxConnectionStatus)
def configure_sending(
    body: SendingSettings,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
    platform_db: Session = Depends(get_privileged_db),
):
    if ctx[1].role != "owner":
        raise HTTPException(403, "El dueño del negocio debe autorizar las respuestas")
    response.headers["Cache-Control"] = "no-store"
    try:
        return onboarding.sending(
            platform_db,
            ctx[1].tenant_id,
            active_branch_id(db, ctx[1].tenant_id),
            ctx[0].id,
            enabled=body.enabled,
        )
    except ChannelError:
        raise HTTPException(
            409, "Revisa la conexión de WhatsApp antes de habilitar respuestas"
        ) from None


@router.get("/connection", response_model=InboxConnectionStatus)
def channel_connection(db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return connections.connection_status(db, ctx[1].tenant_id)


@router.get(
    "/webhooks/whatsapp",
    response_class=PlainTextResponse,
    dependencies=[Depends(rate_limit(120, key="whatsapp-verify"))],
)
def verify_whatsapp(request: Request):
    if not connections.platform_ready():
        raise HTTPException(503, "Canal no disponible")
    try:
        return PlainTextResponse(
            verify_subscription(
                mode=request.query_params.get("hub.mode", ""),
                token=request.query_params.get("hub.verify_token", ""),
                challenge=request.query_params.get("hub.challenge", ""),
                expected_token=settings.whatsapp_webhook_verify_token,
            ),
            headers={"Cache-Control": "no-store"},
        )
    except ChannelError:
        raise HTTPException(403, "Verificación rechazada") from None


@router.post("/webhooks/whatsapp", dependencies=[Depends(rate_limit(600, key="whatsapp-ingress"))])
async def receive_whatsapp(request: Request):
    if not connections.platform_ready():
        raise HTTPException(503, "Canal no disponible")
    chunks = bytearray()
    async for chunk in request.stream():
        if len(chunks) + len(chunk) > MAX_WEBHOOK_BYTES:
            raise HTTPException(413, "Evento demasiado grande")
        chunks.extend(chunk)
    try:
        await delivery.receive(bytes(chunks), request.headers.get("x-hub-signature-256", ""))
    except ChannelError as exc:
        status = (
            403
            if exc.code == "webhook_signature_invalid"
            else 503
            if exc.code
            in {
                "channel_configuration_invalid",
                "trusted_channel_binding_required",
            }
            else 400
        )
        raise HTTPException(status, "No se pudo aceptar el evento") from None
    return Response(status_code=200, headers={"Cache-Control": "no-store"})


@router.post("/messages/{message_id}/send", response_model=InboxMessageResponse)
def send_reply(
    message_id: UUID,
    body: InboxHumanSend,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return delivery.send_human_reply(db, ctx[1].tenant_id, ctx[0].id, message_id, body, key)


@router.post(
    "/conversations/{conversation_id}/catalog-draft",
    response_model=InboxMessageResponse,
    status_code=201,
)
def catalog_draft(
    conversation_id: UUID,
    body: InboxCatalogDraft,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.catalog_draft(
        db,
        ctx[1].tenant_id,
        ctx[0].id,
        conversation_id,
        body,
        key,
    )
    return result


@router.get("/readiness", response_model=MessagingReadiness)
def messaging_readiness(db: Session = Depends(get_db), ctx=Depends(require_crm)):
    state = connections.connection_status(db, ctx[1].tenant_id)
    connected = state["status"] == "connected"
    return readiness().model_copy(
        update={
            "status": state["status"],
            "send_enabled": state["send_enabled"],
            "webhook_enabled": state["receive_enabled"],
            "tenant_mapping_verified": connected,
            "setup_status": "configured" if connected else "setup_required",
            "account_mode": "verified" if connected else "not_verified",
            "signup_available": onboarding.available(),
        }
    )


@router.get("/conversations", response_model=InboxConversationList)
def list_conversations(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.conversations(db, ctx[1].tenant_id, limit=limit, offset=offset)


@router.post("/conversations", response_model=InboxConversationResponse, status_code=201)
def create_conversation(
    body: InboxConversationCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.create_conversation(db, ctx[1].tenant_id, ctx[0].id, body, key)
    response.status_code = status
    return result


@router.patch("/conversations/{conversation_id}", response_model=InboxConversationResponse)
def update_conversation(
    conversation_id: UUID,
    body: InboxConversationUpdate,
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


@router.get("/conversations/{conversation_id}/messages", response_model=InboxMessageList)
def list_messages(
    conversation_id: UUID,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    latest: bool = False,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.messages(
        db,
        ctx[1].tenant_id,
        conversation_id,
        limit=limit,
        offset=offset,
        latest=latest,
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=InboxMessageResponse,
    status_code=201,
)
def create_message(
    conversation_id: UUID,
    body: InboxMessageCreate,
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


@router.post("/messages/{message_id}/transition", response_model=InboxMessageResponse)
def transition_message(
    message_id: UUID,
    body: InboxMessageTransition,
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


@router.post("/drafts/from-automation", response_model=InboxMessageResponse, status_code=201)
def draft_from_automation(
    body: InboxAutomationDraftCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.draft_from_automation(db, ctx[1].tenant_id, ctx[0].id, body, key)
    response.status_code = status
    return result
