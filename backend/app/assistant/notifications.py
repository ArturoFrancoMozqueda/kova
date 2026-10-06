"""Transactional outbox; provider acceptance is never called inbox delivery."""

import base64
import hashlib
import json
import os
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.assistant import budget, tools
from app.assistant import repository as repo
from app.assistant.models import now
from app.config import settings
from app.employees.models import MembershipInvitation
from app.rbac.permissions import Permission, has_permission
from app.reports import service as reports


def _cipher():
    return AESGCM(
        hashlib.sha256(("kova-assistant-outbox-v1:" + settings.secret_key).encode()).digest()
    )


def queue_invitation(db, ctx, branch, invitation, token):
    user, member, _ = ctx
    budget.charge(
        db, [(f"invite_user:{user.id}", 1, 10), (f"invite_tenant:{member.tenant_id}", 1, 20)]
    )
    budget.charge(db, [(f"invite_hour:{user.id}", 1, 5)], window=now().strftime("%Y-%m-%dT%H"))
    nonce = os.urandom(12)
    aad = f"{member.tenant_id}:{invitation.id}".encode()
    encrypted = _cipher().encrypt(nonce, token.encode(), aad)
    repo.create(
        db,
        member.tenant_id,
        user.id,
        branch,
        "mail",
        {
            "type": "invitation",
            "invitation_id": str(invitation.id),
            "ciphertext": base64.b64encode(nonce + encrypted).decode(),
        },
        status="queued",
        dedupe=f"invite:{invitation.id}",
    )


def refresh_signals(db, ctx, branch):
    user, member, _ = ctx
    config = tools.configuration(db, member.tenant_id)
    desired = {
        f"onboarding:{key}": {
            "title": {
                "business_profile": "Completa el perfil del negocio",
                "receipt": "Revisa tu ticket",
                "first_product": "Carga tu primer producto",
                "first_sale": "Registra tu primera venta",
            }[key],
            "path": {
                "business_profile": "/settings/business-profile",
                "receipt": "/settings/receipt",
                "first_product": "/catalog",
                "first_sale": "/register",
            }[key],
            "verified": False,
        }
        for key in config["pending"]
    }
    story = reports.business_story(db, tenant_id=member.tenant_id, start_date=None, end_date=None)
    for alert in story.get("restock_alerts", [])[:20]:
        identifier = str(alert.get("product_id", ""))
        if identifier:
            desired[f"restock:{identifier}"] = {
                "title": "Revisa la reposición de " + str(alert.get("product_name", "un producto")),
                "path": "/inventory",
                "evidence": json.loads(json.dumps(alert, default=str)),
                "verified": False,
            }
    for key, data in desired.items():
        dedupe = f"{branch}:{key}"
        task = (
            repo.records(db, member.tenant_id, user.id, "task").filter_by(dedupe_key=dedupe).first()
        )
        if task is None:
            repo.create(
                db, member.tenant_id, user.id, branch, "task", data, dedupe=dedupe, status="pending"
            )
        elif task.status == "verified":
            task.status = "pending"
            repo.update(task, **data)
        elif task.data.get("evidence") != data.get("evidence"):
            repo.update(task, **data)
    for task in repo.records(db, member.tenant_id, user.id, "task").filter_by(branch_id=branch):
        key = task.dedupe_key.split(":", 1)[1]
        if key not in desired:
            task.status = "verified"
            repo.update(task, verified=True)
    for goal in repo.records(db, member.tenant_id, user.id, "goal").filter_by(branch_id=branch):
        values = goal.data
        summary = reports.sales_summary(
            db,
            tenant_id=member.tenant_id,
            start_date=date.fromisoformat(values["start_date"]),
            end_date=date.fromisoformat(values["end_date"]),
        )
        current = str(summary[values["metric"]])
        repo.update(
            goal,
            current=current,
            measured_at=now().isoformat(),
            achieved=Decimal(current) >= Decimal(values["target"]),
        )
    db.commit()


def queue_digest(db, ctx, branch):
    user, member, _ = ctx
    pref = repo.records(db, member.tenant_id, user.id, "preferences").populate_existing().first()
    if (
        not settings.assistant_email_enabled
        or not pref
        or not pref.data.get("email_opt_in")
        or not user.is_email_verified
    ):
        return
    config = tools.configuration(db, member.tenant_id)
    local = now().astimezone(ZoneInfo(config["timezone"]))
    if local.hour != 9 or pref.data.get("frequency") == "weekly" and local.weekday() != 0:
        return
    tasks = repo.records(db, member.tenant_id, user.id, "task").filter_by(status="pending").all()
    if not tasks:
        return
    key = f"digest:{local.date()}"
    if repo.records(db, member.tenant_id, user.id, "mail").filter_by(dedupe_key=key).first():
        return
    repo.create(
        db,
        member.tenant_id,
        user.id,
        branch,
        "mail",
        {"type": "digest", "task_ids": [str(t.id) for t in tasks]},
        status="queued",
        dedupe=key,
    )
    db.commit()


def deliver(db, ctx, mail):
    user, member, _ = ctx
    from app.assistant.access import enabled
    from app.billing.access import get_billing_access_status

    db.refresh(user)
    db.refresh(member)
    if (
        not enabled(member.tenant_id)
        or not member.is_active
        or not user.is_active
        or member.role not in {"owner", "manager"}
        or member.allowed_branch_id is not None
        or not get_billing_access_status(db, tenant_id=member.tenant_id).allowed
    ):
        mail.status = "cancelled"
        db.commit()
        return
    if not settings.resend_api_key:
        return
    if mail.data["type"] == "invitation":
        if not has_permission(member.role, Permission.USERS_MANAGE):
            mail.status = "cancelled"
            db.commit()
            return
        invitation = (
            db.query(MembershipInvitation)
            .filter_by(tenant_id=member.tenant_id, id=UUID(mail.data["invitation_id"]))
            .first()
        )
        if (
            not invitation
            or invitation.status != "pending"
            or invitation.expires_at < now()
            or (invitation.role == "owner" and member.role != "owner")
        ):
            mail.status = "cancelled"
            db.commit()
            return
        cipher = base64.b64decode(mail.data["ciphertext"])
        token = (
            _cipher()
            .decrypt(cipher[:12], cipher[12:], f"{member.tenant_id}:{invitation.id}".encode())
            .decode()
        )
        to = invitation.email
        subject = "Invitación a tu negocio en Kova"
        content = (
            f"Te invitaron a colaborar en Kova con el rol {invitation.role}.\n"
            "Revisa y acepta la invitación:\n"
            f"{settings.frontend_url}/accept-invite?token={token}"
        )
    else:
        pref = (
            repo.records(db, member.tenant_id, user.id, "preferences").populate_existing().first()
        )
        if (
            not settings.assistant_email_enabled
            or not pref
            or not pref.data.get("email_opt_in")
            or not user.is_email_verified
        ):
            mail.status = "cancelled"
            db.commit()
            return
        config = tools.configuration(db, member.tenant_id)
        today = now().astimezone(ZoneInfo(config["timezone"])).date()
        if mail.dedupe_key != f"digest:{today}":
            mail.status = "cancelled"
            db.commit()
            return
        tasks = (
            repo.records(db, member.tenant_id, user.id, "task")
            .filter_by(status="pending")
            .filter(
                repo.AssistantRecord.id.in_([UUID(x) for x in mail.data["task_ids"]]),
                repo.AssistantRecord.updated_at
                > now() - timedelta(days=7 if pref.data.get("frequency") == "weekly" else 1),
            )
            .all()
        )
        if not tasks:
            mail.status = "cancelled"
            db.commit()
            return
        to = user.email
        subject = "Tus pendientes del negocio en Kova"
        content = "Tienes pendientes del negocio para revisar en Kova."
        content += (
            "\n\n"
            + settings.frontend_url
            + "/assistant\nPuedes desactivar estos correos en Asistente → Preferencias."
        )
    # Persist an ambiguous state BEFORE network I/O. Never resend it blindly.
    mail.status = "sending"
    mail.updated_at = now()
    db.commit()
    try:
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
            result = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": "Bearer " + settings.resend_api_key,
                    "Idempotency-Key": "kova-assistant-" + str(mail.id),
                },
                json={"from": settings.email_from, "to": [to], "subject": subject, "text": content},
            )
        mail.status = "accepted" if result.status_code in {200, 201} else "failed"
    except httpx.HTTPError:
        mail.status = "ambiguous"
    repo.update(mail, ciphertext=None)
    db.commit()
