"""Online atomic branch transfers; product locks serialize every stock writer."""

import hashlib
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint, Integer, String, func
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.audit import service as audit
from app.auth.models import Membership
from app.billing.access import require_commercial_access
from app.branches.models import Branch
from app.branches.scope import transfer_branches
from app.catalog.models import Product
from app.customer_orders.models import InventoryReservation
from app.db import Base, get_db
from app.idempotency import service as idempotency
from app.orders.models import InventoryMovement
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request, forbidden, not_found
from app.shared.validation import INTEGER_MAX


class InventoryTransfer(Base):
    __tablename__ = "inventory_transfers"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "source_branch_id"], ["branches.tenant_id", "branches.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "destination_branch_id"], ["branches.tenant_id", "branches.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
        CheckConstraint("quantity > 0", name="ck_transfers_quantity"),
        CheckConstraint(
            "source_branch_id <> destination_branch_id", name="ck_transfers_distinct_branches"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    source_branch_id: Mapped[UUID] = mapped_column(nullable=False)
    destination_branch_id: Mapped[UUID] = mapped_column(nullable=False)
    product_id: Mapped[UUID] = mapped_column(nullable=False)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(200), nullable=False)
    created_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TransferWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_branch_id: UUID
    destination_branch_id: UUID
    product_id: UUID
    quantity: int = Field(strict=True, ge=1, le=INTEGER_MAX)
    reason: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_transfer(self):
        self.reason = self.reason.strip()
        if not self.reason or self.source_branch_id == self.destination_branch_id:
            raise ValueError("Selecciona sucursales diferentes y escribe el motivo")
        return self


class TransferResponse(TransferWrite):
    product_name: str
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    created_at: datetime


router = APIRouter()


def transfer_stock(
    db: Session, membership: Membership, user_id: UUID, body: TransferWrite, key: str
):
    # Cross-branch writes are reserved to unrestricted managers/owners; a cashier
    # assigned to one store must never move stock out of another location.
    if membership.allowed_branch_id is not None:
        raise forbidden("Los traspasos requieren acceso a todas las sucursales")
    fingerprint = hashlib.sha256(
        f"inventory.transfer:{body.model_dump_json()}".encode()
    ).hexdigest()
    tenant_id = membership.tenant_id
    with transfer_branches(db, {body.source_branch_id, body.destination_branch_id}):
        existing = idempotency.claim(
            db, tenant_id=membership.tenant_id, key=key, request_hash=fingerprint
        )
        if existing:
            return existing.response_status, existing.response_body
        branches = (
            db.query(Branch)
            .filter(
                Branch.tenant_id == tenant_id,
                Branch.id.in_([body.source_branch_id, body.destination_branch_id]),
            )
            .all()
        )
        if len(branches) != 2:
            raise not_found("Sucursal no encontrada para este negocio")
        product = (
            db.query(Product)
            .filter(
                Product.tenant_id == tenant_id,
                Product.id == body.product_id,
                Product.is_active.is_(True),
            )
            .with_for_update()
            .first()
        )
        if not product:
            raise not_found("Producto no encontrado")
        if not product.track_inventory:
            raise bad_request("El producto no lleva control de inventario")

        def stock(branch_id):
            return int(
                db.query(func.coalesce(func.sum(InventoryMovement.quantity_delta), 0))
                .filter(
                    InventoryMovement.tenant_id == tenant_id,
                    InventoryMovement.branch_id == branch_id,
                    InventoryMovement.product_id == product.id,
                )
                .scalar()
                or 0
            )

        source, destination = stock(body.source_branch_id), stock(body.destination_branch_id)
        reserved = int(
            db.query(func.coalesce(func.sum(InventoryReservation.quantity), 0))
            .filter(
                InventoryReservation.tenant_id == tenant_id,
                InventoryReservation.branch_id == body.source_branch_id,
                InventoryReservation.product_id == product.id,
                InventoryReservation.status == "active",
            )
            .scalar()
            or 0
        )
        if source - reserved < body.quantity:
            raise bad_request(
                "No hay suficientes unidades disponibles; "
                "revisa las existencias y pedidos reservados"
            )
        if destination + body.quantity > INTEGER_MAX:
            raise bad_request("Las existencias de destino superarían el límite permitido")
        transfer = InventoryTransfer(
            tenant_id=tenant_id,
            created_by_user_id=user_id,
            product_name=product.name,
            **body.model_dump(),
        )
        db.add(transfer)
        db.flush()
        for branch_id, delta, after, kind in [
            (body.source_branch_id, -body.quantity, source - body.quantity, "transfer_out"),
            (body.destination_branch_id, body.quantity, destination + body.quantity, "transfer_in"),
        ]:
            db.add(
                InventoryMovement(
                    tenant_id=tenant_id,
                    branch_id=branch_id,
                    product_id=product.id,
                    quantity_delta=delta,
                    stock_on_hand_after=after,
                    movement_type=kind,
                    reason=f"Traspaso {transfer.id}: {body.reason}",
                    created_by_user_id=user_id,
                )
            )
        db.flush()
        result = TransferResponse.model_validate(transfer).model_dump(mode="json")
        audit.log(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            action="inventory.transfer",
            resource_type="inventory_transfer",
            resource_id=transfer.id,
            changes={
                "source_branch_id": str(body.source_branch_id),
                "destination_branch_id": str(body.destination_branch_id),
                "product_id": str(product.id),
                "quantity": body.quantity,
            },
        )
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


@router.post("/transfers", response_model=TransferResponse, status_code=201)
def create_transfer(
    body: TransferWrite,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.INVENTORY_ADJUST)),
):
    if not key:
        raise bad_request("Idempotency-Key header is required")
    user, membership, _ = ctx
    status, result = transfer_stock(db, membership, user.id, body, key)
    response.status_code = status
    return result


@router.get("/transfers", response_model=list[TransferResponse])
def list_transfers(
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.INVENTORY_ADJUST)),
):
    _, membership, _ = ctx
    query = db.query(InventoryTransfer).filter(InventoryTransfer.tenant_id == membership.tenant_id)
    if membership.allowed_branch_id is not None:
        query = query.filter(
            (InventoryTransfer.source_branch_id == membership.allowed_branch_id)
            | (InventoryTransfer.destination_branch_id == membership.allowed_branch_id)
        )
    return (
        query.order_by(InventoryTransfer.created_at.desc(), InventoryTransfer.id).limit(100).all()
    )
