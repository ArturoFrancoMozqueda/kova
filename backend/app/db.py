import logging
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings, sqlalchemy_database_url

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


# Runtime application engine. Connects as the least-privilege `kova_app` role
# (when app_database_url is configured) so RLS tenant_isolation policies are
# enforced for every ordinary request.
engine = create_engine(
    sqlalchemy_database_url(settings.effective_app_database_url),
    pool_pre_ping=True,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_timeout=settings.database_pool_timeout,
    pool_recycle=settings.database_pool_recycle_seconds,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


# Privileged engine. Connects as the owner/superuser (BYPASSRLS) role and is the
# ONLY sanctioned way to run the deliberately tenant-agnostic paths that have no
# request tenant context: the Stripe webhook + internal endpoints, public asset
# reads (product image / receipt logo served cross-tenant by id), unauthenticated
# invitation preview/accept, and pre-session auth (signup/login/refresh). Tenant
# isolation on these paths is enforced at the application layer, as it is today.
# Kept small — it is not a general-purpose connection.
privileged_engine = create_engine(
    sqlalchemy_database_url(settings.effective_migration_database_url),
    pool_pre_ping=True,
    pool_size=2,
    max_overflow=2,
    pool_timeout=settings.database_pool_timeout,
    pool_recycle=settings.database_pool_recycle_seconds,
    future=True,
)
PrivilegedSessionLocal = sessionmaker(
    bind=privileged_engine, autoflush=False, autocommit=False
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_privileged_db() -> Generator[Session, None, None]:
    """RLS-bypassing session for tenant-agnostic paths only. See privileged_engine."""
    db = PrivilegedSessionLocal()
    try:
        yield db
    finally:
        db.close()


def assert_rls_active() -> None:
    """Boot-time posture check: log the runtime connection role and whether RLS
    is actually forced on a representative tenant table. In production, warn
    loudly if the app connected as an owner/superuser (which would silently
    bypass RLS) or if FORCE is not active. Never raises — observability only."""
    try:
        with engine.connect() as conn:
            role = conn.execute(text("SELECT current_user")).scalar()
            is_super = conn.execute(
                text(
                    "SELECT rolsuper OR rolbypassrls FROM pg_roles "
                    "WHERE rolname = current_user"
                )
            ).scalar()
            forced = conn.execute(
                text(
                    "SELECT relforcerowsecurity FROM pg_class "
                    "WHERE relname = 'products'"
                )
            ).scalar()
    except Exception:  # pragma: no cover - diagnostics must never break boot
        logger.exception("Could not verify RLS posture at startup")
        return

    logger.info(
        "DB runtime role=%s bypasses_rls=%s products.force_rls=%s",
        role,
        is_super,
        forced,
    )
    if settings.app_env not in {"local", "ci"}:
        if is_super:
            logger.error(
                "SECURITY: app connected as an owner/superuser/BYPASSRLS role "
                "(%s); RLS tenant isolation is NOT enforced at runtime.",
                role,
            )
        if not forced:
            logger.error(
                "SECURITY: FORCE ROW LEVEL SECURITY is not active on tenant "
                "tables; RLS may be bypassable."
            )
