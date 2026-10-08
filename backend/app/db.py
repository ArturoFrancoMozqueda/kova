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
    "assistant_records",
    "assistant_chunks",
    "branches",
    "cash_movements",
    "categories",
    "customer_order_item_modifiers",
    "customer_order_items",
    "customer_orders",
    "customers",
    "suppliers",
    "purchase_orders",
    "purchase_order_items",
    "inventory_transfers",
    "fiscal_issuer_profiles",
    "invoice_requests",
    "cfdi_connections",
    "cfdi_documents",
    "expenses",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_adjustments",
    "fiscal_global_draft_orders",
    "fiscal_global_draft_settings",
    "fiscal_individual_invoice_events",
    "idempotency_keys",
    "inventory_lots",
    "inventory_lot_allocations",
    "inventory_lot_reservations",
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

EXPECTED_TENANT_POLICY_NAMES = {
    table: (
        "telemetry_events_tenant_isolation" if table == "telemetry_events" else "tenant_isolation"
    )
    for table in TENANT_SCOPED_TABLES
}
_EXPECTED_TENANT_POLICY_EXPRESSION = "tenant_id::text=current_setting'app.tenant_id'::text,true"
_EXPECTED_TENANT_VISIBILITY_EXPRESSION = "id::text=current_setting'app.tenant_id'::text,true"
_EXPECTED_USER_VISIBILITY_EXPRESSION = (
    "EXISTSSELECT1FROMmembershipsWHEREmemberships.user_id=users.idAND"
    "memberships.is_activeISTRUEANDmemberships.tenant_id::text="
    "current_setting'app.tenant_id'::text,true"
)
_EXPECTED_ANONYMOUS_TELEMETRY_EXPRESSION = (
    "event_name::text=ANYARRAY['landing_viewed'::charactervarying,"
    "'landing_section_viewed'::charactervarying,"
    "'landing_story_step_viewed'::charactervarying,"
    "'landing_cta_clicked'::charactervarying,'signup_started'::charactervarying,"
    "'signup_validation_failed'::charactervarying,"
    "'experiment_exposed'::charactervarying,"
    "'product_demo_viewed'::charactervarying,"
    "'product_demo_step_changed'::charactervarying,"
    "'pricing_viewed'::charactervarying,'whatsapp_clicked'::charactervarying,"
    "'login_clicked'::charactervarying,'faq_opened'::charactervarying]::text[]ANDNOT"
    "properties::jsonb?|ARRAY['tenant_id'::text,'user_id'::text,'email'::text,"
    "'name'::text,'phone'::text,'password'::text,'amount'::text,"
    "'total_amount'::text,'amount_minor_units'::text,'query'::text,"
    "'query_string'::text,'full_url'::text]"
)
RLS_PROTECTED_TABLES = (
    *TENANT_SCOPED_TABLES,
    "tenants",
    "users",
    "anonymous_telemetry_events",
)
# name, FORCE expected, command, USING expected, WITH CHECK expected,
# exact normalized expression (direct tenant policies only)
EXPECTED_RLS_POLICY_SPECS = {
    table: (
        EXPECTED_TENANT_POLICY_NAMES[table],
        True,
        "*",
        True,
        True,
        _EXPECTED_TENANT_POLICY_EXPRESSION,
    )
    for table in TENANT_SCOPED_TABLES
}
EXPECTED_RLS_POLICY_SPECS.update(
    {
        "tenants": (
            "current_tenant_visibility",
            False,
            "r",
            True,
            False,
            _EXPECTED_TENANT_VISIBILITY_EXPRESSION,
        ),
        "users": (
            "tenant_membership_visibility",
            False,
            "r",
            True,
            False,
            _EXPECTED_USER_VISIBILITY_EXPRESSION,
        ),
        "anonymous_telemetry_events": (
            "anonymous_telemetry_events_insert",
            True,
            "a",
            False,
            True,
            _EXPECTED_ANONYMOUS_TELEMETRY_EXPRESSION,
        ),
    }
)
EXPECTED_ADDITIONAL_RLS_POLICY_SPECS = {
    "tenants": (
        "current_tenant_name_update",
        True,
        "w",
        (0,),
        True,
        True,
        _EXPECTED_TENANT_VISIBILITY_EXPRESSION,
    )
}


class Base(DeclarativeBase):
    pass


_TENANT_CONTEXT_INFO_KEY = "kova_tenant_id"


@event.listens_for(Session, "after_begin")
def _restore_transaction_tenant_context(
    session: Session, _transaction: object, connection: Connection
) -> None:
    """Reapply transaction-local RLS context after every commit or rollback."""
    assistant_user = session.info.get("kova_assistant_user_id")
    if assistant_user is not None:
        connection.execute(
            text("SELECT set_config('app.assistant_user_id', :uid, true)"),
            {"uid": assistant_user},
        )
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
        db.info.pop("kova_branch_id", None)
        db.info.pop("kova_assistant_user_id", None)
        db.info.pop("kova_allowed_branch_id", None)
        db.close()


def get_privileged_db() -> Generator[Session, None, None]:
    """RLS-bypassing session for tenant-agnostic paths only. See privileged_engine."""
    db = PrivilegedSessionLocal()
    try:
        yield db
    finally:
        db.info.pop(_TENANT_CONTEXT_INFO_KEY, None)
        db.info.pop("kova_branch_id", None)
        db.info.pop("kova_allowed_branch_id", None)
        db.close()


def _rls_posture_errors(
    *,
    role_is_super: bool,
    role_bypasses_rls: bool,
    owned_tables: set[str],
    table_posture: dict[str, tuple[bool, bool, bool, bool]],
    policy_catalog: dict[
        str,
        list[tuple[str, bool, str, tuple[int, ...], bool, bool, str | None, str | None]],
    ]
    | None = None,
) -> list[str]:
    errors: list[str] = []
    if role_is_super:
        errors.append("runtime role is a superuser")
    if role_bypasses_rls:
        errors.append("runtime role has BYPASSRLS")
    if owned_tables:
        errors.append("runtime role owns tenant tables: " + ", ".join(sorted(owned_tables)))
    for table in RLS_PROTECTED_TABLES:
        (
            expected_name,
            force_expected,
            expected_command,
            using_expected,
            check_expected,
            expected_expression,
        ) = EXPECTED_RLS_POLICY_SPECS[table]
        posture = table_posture.get(table)
        if posture is None:
            errors.append(f"{table}: table missing")
            continue
        rls_enabled, force_enabled, has_any_using, has_any_check = posture
        missing = []
        if not rls_enabled:
            missing.append("RLS")
        if force_expected and not force_enabled:
            missing.append("FORCE RLS")
        if using_expected and not has_any_using:
            missing.append("policy USING")
        if check_expected and not has_any_check:
            missing.append("policy WITH CHECK")
        if missing:
            errors.append(f"{table}: missing " + ", ".join(missing))
        if policy_catalog is None:
            continue
        policies = policy_catalog.get(table, [])
        expected = [policy for policy in policies if policy[0] == expected_name]
        additional_spec = EXPECTED_ADDITIONAL_RLS_POLICY_SPECS.get(table)
        expected_names = {expected_name}
        if additional_spec is not None:
            expected_names.add(additional_spec[0])
        unexpected_permissive = sorted(
            policy[0] for policy in policies if policy[1] and policy[0] not in expected_names
        )
        if unexpected_permissive:
            errors.append(
                f"{table}: unexpected permissive policies " + ", ".join(unexpected_permissive)
            )
        if len(expected) != 1:
            errors.append(f"{table}: expected exactly one {expected_name} policy")
            continue
        (
            _,
            permissive,
            command,
            roles,
            has_using,
            has_check,
            using_expression,
            check_expression,
        ) = expected[0]
        if (
            not permissive
            or command != expected_command
            or roles != (0,)
            or has_using != using_expected
            or has_check != check_expected
        ):
            errors.append(f"{table}: canonical policy has unsafe scope")
            continue
        normalized_expressions = [
            "".join(
                character
                for character in (expression or "")
                if not character.isspace() and character not in "()"
            )
            for expression, required in (
                (using_expression, using_expected),
                (check_expression, check_expected),
            )
            if required
        ]
        if any(expression.lower() in {"true", "1=1"} for expression in normalized_expressions):
            errors.append(f"{table}: canonical policy has unsafe expression")
        elif expected_expression is not None and set(normalized_expressions) != {
            expected_expression
        }:
            errors.append(f"{table}: canonical policy has unsafe expression")
        if additional_spec is not None:
            (
                additional_name,
                additional_permissive,
                additional_command,
                additional_roles,
                additional_using,
                additional_check,
                additional_expression,
            ) = additional_spec
            additional = [policy for policy in policies if policy[0] == additional_name]
            if len(additional) != 1:
                errors.append(f"{table}: expected exactly one {additional_name} policy")
                continue
            candidate = additional[0]
            normalized_additional = {
                "".join(
                    character
                    for character in (expression or "")
                    if not character.isspace() and character not in "()"
                )
                for expression in (candidate[6], candidate[7])
                if expression is not None
            }
            if (
                candidate[1] != additional_permissive
                or candidate[2] != additional_command
                or candidate[3] != additional_roles
                or candidate[4] != additional_using
                or candidate[5] != additional_check
                or normalized_additional != {additional_expression}
            ):
                errors.append(f"{table}: {additional_name} policy has unsafe scope")
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
                    {"tables": list(RLS_PROTECTED_TABLES)},
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
                {"tables": list(RLS_PROTECTED_TABLES)},
            ).all()
            policy_rows = conn.execute(
                text(
                    "SELECT c.relname, p.polname, p.polpermissive, p.polcmd, "
                    "p.polroles, p.polqual IS NOT NULL, p.polwithcheck IS NOT NULL, "
                    "pg_get_expr(p.polqual, p.polrelid), "
                    "pg_get_expr(p.polwithcheck, p.polrelid) "
                    "FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND c.relname = ANY(:tables)"
                ),
                {"tables": list(RLS_PROTECTED_TABLES)},
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
        policy_catalog={
            table: [
                (
                    policy_name,
                    bool(permissive),
                    command,
                    tuple(roles),
                    bool(has_using),
                    bool(has_check),
                    using_expression,
                    check_expression,
                )
                for (
                    row_table,
                    policy_name,
                    permissive,
                    command,
                    roles,
                    has_using,
                    has_check,
                    using_expression,
                    check_expression,
                ) in policy_rows
                if row_table == table
            ]
            for table in RLS_PROTECTED_TABLES
        },
    )
    if errors:
        message = "Incomplete RLS posture: " + "; ".join(errors)
        if settings.app_env == "production":
            raise RuntimeError(message)
        logger.warning(message)
        return
    logger.info("RLS posture verified for %d runtime tables", len(RLS_PROTECTED_TABLES))
