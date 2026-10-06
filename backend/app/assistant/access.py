from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import text

from app.branches.scope import active_branch_id
from app.config import settings
from app.db import get_db
from app.shared.dependencies import get_current_session


def cohort() -> tuple[UUID, ...]:
    return tuple(
        sorted({UUID(x.strip()) for x in settings.assistant_tenant_ids.split(",") if x.strip()})
    )


def enabled(tenant_id: UUID) -> bool:
    return settings.assistant_enabled and tenant_id in cohort()


def bind_user(db, user_id: UUID) -> None:
    db.info["kova_assistant_user_id"] = str(user_id)
    db.execute(
        text("SELECT set_config('app.assistant_user_id', :uid, true)"), {"uid": str(user_id)}
    )


def principal(db=Depends(get_db), ctx=Depends(get_current_session)):
    user, member, session = ctx
    if member.role not in {"owner", "manager"} or member.allowed_branch_id is not None:
        raise HTTPException(
            403, "El asistente requiere un administrador con acceso a todas las sucursales."
        )
    from app.assistant.storage import tenant_deleted

    if tenant_deleted(member.tenant_id):
        raise HTTPException(
            410, "Este negocio fue eliminado. No se puede reactivar desde un respaldo."
        )
    bind_user(db, user.id)
    return user, member, session


def require_enabled(ctx=Depends(principal)):
    if not enabled(ctx[1].tenant_id):
        raise HTTPException(503, "El asistente aún no está habilitado para este negocio.")
    return ctx


def scope(db, ctx) -> tuple[UUID, UUID, UUID]:
    return ctx[1].tenant_id, ctx[0].id, active_branch_id(db, ctx[1].tenant_id)


def assert_private_policies() -> None:
    """Fail closed on restrictive ACL drift as well as the canonical tenant RLS."""
    import logging

    from app.db import engine

    def normalized(value):
        return "".join(c for c in (value or "").lower() if not c.isspace() and c not in "()")

    owner = "owner_user_id::text=current_setting('app.assistant_user_id'::text,true)"
    base = (
        "EXISTS (SELECT 1 FROM assistant_records r WHERE "
        "r.id=assistant_chunks.document_id AND r.tenant_id=assistant_chunks.tenant_id AND "
    )
    chunk_owner = base + owner.replace("owner_user_id", "r.owner_user_id") + ")"
    chunk_read = (
        base
        + "r.kind::text='document'::text AND (r.status::text='ready'::text OR "
        + owner.replace("owner_user_id", "r.owner_user_id")
        + "))"
    )
    expected = {}
    for table, prefix, read, write in (
        ("assistant_records", "assistant_private_", owner + " OR shared", owner),
        ("assistant_chunks", "assistant_chunk_", chunk_read, chunk_owner),
    ):
        expected[(table, prefix + "read")] = ("r", normalized(read), None)
        expected[(table, prefix + "insert")] = ("a", None, normalized(write))
        expected[(table, prefix + "update")] = ("w", normalized(write), normalized(write))
        expected[(table, prefix + "delete")] = ("d", normalized(write), None)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("""SELECT c.relname,p.polname,p.polpermissive,p.polcmd,
                p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
                FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public'
                AND c.relname IN ('assistant_records','assistant_chunks')""")
            ).all()
        actual = {(r[0], r[1]): r for r in rows}
        for key, (command, using, check) in expected.items():
            row = actual.get(key)
            if (
                not row
                or row[2]
                or row[3] != command
                or tuple(row[4]) != (0,)
                or (normalized(row[5]) if row[5] else None) != using
                or (normalized(row[6]) if row[6] else None) != check
            ):
                raise RuntimeError("Assistant private ACL posture is unsafe")
    except Exception as exc:
        if settings.app_env == "production":
            raise RuntimeError("Could not verify assistant ACL at startup") from exc
        logging.getLogger(__name__).warning("Assistant ACL not verified in local environment")
