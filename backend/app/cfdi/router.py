from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.cfdi import service
from app.cfdi.schemas import (
    CancellationInput,
    ConnectionInput,
    ConnectionPublic,
    ContextResponse,
    DocumentResponse,
    Environment,
    EnvironmentInput,
    InvoicePreparation,
    PreviewResponse,
    StatusResponse,
)
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request


class PrivateValidationRoute(APIRoute):
    """Never echo organization keys or fiscal PII in validation errors."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                return await original(request)
            except RequestValidationError as exc:
                return JSONResponse(
                    status_code=422,
                    content={
                        "detail": [
                            {
                                "loc": list(error["loc"]),
                                "type": error["type"],
                                "msg": "Campo CFDI inválido",
                            }
                            for error in exc.errors()
                        ]
                    },
                )

        return handler


router = APIRouter(
    prefix="/api/v1/integrations/cfdi", tags=["cfdi"], route_class=PrivateValidationRoute
)
Context = tuple[User, Membership, UserSession]
Auth = Depends(require_commercial_access(Permission.FISCAL_MANAGE))


def _key(value: str | None = Header(default=None, alias="Idempotency-Key")):
    if not value or len(value) > 200:
        raise bad_request("Idempotency-Key debe contener entre 1 y 200 caracteres")
    return value


@router.get("/status", response_model=StatusResponse)
def status(db: Session = Depends(get_db), ctx: Context = Auth):
    return service.status(db, ctx[1].tenant_id)


@router.put("/connection", response_model=ConnectionPublic)
def connection(body: ConnectionInput, db: Session = Depends(get_db), ctx: Context = Auth):
    return service.connect(db, ctx[1].tenant_id, ctx[0].id, body)


@router.post("/connection/refresh", response_model=ConnectionPublic)
def refresh(body: EnvironmentInput, db: Session = Depends(get_db), ctx: Context = Auth):
    return service.refresh_connection(db, ctx[1].tenant_id, body.environment)


@router.get("/requests/{request_id}/context", response_model=ContextResponse)
def context(request_id: UUID, db: Session = Depends(get_db), ctx: Context = Auth):
    return service.context(db, ctx[1].tenant_id, request_id)


@router.post("/preview", response_model=PreviewResponse)
def preview(body: InvoicePreparation, db: Session = Depends(get_db), ctx: Context = Auth):
    return service.preview(db, ctx[1].tenant_id, body)[0]


@router.post("/documents", response_model=DocumentResponse, status_code=201)
def create_document(
    body: InvoicePreparation,
    db: Session = Depends(get_db),
    ctx: Context = Auth,
    key: str = Depends(_key),
):
    return service.create_document(db, ctx[1].tenant_id, ctx[0].id, body, key)


@router.get("/documents", response_model=list[DocumentResponse])
def documents(
    request_id: UUID | None = Query(default=None),
    environment: Environment | None = Query(default=None),
    db: Session = Depends(get_db),
    ctx: Context = Auth,
):
    return service.documents(db, ctx[1].tenant_id, request_id, environment)


@router.post("/documents/{document_id}/reconcile", response_model=DocumentResponse)
def reconcile(document_id: UUID, db: Session = Depends(get_db), ctx: Context = Auth):
    return service.reconcile(db, ctx[1].tenant_id, ctx[0].id, document_id)


@router.post("/documents/{document_id}/cancel", response_model=DocumentResponse)
def cancel(
    document_id: UUID,
    body: CancellationInput,
    db: Session = Depends(get_db),
    ctx: Context = Auth,
    key: str = Depends(_key),
):
    return service.cancel(db, ctx[1].tenant_id, ctx[0].id, document_id, body, key)


def _download(document, content, suffix, media_type):
    label = "test-sin-validez-fiscal-" if document.environment == "test" else ""
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{label}cfdi-{document.id}.{suffix}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/documents/{document_id}/xml")
def xml(document_id: UUID, db: Session = Depends(get_db), ctx: Context = Auth):
    document, content = service.xml(db, ctx[1].tenant_id, document_id)
    return _download(document, content, "xml", "application/xml")


@router.get("/documents/{document_id}/pdf")
def pdf(document_id: UUID, db: Session = Depends(get_db), ctx: Context = Auth):
    document, content = service.pdf(db, ctx[1].tenant_id, document_id)
    return _download(document, content, "pdf", "application/pdf")
