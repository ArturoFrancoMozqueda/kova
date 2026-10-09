import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit
from app.branches.models import Branch
from app.branches.scope import bind_branch
from app.db import set_tenant_context
from app.hardware.models import DrawerCommand, DrawerDevice
from app.hardware.schemas import DeviceSetup, OpenDrawer
from app.orders.models import Order, Payment
from app.shared.exceptions import bad_request, conflict, not_found, unauthorized
from app.shifts.repository import get_open_shift


def now() -> datetime:
    return datetime.now(UTC)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def current_device(db: Session, tenant_id: UUID, *, lock: bool = False) -> DrawerDevice | None:
    query = db.query(DrawerDevice).filter(DrawerDevice.tenant_id == tenant_id)
    return (query.with_for_update() if lock else query).first()


def device_status(device: DrawerDevice | None) -> dict:
    if device is None or device.revoked_at is not None:
        return {"configured": False, "online": False, "auto_open": False}
    return {
        "configured": True,
        "online": bool(
            device.key_expires_at
            and device.key_expires_at > now()
            and device.last_seen_at
            and device.last_seen_at > now() - timedelta(seconds=10)
        ),
        "id": str(device.id),
        "name": device.name,
        "pin": device.pin,
        "auto_open": device.auto_open,
        "paired": device.key_hash is not None,
        "last_seen_at": device.last_seen_at,
        "key_expires_at": device.key_expires_at,
    }


def setup(db: Session, tenant_id: UUID, user_id: UUID, body: DeviceSetup) -> dict:
    # Serialize first-time enrollment too, before the device row exists.
    from app.branches.scope import active_branch_id

    db.query(Branch).filter(
        Branch.tenant_id == tenant_id, Branch.id == active_branch_id(db, tenant_id)
    ).with_for_update().one()
    device = current_device(db, tenant_id, lock=True)
    if not body.name.strip():
        raise bad_request("Escribe un nombre para el conector")
    if device is None:
        device = DrawerDevice(tenant_id=tenant_id, name=body.name.strip())
        db.add(device)
        db.flush()
    device.name, device.pin, device.auto_open = body.name.strip(), body.pin, body.auto_open
    device.revoked_at = None
    device.key_hash = None
    device.key_expires_at = None
    device.last_seen_at = None
    # Re-enrollment cancels all outstanding commands and invalidates the old key.
    db.query(DrawerCommand).filter(
        DrawerCommand.device_id == device.id,
        DrawerCommand.status.in_(["pending", "dispatched"]),
    ).update({"status": "expired"}, synchronize_session=False)
    secret = secrets.token_urlsafe(32)
    code = f"{tenant_id}.{device.id}.{secret}"
    device.pairing_hash = digest(code)
    device.pairing_expires_at = now() + timedelta(minutes=10)
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="hardware.drawer.enroll",
        resource_type="drawer_device",
        resource_id=device.id,
    )
    db.commit()
    return {
        "device": device_status(device),
        "pairing_code": code,
        "pairing_expires_at": device.pairing_expires_at,
    }


def authenticate(db: Session, token: str, *, pairing: bool = False) -> DrawerDevice:
    # This prefix is ONLY a lookup hint. No identity or branch is authorized until
    # the full 256-bit secret is verified against the stored hash under tenant RLS.
    try:
        tenant_text, device_text, _ = token.split(".")
        tenant_id, device_id = UUID(tenant_text), UUID(device_text)
    except (ValueError, AttributeError):
        raise unauthorized("Conector no autorizado") from None
    set_tenant_context(db, tenant_id)
    device = (
        db.query(DrawerDevice)
        .filter(
            DrawerDevice.tenant_id == tenant_id,
            DrawerDevice.id == device_id,
        )
        .with_for_update()
        .first()
    )
    expected = device.pairing_hash if device and pairing else device.key_hash if device else None
    expiry = (
        device.pairing_expires_at
        if device and pairing
        else device.key_expires_at
        if device
        else None
    )
    if (
        not device
        or device.revoked_at is not None
        or not expected
        or not expiry
        or expiry <= now()
        or not hmac.compare_digest(digest(token), expected)
    ):
        raise unauthorized("Conector no autorizado")
    bind_branch(db, tenant_id=device.tenant_id, branch_id=device.branch_id)
    return device


def pair(db: Session, code: str) -> dict:
    device = authenticate(db, code, pairing=True)
    key = f"{device.tenant_id}.{device.id}.{secrets.token_urlsafe(32)}"
    device.key_hash = digest(key)
    device.key_expires_at = now() + timedelta(days=90)
    device.pairing_hash = None
    device.pairing_expires_at = None
    db.commit()
    return {"device_key": key, "key_expires_at": device.key_expires_at}


def command_status(command: DrawerCommand) -> dict:
    status = command.status
    if status in {"pending", "dispatched"} and command.expires_at <= now():
        status = "expired"
    return {"id": str(command.id), "status": status, "expires_at": command.expires_at}


def request_open(db: Session, tenant_id: UUID, user_id: UUID, body: OpenDrawer) -> dict:
    device = current_device(db, tenant_id, lock=True)
    if not device or device.revoked_at is not None:
        return {"status": "disabled"}
    if body.kind == "sale" and not device.auto_open:
        return {"status": "disabled"}
    key = f"sale:{body.order_id}" if body.kind == "sale" else f"{body.kind}:{body.request_id}"
    existing = (
        db.query(DrawerCommand)
        .filter(
            DrawerCommand.tenant_id == tenant_id,
            DrawerCommand.request_key == key,
        )
        .first()
    )
    if existing:
        expected_reason = "Venta en efectivo" if body.kind == "sale" else body.reason.strip()
        if existing.order_id != body.order_id or existing.reason != expected_reason:
            raise conflict("La solicitud de apertura cambió; usa una nueva solicitud")
        return command_status(existing)
    if body.kind != "test":
        shift = get_open_shift(db, tenant_id=tenant_id)
        if not shift:
            raise bad_request("Abre un turno antes de abrir el cajón")
    if body.kind == "sale":
        order = (
            db.query(Order).filter(Order.tenant_id == tenant_id, Order.id == body.order_id).first()
        )
        if not order or order.status != "completed" or order.shift_id != shift.id:
            raise bad_request("La venta no pertenece al turno abierto")
        cash = (
            db.query(Payment)
            .filter(
                Payment.tenant_id == tenant_id,
                Payment.order_id == order.id,
                Payment.method == "cash",
                Payment.amount_amount > 0,
            )
            .first()
        )
        ring_time = order.occurred_at or order.created_at
        if not cash or not now() - timedelta(seconds=30) <= ring_time <= now() + timedelta(
            seconds=5
        ):
            raise bad_request("La apertura automática requiere una venta reciente en efectivo")
    elif body.order_id is not None or not body.reason.strip():
        raise bad_request("Indica el motivo de la apertura")
    if not device_status(device)["online"] or not device.key_hash:
        raise conflict("El conector está desconectado; abre el cajón con la llave")
    timestamp = now()
    # Device row lock also serializes requests, pairing, polling and revocation.
    recent = (
        db.query(DrawerCommand)
        .filter(
            DrawerCommand.device_id == device.id,
            DrawerCommand.created_at > timestamp - timedelta(seconds=2),
        )
        .first()
    )
    if recent:
        raise conflict("Espera un momento antes de volver a abrir el cajón")
    command = DrawerCommand(
        tenant_id=tenant_id,
        device_id=device.id,
        request_key=key,
        kind=body.kind,
        order_id=body.order_id,
        requested_by_user_id=user_id,
        reason=body.reason.strip() if body.kind != "sale" else "Venta en efectivo",
        expires_at=timestamp + timedelta(seconds=5),
    )
    db.add(command)
    db.flush()
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="hardware.drawer.request",
        resource_type="drawer_command",
        resource_id=command.id,
        changes={"kind": body.kind, "reason": command.reason},
    )
    db.commit()
    return command_status(command)


def poll(db: Session, device: DrawerDevice) -> dict:
    timestamp = now()
    device.last_seen_at = timestamp
    db.query(DrawerCommand).filter(
        DrawerCommand.device_id == device.id,
        DrawerCommand.status.in_(["pending", "dispatched"]),
        DrawerCommand.expires_at <= timestamp,
    ).update({"status": "expired"}, synchronize_session=False)
    command = (
        db.query(DrawerCommand)
        .filter(
            DrawerCommand.device_id == device.id,
            DrawerCommand.status == "pending",
            DrawerCommand.expires_at > timestamp,
        )
        .order_by(DrawerCommand.created_at)
        .with_for_update()
        .first()
    )
    commands = []
    if command:
        command.status = "dispatched"
        commands.append(
            {
                "id": str(command.id),
                "pin": device.pin,
                "expires_at": command.expires_at,
                "ttl_ms": 4000,
            }
        )
    # Commit BEFORE returning. A lost response never redelivers a physical pulse.
    db.commit()
    return {"commands": commands}


def acknowledge(db: Session, device: DrawerDevice, command_id: UUID, status: str) -> dict:
    command = (
        db.query(DrawerCommand)
        .filter(
            DrawerCommand.device_id == device.id,
            DrawerCommand.id == command_id,
        )
        .with_for_update()
        .first()
    )
    if not command:
        raise not_found()
    if command.status == "dispatched":
        command.status = status
        command.acknowledged_at = now()
        db.commit()
    return command_status(command)
