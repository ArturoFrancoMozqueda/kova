"""Additive coexistence synchronization, address book and encrypted durable inbox."""

import sqlalchemy as sa

from alembic import op

revision = "0106_whatsapp_coexistence"
down_revision = "0105_inventory_read_indexes"
branch_labels = None
depends_on = None
TABLES = ("messaging_app_sync", "messaging_app_contacts", "messaging_webhook_batches")


def _owner():
    return sa.ForeignKeyConstraint(
        ["tenant_id", "branch_id", "binding_id"],
        [
            "messaging_channel_bindings.tenant_id",
            "messaging_channel_bindings.branch_id",
            "messaging_channel_bindings.id",
        ],
    )


def upgrade():
    op.add_column(
        "messaging_messages",
        sa.Column("source", sa.String(16), nullable=False, server_default="kova"),
    )
    op.create_check_constraint(
        "ck_messaging_message_source",
        "messaging_messages",
        "source IN ('kova','whatsapp_app','history')",
    )
    op.create_table(
        "messaging_app_sync",
        sa.Column("binding_id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("contacts_state", sa.String(24), nullable=False),
        sa.Column("history_state", sa.String(24), nullable=False),
        sa.Column("contacts_request_id", sa.String(256)),
        sa.Column("history_request_id", sa.String(256)),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _owner(),
        sa.CheckConstraint(
            "contacts_state IN ('pending','requesting','requested','review_required')",
            name="ck_app_contacts_state",
        ),
        sa.CheckConstraint(
            "history_state IN ('pending','requesting','requested','completed','declined','review_required')",
            name="ck_app_history_state",
        ),
        sa.CheckConstraint("progress >= 0 AND progress <= 100", name="ck_app_sync_progress"),
    )
    op.create_table(
        "messaging_app_contacts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("binding_id", sa.Uuid(), nullable=False),
        sa.Column("external_party", sa.String(256), nullable=False),
        sa.Column("name", sa.String(256)),
        sa.Column("removed", sa.Boolean(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        _owner(),
        sa.UniqueConstraint("binding_id", "external_party", name="uq_app_contact_party"),
    )
    op.create_table(
        "messaging_webhook_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("binding_id", sa.Uuid(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("encrypted_payload", sa.Text()),
        sa.Column("cursor", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        _owner(),
        sa.UniqueConstraint("binding_id", "payload_hash", name="uq_app_webhook_batch"),
        sa.CheckConstraint(
            "state IN ('pending','completed','review_required')", name="ck_app_webhook_state"
        ),
        sa.CheckConstraint("cursor >= 0", name="ck_app_webhook_cursor"),
    )
    op.create_index(
        "ix_app_webhook_pending",
        "messaging_webhook_batches",
        ["tenant_id", "branch_id", "state", "created_at"],
    )
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY tenant_isolation ON {table} FOR ALL
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT ON {table} TO kova_app; END IF;
        END $$;""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT INSERT ON messaging_app_contacts, messaging_webhook_batches TO kova_app;
            GRANT UPDATE(name, removed, changed_at) ON messaging_app_contacts TO kova_app;
            GRANT UPDATE(history_state, progress, updated_at) ON messaging_app_sync TO kova_app;
            GRANT UPDATE(cursor, state, encrypted_payload) ON messaging_webhook_batches TO kova_app;
        END IF;
    END $$;""")


def downgrade():
    # Schema rollback never changes a number at Meta or discards an active sync.
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM messaging_app_sync)
            OR EXISTS (SELECT 1 FROM messaging_app_contacts)
            OR EXISTS (SELECT 1 FROM messaging_webhook_batches WHERE state <> 'completed')
            OR EXISTS (SELECT 1 FROM messaging_messages WHERE source <> 'kova')
        THEN RAISE EXCEPTION 'Resolve coexistence and retain imported data before downgrade'; END IF;
    END $$;""")
    for table in reversed(TABLES):
        op.drop_table(table)
    op.drop_constraint("ck_messaging_message_source", "messaging_messages", type_="check")
    op.drop_column("messaging_messages", "source")
