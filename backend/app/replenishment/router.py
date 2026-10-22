import hashlib
import json
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.branches.scope import active_branch_id
from app.catalog.models import Product
from app.db import get_db
from app.idempotency import service as idempotency
from app.inventory.service import list_low_stock
from app.purchasing.models import PurchaseOrder, PurchaseOrderItem
from app.purchasing.schemas import PurchaseCreate, PurchaseItemCreate, PurchaseResponse
from app.purchasing.service import create_order
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request, conflict
from app.shared.validation import StrictModel

router = APIRouter(prefix="/api/v1/replenishment", tags=["replenishment"])
_access = require_commercial_access(Permission.INVENTORY_ADJUST)


class Suggestion(BaseModel):
    product_id: UUID
    product_name: str
    available_quantity: int
    reserved_quantity: int
    incoming_quantity: int
    low_stock_threshold: int
    suggested_quantity: int
    unit_cost: Decimal | None
    evidence_version: str


class ApprovedItem(PurchaseItemCreate):
    evidence_version: str = Field(pattern=r"^[a-f0-9]{64}$")


class ApprovePurchase(StrictModel):
    supplier_id: UUID
    items: list[ApprovedItem] = Field(min_length=1, max_length=100)


def suggestions(db: Session, tenant_id: UUID) -> list[Suggestion]:
    low = list_low_stock(db, tenant_id=tenant_id)
    ids = [UUID(row["product_id"]) for row in low]
    if not ids:
        return []
    products = {
        p.id: p
        for p in db.query(Product).filter(Product.tenant_id == tenant_id, Product.id.in_(ids)).all()
    }
    incoming = dict(
        db.query(
            PurchaseOrderItem.product_id,
            func.sum(PurchaseOrderItem.quantity - PurchaseOrderItem.received_quantity),
        )
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
        .filter(
            PurchaseOrder.tenant_id == tenant_id,
            PurchaseOrder.branch_id == active_branch_id(db, tenant_id),
            PurchaseOrderItem.tenant_id == tenant_id,
            PurchaseOrderItem.product_id.in_(ids),
            PurchaseOrder.status.in_(["pending", "partial"]),
        )
        .group_by(PurchaseOrderItem.product_id)
        .all()
    )
    result = []
    for row in low[:100]:
        pid = UUID(row["product_id"])
        product = products[pid]
        payload = {
            "product_id": str(pid),
            "available": row["available_quantity"],
            "reserved": row["reserved_quantity"],
            "incoming": int(incoming.get(pid, 0)),
            "threshold": row["low_stock_threshold"],
            "cost": str(product.cost_price) if product.cost_price is not None else None,
            "updated_at": str(product.updated_at),
        }
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        quantity = max(
            0, row["low_stock_threshold"] + 1 - row["available_quantity"] - payload["incoming"]
        )
        result.append(
            Suggestion(
                product_id=pid,
                product_name=product.name,
                available_quantity=row["available_quantity"],
                reserved_quantity=row["reserved_quantity"],
                incoming_quantity=payload["incoming"],
                low_stock_threshold=row["low_stock_threshold"],
                suggested_quantity=quantity,
                unit_cost=product.cost_price,
                evidence_version=fingerprint,
            )
        )
    return result


@router.get("", response_model=list[Suggestion])
def list_suggestions(db: Session = Depends(get_db), ctx=Depends(_access)):
    return suggestions(db, ctx[1].tenant_id)


@router.post("/approve-purchase", response_model=PurchaseResponse, status_code=201)
def approve(
    body: ApprovePurchase,
    response: Response,
    db: Session = Depends(get_db),
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    ctx=Depends(_access),
):
    if not key or len(key) > 200:
        raise bad_request("Idempotency-Key es obligatorio y debe tener hasta 200 caracteres")
    user, membership, _ = ctx
    tenant_id = membership.tenant_id
    fingerprint = hashlib.sha256(f"restock:{body.model_dump_json()}".encode()).hexdigest()
    replay = idempotency.claim(db, tenant_id=tenant_id, key=key, request_hash=fingerprint)
    if replay:
        response.status_code = replay.response_status
        return replay.response_body
    ids = [item.product_id for item in body.items]
    if len(ids) != len(set(ids)):
        raise bad_request("No repitas productos en la compra")
    db.query(Product).filter(Product.tenant_id == tenant_id, Product.id.in_(ids)).order_by(
        Product.id
    ).with_for_update().all()
    current = {row.product_id: row for row in suggestions(db, tenant_id)}
    for item in body.items:
        row = current.get(item.product_id)
        if row is None or row.evidence_version != item.evidence_version:
            raise conflict("Las existencias o compras pendientes cambiaron. Revisa la reposición.")
    purchase_body = PurchaseCreate(
        supplier_id=body.supplier_id,
        notes="Reposición revisada y aprobada desde Kova.",
        items=[
            PurchaseItemCreate(
                product_id=item.product_id, quantity=item.quantity, unit_cost=item.unit_cost
            )
            for item in body.items
        ],
    )
    internal_key = "restock-purchase:" + hashlib.sha256(key.encode()).hexdigest()
    status, result = create_order(
        db, tenant_id=tenant_id, user_id=user.id, body=purchase_body, key=internal_key, commit=False
    )
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=status,
        response_body=result,
    )
    db.commit()
    response.status_code = status
    return result
