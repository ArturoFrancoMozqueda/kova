import logging
from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings, sqlalchemy_database_url

logger = logging.getLogger(__name__)

# Canonical inventory of tables whose rows belong to a tenant. Keep this list
# aligned with tenant-scoped migrations; production startup rejects drift.
TENANT_SCOPED_TABLES = (
    "account_deletion_requests",
    "audit_logs",
    "cash_movements",
    "categories",
    "customer_order_item_modifiers",
    "customer_order_items",
    "customer_orders",
    "expenses",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_adjustments",
    "fiscal_global_draft_orders",
    "fiscal_global_draft_settings",
    "fiscal_individual_invoice_events",
    "idempotency_keys",
    "inventory_movements",
    "inventory_reservations",
    "membership_invitations",
    "memberships",
    "modifier_groups",
    "modifier_options",
    "order_item_modifiers",
    "order_item_fiscal_snapshots",
    "order_item_tax_snapshots",
    "order_items",
    "order_fiscal_snapshots",
    "orders",
    "payments",
    "product_image_files",
    "product_modifier_groups",
    "products",
    "refund_items",
    "refunds",
    "sessions",
    "shifts",
    "subscriptions",
    "telemetry_events",
    "tenant_business_profiles",
    "tenant_logo_files",
    "tenant_onboarding_state",
    "tenant_receipt_settings",
    "voids",
    "webhook_events",
)


class Base(DeclarativeBase):
    pass


_TENANT_CONTEXT_INFO_KEY = "kova_tenant_id"


@event.listens_for(Session, "after_begin")
def _restore_transaction_tenant_context(
    session: Session, _transaction: object, connection: Connection
) -> None:
    """Reapply transaction-local RLS context after every commit or rollback."""
    tenant_id = session.info.get(_TENANT_CONTEXT_INFO_KEY)
    if tenant_id is not None:
        connection.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_id},
        )


def set_tenant_context(db: Session, tenant_id: object) -> None:
    """Bind a validated request tenant to this Session and all its transactions."""
    normalized = str(tenant_id)
    already_in_transaction = db.in_transaction()
    db.info[_TENANT_CONTEXT_INFO_KEY] = normalized
    if already_in_transaction:
        db.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": normalized},
        )


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
    hide_parameters=True,
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
    hide_parameters=True,
    future=True,
)
PrivilegedSessionLocal = sessionmaker(bind=privileged_engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.info.pop(_TENANT_CONTEXT_INFO_KEY, None)
        db.close()


def get_privileged_db() -> Generator[Session, None, None]:
    """RLS-bypassing session for tenant-agnostic paths only. See privileged_engine."""
    db = PrivilegedSessionLocal()
    try:
        yield db
    finally:
        db.info.pop(_TENANT_CONTEXT_INFO_KEY, None)
        db.close()


def _rls_posture_errors(
    *,
    role_is_super: bool,
    role_bypasses_rls: bool,
    owned_tables: set[str],
    table_posture: dict[str, tuple[bool, bool, bool, bool]],
) -> list[str]:
    errors: list[str] = []
    if role_is_super:
        errors.append("runtime role is a superuser")
    if role_bypasses_rls:
        errors.append("runtime role has BYPASSRLS")
    if owned_tables:
        errors.append("runtime role owns tenant tables: " + ", ".join(sorted(owned_tables)))
    for table in TENANT_SCOPED_TABLES:
        posture = table_posture.get(table)
        if posture is None:
            errors.append(f"{table}: table missing")
            continue
        labels = ("RLS", "FORCE RLS", "policy USING", "policy WITH CHECK")
        missing = [label for label, present in zip(labels, posture, strict=True) if not present]
        if missing:
            errors.append(f"{table}: missing " + ", ".join(missing))
    return errors


def assert_rls_active() -> None:
    """Verify the complete runtime RLS posture and fail closed in production."""
    try:
        with engine.connect() as conn:
            role_row = conn.execute(
                text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
            ).one()
            owned_tables = set(
                conn.execute(
                    text(
                        "SELECT c.relname FROM pg_class c "
                        "JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                        "AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) "
                        "AND c.relname = ANY(:tables)"
                    ),
                    {"tables": list(TENANT_SCOPED_TABLES)},
                ).scalars()
            )
            rows = conn.execute(
                text(
                    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, "
                    "COALESCE(bool_or(p.polqual IS NOT NULL), false), "
                    "COALESCE(bool_or(p.polwithcheck IS NOT NULL), false) "
                    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "LEFT JOIN pg_policy p ON p.polrelid = c.oid "
                    "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                    "AND c.relname = ANY(:tables) "
                    "GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity"
                ),
                {"tables": list(TENANT_SCOPED_TABLES)},
            ).all()
    except Exception as exc:
        if settings.app_env == "production":
            raise RuntimeError("Could not verify RLS posture at startup") from exc
        logger.warning("Could not verify RLS posture at startup", exc_info=True)
        return

    errors = _rls_posture_errors(
        role_is_super=bool(role_row[0]),
        role_bypasses_rls=bool(role_row[1]),
        owned_tables=owned_tables,
        table_posture={row[0]: tuple(bool(value) for value in row[1:]) for row in rows},
    )
    if errors:
        message = "Incomplete RLS posture: " + "; ".join(errors)
        if settings.app_env == "production":
            raise RuntimeError(message)
        logger.warning(message)
        return
    logger.info("RLS posture verified for %d tenant tables", len(TENANT_SCOPED_TABLES))
