"""Preparation queue: stations, a short daily number and one ticket per sale and station.

A product may name the station that prepares it (Barra, Cocina). A counter sale
with such products gets a daily number per branch (#1, #2...) and one
`prep_tickets` row per station that moves received → preparing → ready →
delivered. Customer orders are not copied here: the queue shows them with their
own status (ADR-045), so the work never has two states.

Additive for the previous app version: no stations means no tickets, and the
older app never reads them. Downgrade is refused once tickets exist.
"""

import sqlalchemy as sa

from alembic import op

revision = "0115_prep_queue"
down_revision = "0114_customer_order_deposits"
branch_labels = None
depends_on = None



def _secure(table: str, grants: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"""CREATE POLICY tenant_isolation ON {table} FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
    for role in ("anon", "authenticated", "service_role"):
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN
                REVOKE ALL ON {table} FROM {role};
            END IF;
        END $$""")
    op.execute(f"""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            {grants}
        END IF;
    END $$""")


def upgrade():
    op.create_table(
        "prep_stations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("name", sa.String(60), nullable=False),
        # Minutes before a ticket is shown as late.
        sa.Column("alert_minutes", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "id", name="uq_prep_stations_tenant_id"),
        sa.CheckConstraint("alert_minutes BETWEEN 1 AND 240", name="ck_prep_stations_alert"),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_prep_stations_name"),
    )
    op.create_index("uq_prep_stations_active_name", "prep_stations",
                    ["tenant_id", sa.text("lower(name)")], unique=True,
                    postgresql_where=sa.text("is_active"))
    _secure(
        "prep_stations",
        "GRANT SELECT, INSERT ON prep_stations TO kova_app; "
        "GRANT UPDATE (name, alert_minutes, position, is_active, updated_at) "
        "ON prep_stations TO kova_app;",
    )

    op.add_column("products", sa.Column("prep_station_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_products_prep_station", "products", "prep_stations",
                          ["tenant_id", "prep_station_id"], ["tenant_id", "id"])

    op.create_table(
        "prep_daily_numbers",
        sa.Column("tenant_id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), primary_key=True),
        sa.Column("local_date", sa.Date(), primary_key=True),
        sa.Column("last_number", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"],
                                name="fk_prep_daily_numbers_branch"),
        sa.CheckConstraint("last_number > 0", name="ck_prep_daily_numbers_positive"),
    )
    _secure(
        "prep_daily_numbers",
        "GRANT SELECT, INSERT ON prep_daily_numbers TO kova_app; "
        "GRANT UPDATE (last_number) ON prep_daily_numbers TO kova_app;",
    )

    op.create_table(
        "prep_tickets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="received"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("preparing_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"],
                                name="fk_prep_tickets_branch"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id", "order_id"],
                                ["orders.tenant_id", "orders.branch_id", "orders.id"],
                                name="fk_prep_tickets_order"),
        sa.ForeignKeyConstraint(["tenant_id", "station_id"],
                                ["prep_stations.tenant_id", "prep_stations.id"],
                                name="fk_prep_tickets_station"),
        sa.UniqueConstraint("order_id", "station_id", name="uq_prep_tickets_order_station"),
        sa.CheckConstraint(
            "status IN ('received', 'preparing', 'ready', 'delivered', 'cancelled')",
            name="ck_prep_tickets_status",
        ),
        sa.CheckConstraint("number > 0", name="ck_prep_tickets_number"),
    )
    op.create_index("ix_prep_tickets_open", "prep_tickets",
                    ["tenant_id", "branch_id", "status", "received_at"])
    _secure(
        "prep_tickets",
        "GRANT SELECT, INSERT ON prep_tickets TO kova_app; "
        "GRANT UPDATE (status, version, preparing_at, ready_at, delivered_at, "
        "updated_by_user_id, updated_at) ON prep_tickets TO kova_app;",
    )


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM prep_tickets) "
        "THEN RAISE EXCEPTION 'Cannot downgrade recorded preparation tickets'; "
        "END IF; END $$;"
    )
    op.drop_index("ix_prep_tickets_open", table_name="prep_tickets")
    op.drop_table("prep_tickets")
    op.drop_table("prep_daily_numbers")
    op.drop_constraint("fk_products_prep_station", "products", type_="foreignkey")
    op.drop_column("products", "prep_station_id")
    op.drop_index("uq_prep_stations_active_name", table_name="prep_stations")
    op.drop_table("prep_stations")
