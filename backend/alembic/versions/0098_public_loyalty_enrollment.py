"""Explicit owner opt-in and scoped device-only public loyalty membership."""

import sqlalchemy as sa

from alembic import op

revision = "0098_public_loyalty_enrollment"
down_revision = "0097_loyalty_pos_rewards"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "loyalty_enrollment_policies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("authorized_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_enrollment_policy_owner"),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "version", name="uq_enrollment_policy_version"
        ),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.CheckConstraint("version >= 1", name="ck_enrollment_policy_version"),
    )
    op.create_table(
        "loyalty_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("enrollment_policy_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        *[
            sa.Column(name, sa.String(64), nullable=False)
            for name in (
                "credential_hash",
                "bootstrap_hash",
                "operation_hash",
                "request_hash",
                "customer_revision",
            )
        ],
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", "code", name="uq_loyalty_member_code"),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "customer_id", name="uq_loyalty_member_customer"
        ),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "credential_hash", name="uq_member_credential"
        ),
        sa.UniqueConstraint("tenant_id", "branch_id", "bootstrap_hash", name="uq_member_bootstrap"),
        sa.UniqueConstraint("tenant_id", "branch_id", "operation_hash", name="uq_member_operation"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "enrollment_policy_id"],
            [
                "loyalty_enrollment_policies.tenant_id",
                "loyalty_enrollment_policies.branch_id",
                "loyalty_enrollment_policies.id",
            ],
        ),
        sa.CheckConstraint("expires_at > created_at", name="ck_member_expiry"),
        sa.CheckConstraint("length(code) = 22", name="ck_member_code"),
    )
    for table in ("loyalty_enrollment_policies", "loyalty_members"):
        for column in ("tenant_id", "branch_id"):
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
            IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
            IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
            IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN REVOKE ALL ON {table} FROM service_role; END IF;
            IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT,INSERT ON {table} TO kova_app; END IF;
        END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM loyalty_members) OR EXISTS(SELECT 1 FROM loyalty_enrollment_policies)
        THEN RAISE EXCEPTION 'Cannot discard public loyalty membership or consent'; END IF;
    END $$;""")
    op.drop_table("loyalty_members")
    op.drop_table("loyalty_enrollment_policies")
