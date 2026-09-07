"""enforce tenant-safe relations and reconcile runtime privileges

Revision ID: 0065_tenant_relations_grants
Revises: 0064_fiscal_contribution
Create Date: 2026-09-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0065_tenant_relations_grants"
down_revision: str | None = "0064_fiscal_contribution"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DIRECT_TENANT_TABLES = (
    "account_deletion_requests",
    "audit_logs",
    "cash_movements",
    "categories",
    "customer_order_item_modifiers",
    "customer_order_items",
    "customer_orders",
    "expenses",
    "fiscal_global_draft_adjustments",
    "fiscal_global_draft_batches",
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
    "order_fiscal_snapshots",
    "order_item_fiscal_snapshots",
    "order_item_modifiers",
    "order_item_tax_snapshots",
    "order_items",
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

_CRUD_TABLES = (
    "account_deletion_requests",
    "categories",
    "customer_order_item_modifiers",
    "customer_order_items",
    "customer_orders",
    "expenses",
    "membership_invitations",
    "modifier_groups",
    "modifier_options",
    "product_image_files",
    "product_modifier_groups",
    "products",
    "tenant_business_profiles",
    "tenant_logo_files",
    "tenant_onboarding_state",
    "tenant_receipt_settings",
    "inventory_reservations",
)
_SELECT_INSERT_UPDATE_TABLES = (
    "idempotency_keys",
    "memberships",
    "orders",
    "sessions",
    "shifts",
    "subscriptions",
)
_APPEND_TABLES = (
    "audit_logs",
    "cash_movements",
    "inventory_movements",
    "order_item_modifiers",
    "order_items",
    "payments",
    "refund_items",
    "refunds",
    "telemetry_events",
    "voids",
)
_FISCAL_APPEND_TABLES = (
    "order_fiscal_snapshots",
    "order_item_fiscal_snapshots",
    "order_item_tax_snapshots",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_orders",
    "fiscal_individual_invoice_events",
    "fiscal_global_draft_adjustments",
)
_BACKEND_ONLY_TABLES = (
    "alembic_version",
    "ops_incident_states",
    "ops_mfa_factors",
    "ops_mfa_recovery_codes",
    "ops_notes",
    "permissions",
    "role_permissions",
    "roles",
    "verification_tokens",
)


def _assert_consistent_data() -> None:
    checks = {
        "products.category_id": """
            SELECT 1 FROM products child JOIN categories parent ON parent.id = child.category_id
            WHERE child.category_id IS NOT NULL AND child.tenant_id <> parent.tenant_id
        """,
        "product_image_files.product_id": """
            SELECT 1 FROM product_image_files child JOIN products parent ON parent.id = child.product_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "order_items.order_id": """
            SELECT 1 FROM order_items child JOIN orders parent ON parent.id = child.order_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "order_items.product_id": """
            SELECT 1 FROM order_items child JOIN products parent ON parent.id = child.product_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "payments.order_id": """
            SELECT 1 FROM payments child JOIN orders parent ON parent.id = child.order_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "inventory_movements.product_id": """
            SELECT 1 FROM inventory_movements child JOIN products parent ON parent.id = child.product_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "inventory_movements.order_id": """
            SELECT 1 FROM inventory_movements child JOIN orders parent ON parent.id = child.order_id
            WHERE child.order_id IS NOT NULL AND child.tenant_id <> parent.tenant_id
        """,
        "refunds.order_id": """
            SELECT 1 FROM refunds child JOIN orders parent ON parent.id = child.order_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "voids.order_id": """
            SELECT 1 FROM voids child JOIN orders parent ON parent.id = child.order_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "refund_items.order ownership": """
            SELECT 1 FROM refund_items child
            JOIN refunds refund ON refund.id = child.refund_id
            JOIN order_items item ON item.id = child.order_item_id
            WHERE refund.tenant_id <> item.tenant_id OR refund.order_id <> item.order_id
        """,
        "orders.shift_id": """
            SELECT 1 FROM orders child
            WHERE child.shift_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM shifts parent
                WHERE parent.id = child.shift_id AND parent.tenant_id = child.tenant_id
            )
        """,
        "cash_movements.shift_id": """
            SELECT 1 FROM cash_movements child JOIN shifts parent ON parent.id = child.shift_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "customer_orders.sale_order_id": """
            SELECT 1 FROM customer_orders child JOIN orders parent ON parent.id = child.sale_order_id
            WHERE child.sale_order_id IS NOT NULL AND child.tenant_id <> parent.tenant_id
        """,
        "customer_order_items.customer_order_id": """
            SELECT 1 FROM customer_order_items child JOIN customer_orders parent
              ON parent.id = child.customer_order_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "customer_order_items.product_id": """
            SELECT 1 FROM customer_order_items child JOIN products parent ON parent.id = child.product_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "customer_order_item_modifiers.customer_order_item_id": """
            SELECT 1 FROM customer_order_item_modifiers child JOIN customer_order_items parent
              ON parent.id = child.customer_order_item_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "customer_order_item_modifiers.modifier_group_id": """
            SELECT 1 FROM customer_order_item_modifiers child JOIN modifier_groups parent
              ON parent.id = child.modifier_group_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "customer_order_item_modifiers.modifier_option_id": """
            SELECT 1 FROM customer_order_item_modifiers child JOIN modifier_options parent
              ON parent.id = child.modifier_option_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "inventory_reservations.customer_order_id": """
            SELECT 1 FROM inventory_reservations child JOIN customer_orders parent
              ON parent.id = child.customer_order_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
        "inventory_reservations.product_id": """
            SELECT 1 FROM inventory_reservations child JOIN products parent
              ON parent.id = child.product_id
            WHERE child.tenant_id <> parent.tenant_id
        """,
    }
    for relation, query in checks.items():
        op.execute(
            sa.text(
                "DO $check$ BEGIN IF EXISTS (" + query + ") THEN "
                "RAISE EXCEPTION 'tenant ownership mismatch: " + relation + "'; "
                "END IF; END $check$;"
            )
        )


def _add_fk(
    name: str,
    child: str,
    child_columns: tuple[str, str],
    parent: str,
    parent_columns: tuple[str, str] = ("tenant_id", "id"),
    *,
    ondelete: str | None = None,
) -> None:
    delete_clause = f" ON DELETE {ondelete}" if ondelete else ""
    op.execute(
        f"ALTER TABLE {child} ADD CONSTRAINT {name} FOREIGN KEY "
        f"({', '.join(child_columns)}) REFERENCES {parent} "
        f"({', '.join(parent_columns)}){delete_clause} NOT VALID"
    )
    op.execute(f"ALTER TABLE {child} VALIDATE CONSTRAINT {name}")


def _reconcile_runtime_grants() -> None:
    all_runtime_tables = (
        *_CRUD_TABLES,
        *_SELECT_INSERT_UPDATE_TABLES,
        *_APPEND_TABLES,
        *_FISCAL_APPEND_TABLES,
        "fiscal_global_draft_settings",
        "anonymous_telemetry_events",
        "tenants",
        "users",
    )
    op.execute(
        """
        DO $grants$
        DECLARE role_name text;
        BEGIN
          FOREACH role_name IN ARRAY ARRAY['kova_app', 'anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
              EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
              EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
              EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', role_name);
            END IF;
          END LOOP;
        END $grants$;
        """
    )
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC")
    op.execute("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC")
    op.execute(
        """
        DO $defaults$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM kova_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM kova_app;
          END IF;
        END $defaults$;
        """
    )
    op.execute(
        """
        DO $defaults$
        DECLARE role_name text;
        BEGIN
          FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
              EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
                role_name
              );
              EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
                role_name
              );
            END IF;
          END LOOP;
        END $defaults$;
        """
    )
    op.execute(
        """
        DO $runtime$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            GRANT USAGE ON SCHEMA public TO kova_app;
          END IF;
        END $runtime$;
        """
    )
    # The migration can run before the runtime role is provisioned. Each grant
    # is guarded so a fresh database still upgrades; provisioning applies the
    # identical matrix afterwards.
    for tables, privileges in (
        (_CRUD_TABLES, "SELECT, INSERT, UPDATE, DELETE"),
        (_SELECT_INSERT_UPDATE_TABLES, "SELECT, INSERT, UPDATE"),
        (_APPEND_TABLES, "SELECT, INSERT"),
        (_FISCAL_APPEND_TABLES, "SELECT, INSERT"),
        (("fiscal_global_draft_settings",), "SELECT, INSERT, UPDATE"),
        (("anonymous_telemetry_events",), "INSERT"),
        (("tenants",), "SELECT"),
        (("users",), "SELECT"),
    ):
        table_list = ", ".join(tables)
        op.execute(
            f"""
            DO $grant$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                GRANT {privileges} ON TABLE {table_list} TO kova_app;
              END IF;
            END $grant$;
            """
        )
    op.execute(
        """
        DO $locks$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            GRANT UPDATE (id) ON order_fiscal_snapshots, fiscal_global_draft_batches
              TO kova_app;
          END IF;
        END $locks$;
        """
    )
    # Materialize the inventory during migration import so dead constants cannot
    # silently drift from the explicit grants above.
    if len(set(all_runtime_tables)) != len(all_runtime_tables):
        raise RuntimeError("duplicate table in runtime grant inventory")


def upgrade() -> None:
    _assert_consistent_data()

    op.add_column("refund_items", sa.Column("tenant_id", sa.Uuid(), nullable=True))
    op.execute(
        "UPDATE refund_items child SET tenant_id = parent.tenant_id "
        "FROM refunds parent WHERE parent.id = child.refund_id"
    )
    op.alter_column("refund_items", "tenant_id", nullable=False)
    op.create_index("ix_refund_items_tenant_id", "refund_items", ["tenant_id"])

    for name, table in (
        ("uq_categories_tenant_id_id", "categories"),
        ("uq_refunds_tenant_id_id", "refunds"),
        ("uq_shifts_tenant_id_id", "shifts"),
        ("uq_customer_orders_tenant_id_id", "customer_orders"),
        ("uq_customer_order_items_tenant_id_id", "customer_order_items"),
    ):
        op.create_unique_constraint(name, table, ["tenant_id", "id"])

    relations = (
        (
            "fk_products_tenant_category",
            "products",
            ("tenant_id", "category_id"),
            "categories",
            None,
        ),
        (
            "fk_product_images_tenant_product",
            "product_image_files",
            ("tenant_id", "product_id"),
            "products",
            "CASCADE",
        ),
        (
            "fk_order_items_tenant_order",
            "order_items",
            ("tenant_id", "order_id"),
            "orders",
            "CASCADE",
        ),
        (
            "fk_order_items_tenant_product",
            "order_items",
            ("tenant_id", "product_id"),
            "products",
            "RESTRICT",
        ),
        ("fk_payments_tenant_order", "payments", ("tenant_id", "order_id"), "orders", "CASCADE"),
        (
            "fk_inventory_movements_tenant_product",
            "inventory_movements",
            ("tenant_id", "product_id"),
            "products",
            "RESTRICT",
        ),
        (
            "fk_inventory_movements_tenant_order",
            "inventory_movements",
            ("tenant_id", "order_id"),
            "orders",
            "CASCADE",
        ),
        ("fk_refunds_tenant_order", "refunds", ("tenant_id", "order_id"), "orders", "CASCADE"),
        ("fk_voids_tenant_order", "voids", ("tenant_id", "order_id"), "orders", "CASCADE"),
        (
            "fk_refund_items_tenant_refund",
            "refund_items",
            ("tenant_id", "refund_id"),
            "refunds",
            "CASCADE",
        ),
        (
            "fk_refund_items_tenant_order_item",
            "refund_items",
            ("tenant_id", "order_item_id"),
            "order_items",
            "RESTRICT",
        ),
        ("fk_orders_tenant_shift", "orders", ("tenant_id", "shift_id"), "shifts", None),
        (
            "fk_cash_movements_tenant_shift",
            "cash_movements",
            ("tenant_id", "shift_id"),
            "shifts",
            "CASCADE",
        ),
        (
            "fk_customer_orders_tenant_sale",
            "customer_orders",
            ("tenant_id", "sale_order_id"),
            "orders",
            None,
        ),
        (
            "fk_customer_order_items_tenant_order",
            "customer_order_items",
            ("tenant_id", "customer_order_id"),
            "customer_orders",
            "CASCADE",
        ),
        (
            "fk_customer_order_items_tenant_product",
            "customer_order_items",
            ("tenant_id", "product_id"),
            "products",
            "RESTRICT",
        ),
        (
            "fk_customer_order_item_modifiers_tenant_item",
            "customer_order_item_modifiers",
            ("tenant_id", "customer_order_item_id"),
            "customer_order_items",
            "CASCADE",
        ),
        (
            "fk_customer_order_item_modifiers_tenant_group",
            "customer_order_item_modifiers",
            ("tenant_id", "modifier_group_id"),
            "modifier_groups",
            "RESTRICT",
        ),
        (
            "fk_customer_order_item_modifiers_tenant_option",
            "customer_order_item_modifiers",
            ("tenant_id", "modifier_option_id"),
            "modifier_options",
            "RESTRICT",
        ),
        (
            "fk_inventory_reservations_tenant_order",
            "inventory_reservations",
            ("tenant_id", "customer_order_id"),
            "customer_orders",
            "CASCADE",
        ),
        (
            "fk_inventory_reservations_tenant_product",
            "inventory_reservations",
            ("tenant_id", "product_id"),
            "products",
            "RESTRICT",
        ),
    )
    for name, child, child_columns, parent, ondelete in relations:
        _add_fk(name, child, child_columns, parent, ondelete=ondelete)

    # Every direct tenant policy uses text comparison. Missing and explicitly
    # empty transaction context therefore deny cleanly rather than UUID-cast
    # errors, including refund_items now that ownership is explicit.
    for table in _DIRECT_TENANT_TABLES:
        policy = (
            "telemetry_events_tenant_isolation"
            if table == "telemetry_events"
            else "tenant_isolation"
        )
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
        op.execute(
            f"CREATE POLICY {policy} ON {table} "
            "USING (tenant_id::text = current_setting('app.tenant_id', true)) "
            "WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))"
        )

    for table in _BACKEND_ONLY_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE anonymous_telemetry_events FORCE ROW LEVEL SECURITY")
    _reconcile_runtime_grants()


def downgrade() -> None:
    # Grant reconciliation is intentionally not broadened on downgrade. The
    # previous blanket posture was the vulnerability this migration removes.
    for table in reversed(_BACKEND_ONLY_TABLES):
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE anonymous_telemetry_events NO FORCE ROW LEVEL SECURITY")

    for table in reversed(_DIRECT_TENANT_TABLES):
        policy = (
            "telemetry_events_tenant_isolation"
            if table == "telemetry_events"
            else "tenant_isolation"
        )
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
        if table == "refund_items":
            op.execute(
                "CREATE POLICY tenant_isolation ON refund_items "
                "USING (EXISTS (SELECT 1 FROM refunds WHERE refunds.id = refund_items.refund_id "
                "AND refunds.tenant_id = current_setting('app.tenant_id', true)::uuid)) "
                "WITH CHECK (EXISTS (SELECT 1 FROM refunds WHERE refunds.id = refund_items.refund_id "
                "AND refunds.tenant_id = current_setting('app.tenant_id', true)::uuid))"
            )
        else:
            op.execute(
                f"CREATE POLICY {policy} ON {table} "
                "USING (tenant_id = current_setting('app.tenant_id', true)::uuid) "
                "WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)"
            )

    for name, child, *_ in reversed(
        (
            ("fk_products_tenant_category", "products"),
            ("fk_product_images_tenant_product", "product_image_files"),
            ("fk_order_items_tenant_order", "order_items"),
            ("fk_order_items_tenant_product", "order_items"),
            ("fk_payments_tenant_order", "payments"),
            ("fk_inventory_movements_tenant_product", "inventory_movements"),
            ("fk_inventory_movements_tenant_order", "inventory_movements"),
            ("fk_refunds_tenant_order", "refunds"),
            ("fk_voids_tenant_order", "voids"),
            ("fk_refund_items_tenant_refund", "refund_items"),
            ("fk_refund_items_tenant_order_item", "refund_items"),
            ("fk_orders_tenant_shift", "orders"),
            ("fk_cash_movements_tenant_shift", "cash_movements"),
            ("fk_customer_orders_tenant_sale", "customer_orders"),
            ("fk_customer_order_items_tenant_order", "customer_order_items"),
            ("fk_customer_order_items_tenant_product", "customer_order_items"),
            ("fk_customer_order_item_modifiers_tenant_item", "customer_order_item_modifiers"),
            ("fk_customer_order_item_modifiers_tenant_group", "customer_order_item_modifiers"),
            ("fk_customer_order_item_modifiers_tenant_option", "customer_order_item_modifiers"),
            ("fk_inventory_reservations_tenant_order", "inventory_reservations"),
            ("fk_inventory_reservations_tenant_product", "inventory_reservations"),
        )
    ):
        op.drop_constraint(name, child, type_="foreignkey")

    for name, table in reversed(
        (
            ("uq_categories_tenant_id_id", "categories"),
            ("uq_refunds_tenant_id_id", "refunds"),
            ("uq_shifts_tenant_id_id", "shifts"),
            ("uq_customer_orders_tenant_id_id", "customer_orders"),
            ("uq_customer_order_items_tenant_id_id", "customer_order_items"),
        )
    ):
        op.drop_constraint(name, table, type_="unique")
    op.drop_index("ix_refund_items_tenant_id", table_name="refund_items")
    op.drop_column("refund_items", "tenant_id")
