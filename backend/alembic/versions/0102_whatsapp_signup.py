"""Verified Embedded Signup journal and encrypted merchant credentials."""

import sqlalchemy as sa

from alembic import op

revision = "0102_whatsapp_signup"
down_revision = "0101_checkout_attempts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "messaging_channel_connections",
        sa.Column("binding_id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("encrypted_credentials", sa.Text(), nullable=False),
        sa.Column("send_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("token_expires_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", name="uq_messaging_connection_branch"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "binding_id"],
            [
                "messaging_channel_bindings.tenant_id",
                "messaging_channel_bindings.branch_id",
                "messaging_channel_bindings.id",
            ],
        ),
    )
    op.create_table(
        "messaging_signup_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("nonce_hash", sa.String(64), nullable=False),
        sa.Column("code_hash", sa.String(64)),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("waba_id", sa.String(32)),
        sa.Column("phone_number_id", sa.String(32)),
        sa.Column("encrypted_credentials", sa.Text()),
        sa.Column("token_expires_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.String(64)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "actor_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.UniqueConstraint("code_hash", name="uq_messaging_signup_code"),
        sa.CheckConstraint(
            "state IN ('pending','exchanging','authorized','subscribing','subscribed',"
            "'registering','connected','review_required','failed')",
            name="ck_messaging_signup_state",
        ),
    )
    # Reserve only verified assets, before any subscribe/register side effect.
    op.create_index(
        "uq_messaging_signup_active_phone",
        "messaging_signup_sessions",
        ["phone_number_id"],
        unique=True,
        postgresql_where=sa.text(
            "state IN ('authorized','subscribing','subscribed','registering','review_required')"
        ),
    )
    for table in ("messaging_channel_connections", "messaging_signup_sessions"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY tenant_isolation ON {table} FOR ALL
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
                REVOKE ALL ON {table} FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
                REVOKE ALL ON {table} FROM authenticated;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
                GRANT SELECT ON {table} TO kova_app;
            END IF;
        END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM messaging_channel_connections)
            OR EXISTS (SELECT 1 FROM messaging_signup_sessions WHERE state NOT IN ('pending','failed'))
        THEN RAISE EXCEPTION 'Resolve WhatsApp onboarding and retain credentials before downgrade';
        END IF;
    END $$;""")
    op.drop_table("messaging_signup_sessions")
    op.drop_table("messaging_channel_connections")
