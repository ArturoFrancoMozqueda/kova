"""Branch-scoped commercial opportunities and explicit channel consent.

Revision ID: 0081_commercial_crm
Revises: 0080_business_automations
"""

import sqlalchemy as sa

from alembic import op

revision = "0081_commercial_crm"
down_revision = "0080_business_automations"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "crm_opportunities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("estimated_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("assigned_user_id", sa.Uuid()),
        sa.Column("next_action", sa.String(300)),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("note", sa.String(1000)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id", name="uq_crm_opportunities_tenant_id_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_crm_opportunities_branch",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"],
            ["customers.tenant_id", "customers.id"],
            name="fk_crm_opportunities_customer",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            name="fk_crm_opportunities_assignee",
        ),
        sa.CheckConstraint(
            "stage IN ('new','contacted','proposal','won','lost')", name="ck_crm_stage"
        ),
        sa.CheckConstraint("estimated_amount >= 0", name="ck_crm_estimated_amount"),
        sa.CheckConstraint("version >= 1", name="ck_crm_opportunity_version"),
    )
    op.create_table(
        "customer_contact_consents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("purpose", sa.String(24), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("contact_fingerprint", sa.String(64)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("recorded_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id", name="uq_contact_consents_tenant_id_id"),
        sa.UniqueConstraint(
            "tenant_id",
            "branch_id",
            "customer_id",
            "channel",
            "purpose",
            name="uq_customer_contact_consent_scope",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_contact_consents_branch",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"],
            ["customers.tenant_id", "customers.id"],
            name="fk_contact_consents_customer",
        ),
        sa.CheckConstraint("channel IN ('whatsapp','email')", name="ck_contact_consent_channel"),
        sa.CheckConstraint(
            "purpose IN ('transactional','marketing')", name="ck_contact_consent_purpose"
        ),
        sa.CheckConstraint("source = 'owner_recorded'", name="ck_contact_consent_source"),
        sa.CheckConstraint("version >= 1", name="ck_contact_consent_version"),
    )
    for table in ("crm_opportunities", "customer_contact_consents"):
        for column in ("tenant_id", "branch_id", "customer_id"):
            op.create_index(f"ix_{table}_{column}", table, [column])
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
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN GRANT SELECT, INSERT, UPDATE ON {table} TO kova_app; END IF;
        END $$;""")
    op.create_index(
        "ix_crm_opportunities_branch_stage_due",
        "crm_opportunities",
        ["tenant_id", "branch_id", "stage", "due_at"],
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM crm_opportunities) OR EXISTS (SELECT 1 FROM customer_contact_consents)
        THEN RAISE EXCEPTION 'Cannot discard commercial records or contact consent'; END IF;
    END $$;""")
    op.drop_table("customer_contact_consents")
    op.drop_table("crm_opportunities")
