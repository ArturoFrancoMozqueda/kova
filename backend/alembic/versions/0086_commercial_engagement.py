"""Private catalog intake and internal post-sale followups."""

import sqlalchemy as sa

from alembic import op

revision = "0086_commercial_engagement"
down_revision = "0085_messaging_inbox"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_crm_opportunity_branch_owner", "crm_opportunities", ["tenant_id", "branch_id", "id"]
    )
    op.create_table(
        "crm_catalog_requests",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("catalog_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("submission_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False, primary_key=False),
        sa.Column("name", sa.String(length=160), nullable=False, primary_key=False),
        sa.Column("contact", sa.String(length=160), nullable=False, primary_key=False),
        sa.Column("message", sa.String(length=1000), nullable=False, primary_key=False),
        sa.Column("product_ids", sa.JSON(), nullable=False, primary_key=False),
        sa.Column("status", sa.String(length=16), nullable=False, primary_key=False),
        sa.Column("customer_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("opportunity_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("version", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True, primary_key=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.CheckConstraint(
            "status IN ('new','converted','dismissed')", name="ck_catalog_request_status"
        ),
        sa.CheckConstraint("version >= 1", name="ck_catalog_request_version"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "opportunity_id"],
            ["crm_opportunities.tenant_id", "crm_opportunities.branch_id", "crm_opportunities.id"],
        ),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "catalog_id"], ["public_catalogs.tenant_id", "public_catalogs.id"]
        ),
        sa.UniqueConstraint("tenant_id", "catalog_id", "submission_id"),
        sa.UniqueConstraint("tenant_id", "id"),
    )
    op.create_index("ix_crm_catalog_requests_tenant_id", "crm_catalog_requests", ["tenant_id"])
    op.create_index("ix_crm_catalog_requests_branch_id", "crm_catalog_requests", ["branch_id"])
    op.create_table(
        "crm_followup_policies",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, primary_key=False),
        sa.Column("review_delay_days", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("rebuy_delay_days", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("version", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("authorized_by_user_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("enabled_since", sa.DateTime(timezone=True), nullable=True, primary_key=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.CheckConstraint(
            "review_delay_days BETWEEN 1 AND 30 AND rebuy_delay_days BETWEEN 2 AND 365",
            name="ck_followup_policy_delays",
        ),
        sa.CheckConstraint("version >= 1", name="ck_followup_policy_version"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.UniqueConstraint("tenant_id", "branch_id"),
    )
    op.create_index("ix_crm_followup_policies_tenant_id", "crm_followup_policies", ["tenant_id"])
    op.create_index("ix_crm_followup_policies_branch_id", "crm_followup_policies", ["branch_id"])
    op.create_table(
        "crm_followup_tasks",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("sale_order_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("kind", sa.String(length=16), nullable=False, primary_key=False),
        sa.Column("status", sa.String(length=16), nullable=False, primary_key=False),
        sa.Column("title", sa.String(length=160), nullable=False, primary_key=False),
        sa.Column("note", sa.String(length=1000), nullable=True, primary_key=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("assigned_user_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("version", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True, primary_key=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.CheckConstraint("kind IN ('review','rebuy','incident')", name="ck_followup_task_kind"),
        sa.CheckConstraint(
            "status IN ('pending','completed','dismissed')", name="ck_followup_task_status"
        ),
        sa.CheckConstraint("version >= 1", name="ck_followup_task_version"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.UniqueConstraint("tenant_id", "branch_id", "sale_order_id", "kind"),
    )
    op.create_index("ix_crm_followup_tasks_tenant_id", "crm_followup_tasks", ["tenant_id"])
    op.create_index("ix_crm_followup_tasks_branch_id", "crm_followup_tasks", ["branch_id"])
    for table in ("crm_catalog_requests", "crm_followup_policies", "crm_followup_tasks"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} FOR ALL "
            "USING (tenant_id::text = current_setting('app.tenant_id', true)) "
            "WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))"
        )
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN REVOKE ALL ON {table} FROM service_role; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN GRANT SELECT, INSERT ON {table} TO kova_app; END IF;
        END $$;""")
    grants = {
        "crm_catalog_requests": "status,customer_id,opportunity_id,version,resolved_at",
        "crm_followup_policies": "enabled,review_delay_days,rebuy_delay_days,version,authorized_by_user_id,enabled_since,updated_at",
        "crm_followup_tasks": "status,note,due_at,assigned_user_id,version,resolved_at",
    }
    for table, columns in grants.items():
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                GRANT UPDATE ({columns}) ON {table} TO kova_app;
            END IF;
        END $$;""")
    op.create_index(
        "ix_crm_followup_due", "crm_followup_tasks", ["tenant_id", "branch_id", "status", "due_at"]
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM crm_catalog_requests) OR EXISTS (SELECT 1 FROM crm_followup_policies)
           OR EXISTS (SELECT 1 FROM crm_followup_tasks)
        THEN RAISE EXCEPTION 'Cannot discard commercial intake or followup history'; END IF;
    END $$;""")
    op.drop_table("crm_followup_tasks")
    op.drop_table("crm_followup_policies")
    op.drop_table("crm_catalog_requests")
    op.drop_constraint("uq_crm_opportunity_branch_owner", "crm_opportunities", type_="unique")
