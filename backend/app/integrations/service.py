import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit
from app.branches.scope import active_branch_id
from app.cfdi.credentials import storage_available
from app.cfdi.models import CfdiConnection
from app.fiscal.models import OrderFiscalSnapshot
from app.idempotency import service as idempotency
from app.integrations.models import FiscalIssuerProfile, InvoiceRequest
from app.integrations.schemas import (
    FiscalIdentity,
    InvoiceRequestCreate,
    InvoiceRequestResponse,
    ReadinessResponse,
)
from app.orders.models import Order
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.models import Tenant


def readiness(db: Session, tenant_id: UUID) -> ReadinessResponse:
    row = db.query(FiscalIssuerProfile).filter_by(tenant_id=tenant_id).first()
    connections = db.query(CfdiConnection).filter_by(tenant_id=tenant_id).all()
    live = next(
        (connection for connection in connections if connection.environment == "live"), None
    )
    ready = bool(
        live
        and storage_available()
        and live.production_ready
        and live.certificate_expires_at
        and live.certificate_expires_at > datetime.now(UTC)
        and row
        and live.issuer_rfc == row.fiscal_data.get("rfc")
    )
    state = (
        ("live_ready" if ready else "live_not_ready")
        if live
        else ("test_connected" if connections else "not_connected")
    )
    return ReadinessResponse(
        issuer=FiscalIdentity(**row.fiscal_data) if row else None,
        cfdi_status=state,
        can_issue_cfdi=ready,
    )


def save_issuer(
    db: Session, tenant_id: UUID, body: FiscalIdentity, user_id: UUID | None = None
) -> ReadinessResponse:
    # Serialize first profile creation; PUT of identical fields is a safe no-op.
    db.query(Tenant).filter_by(id=tenant_id).with_for_update().one()
    row = db.query(FiscalIssuerProfile).filter_by(tenant_id=tenant_id).first()
    if row is None:
        row = FiscalIssuerProfile(tenant_id=tenant_id)
        db.add(row)
    values = body.model_dump(mode="json")
    if row.fiscal_data != values:
        row.fiscal_data = values
        audit.log(
            db,
            action="fiscal.issuer_updated",
            tenant_id=tenant_id,
            user_id=user_id,
            resource_type="fiscal_issuer_profile",
            resource_id=tenant_id,
            changes={"fields": sorted(values)},
        )
    db.commit()
    return readiness(db, tenant_id)


def list_requests(db: Session, tenant_id: UUID, limit: int = 50, offset: int = 0):
    return (
        db.query(InvoiceRequest)
        .filter_by(tenant_id=tenant_id)
        .order_by(InvoiceRequest.created_at.desc(), InvoiceRequest.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def create_request(
    db: Session, tenant_id: UUID, body: InvoiceRequestCreate, key: str, user_id: UUID | None = None
):
    fingerprint = hashlib.sha256(
        json.dumps(
            {"operation": "invoice_request", **body.model_dump(mode="json")}, sort_keys=True
        ).encode()
    ).hexdigest()
    stored = idempotency.claim(db, tenant_id=tenant_id, key=key, request_hash=fingerprint)
    if stored:
        return stored.response_status, stored.response_body
    # Lock the sale to serialize duplicate requests even with different idempotency keys.
    order = (
        db.query(Order)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=body.order_id)
        .with_for_update()
        .first()
    )
    if order is None:
        raise not_found("Venta no encontrada")
    if order.status != "completed" or order.total_amount <= 0:
        raise bad_request("La solicitud requiere una venta completada con importe mayor a cero")
    if db.query(InvoiceRequest).filter_by(tenant_id=tenant_id, order_id=order.id).first():
        raise conflict("Esta venta ya tiene una solicitud de factura")
    profile = db.query(FiscalIssuerProfile).filter_by(tenant_id=tenant_id).first()
    if profile is None:
        raise bad_request("Guarda primero los datos fiscales del negocio")
    fiscal = db.query(OrderFiscalSnapshot).filter_by(tenant_id=tenant_id, order_id=order.id).first()
    pricing = (
        {
            field: str(getattr(fiscal, field))
            for field in (
                "gross_amount",
                "discount_total_amount",
                "tax_total_amount",
                "total_amount",
                "pricing_engine_version",
                "tax_calculation_status",
                "currency",
            )
        }
        if fiscal
        else {
            "total_amount": str(order.total_amount),
            "tax_calculation_status": "not_calculated",
            "currency": "MXN",
        }
    )
    row = InvoiceRequest(
        tenant_id=tenant_id,
        branch_id=order.branch_id,
        order_id=order.id,
        issuer_snapshot=dict(profile.fiscal_data),
        pricing_snapshot=pricing,
        recipient_snapshot=body.recipient.model_dump(mode="json"),
        total_amount=order.total_amount,
    )
    db.add(row)
    db.flush()
    audit.log(
        db,
        action="fiscal.invoice_request_created",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="invoice_request",
        resource_id=row.id,
        changes={"status": "pending_provider", "fiscal_status": "not_issued"},
    )
    result = InvoiceRequestResponse.model_validate(row).model_dump(mode="json")
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=201,
        response_body=result,
    )
    db.commit()
    return 201, result
