from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.models import Membership, User, UserSession
from app.billing.access import get_billing_access_status, require_commercial_access
from app.db import get_db
from app.hardware import service
from app.hardware.models import DrawerCommand
from app.hardware.schemas import Acknowledge, DeviceSetup, OpenDrawer, PairDevice
from app.rbac.permissions import Permission, has_permission
from app.shared.dependencies import get_current_session, require_permission
from app.shared.exceptions import bad_request, forbidden, not_found, unauthorized

router = APIRouter(prefix="/api/v1/hardware", tags=["hardware"])


@router.get("/connector/download")
def download():
    return FileResponse(
        Path(__file__).with_name("connector.py"),
        media_type="text/x-python",
        filename="kova-drawer-connector.py",
    )


@router.patch("/drawer")
def update_settings(
    body: DeviceSetup,
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE)),
):
    device = service.current_device(db, ctx[1].tenant_id, lock=True)
    if not device or device.revoked_at is not None:
        raise not_found()
    if not body.name.strip():
        raise bad_request("Escribe un nombre para el conector")
    device.name, device.pin, device.auto_open = body.name.strip(), body.pin, body.auto_open
    audit.log(
        db,
        tenant_id=ctx[1].tenant_id,
        user_id=ctx[0].id,
        action="hardware.drawer.configure",
        resource_type="drawer_device",
        resource_id=device.id,
    )
    db.commit()
    return service.device_status(device)


@router.get("/drawer")
def status(db: Session = Depends(get_db), ctx=Depends(get_current_session)):
    return service.device_status(service.current_device(db, ctx[1].tenant_id))


@router.post("/drawer/setup")
def setup(
    body: DeviceSetup,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE)),
):
    response.headers["Cache-Control"] = "no-store"
    return service.setup(db, ctx[1].tenant_id, ctx[0].id, body)


@router.delete("/drawer")
def revoke(
    db: Session = Depends(get_db), ctx=Depends(require_permission(Permission.SETTINGS_MANAGE))
):
    device = service.current_device(db, ctx[1].tenant_id, lock=True)
    if device:
        device.revoked_at = service.now()
        device.key_hash = device.pairing_hash = None
        device.last_seen_at = None
        db.query(DrawerCommand).filter(
            DrawerCommand.device_id == device.id,
            DrawerCommand.status.in_(["pending", "dispatched"]),
        ).update({"status": "expired"}, synchronize_session=False)
        audit.log(
            db,
            tenant_id=ctx[1].tenant_id,
            user_id=ctx[0].id,
            action="hardware.drawer.revoke",
            resource_type="drawer_device",
            resource_id=device.id,
        )
        db.commit()
    return {"status": "revoked"}


@router.post("/drawer/open")
def open_drawer(
    body: OpenDrawer,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.ORDERS_CREATE)
    ),
):
    _, membership, _ = ctx
    permission = (
        Permission.SETTINGS_MANAGE
        if body.kind == "test"
        else (Permission.SHIFTS_OPEN if body.kind == "manual" else Permission.ORDERS_CREATE)
    )
    if not has_permission(membership.role, permission):
        raise forbidden()
    return service.request_open(db, membership.tenant_id, ctx[0].id, body)


@router.get("/drawer/commands/{command_id}")
def command_status(
    command_id: UUID, db: Session = Depends(get_db), ctx=Depends(get_current_session)
):
    command = (
        db.query(DrawerCommand)
        .filter(
            DrawerCommand.tenant_id == ctx[1].tenant_id,
            DrawerCommand.id == command_id,
        )
        .first()
    )
    if not command:
        raise not_found()
    return service.command_status(command)


@router.post("/connector/pair")
def pair(body: PairDevice, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return service.pair(db, body.code)


def connector(
    db: Session = Depends(get_db),
    key: str | None = Header(default=None, alias="X-Kova-Device-Key", max_length=150),
):
    if not key:
        raise unauthorized("Conector no autorizado")
    device = service.authenticate(db, key)
    if not get_billing_access_status(db, tenant_id=device.tenant_id).allowed:
        raise forbidden("El negocio no tiene acceso comercial activo")
    return device


@router.post("/connector/poll")
def poll(response: Response, db: Session = Depends(get_db), device=Depends(connector)):
    response.headers["Cache-Control"] = "no-store"
    return service.poll(db, device)


@router.post("/connector/commands/{command_id}/ack")
def ack(
    command_id: UUID, body: Acknowledge, db: Session = Depends(get_db), device=Depends(connector)
):
    return service.acknowledge(db, device, command_id, body.status)
