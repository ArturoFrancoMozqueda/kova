"""Opt-in table requests with manual confirmation and actual occupancy."""

from alembic import op

revision = "0104_table_reservation_requests"
down_revision = "0103_booking_and_loyalty_design"
branch_labels = None
depends_on = None

TABLES = ("table_reservations", "table_reservation_history")


def upgrade():
    op.execute(
        "ALTER TABLE appointment_resources ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'appointment' CHECK(kind IN ('appointment','table'))"
    )
    op.execute(
        "ALTER TABLE booking_pages ADD COLUMN mode varchar(16) NOT NULL DEFAULT 'appointments' CHECK(mode IN ('appointments','tables'))"
    )
    op.execute("""CREATE TABLE table_reservations (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL,
        resource_id uuid, customer_id uuid, guest_name varchar(160) NOT NULL,
        phone varchar(30) NOT NULL, party_size integer NOT NULL CHECK(party_size BETWEEN 1 AND 50),
        timezone varchar(48) NOT NULL, starts_at timestamptz NOT NULL,
        status varchar(16) NOT NULL CHECK(status IN ('requested','confirmed','seated','completed','declined','cancelled','no_show')),
        version integer NOT NULL CHECK(version>=1), manage_version integer NOT NULL CHECK(manage_version>=1),
        operation_hash varchar(64) NOT NULL UNIQUE, request_hash varchar(64) NOT NULL,
        created_at timestamptz NOT NULL, seated_at timestamptz, released_at timestamptz,
        UNIQUE(tenant_id,branch_id,id),
        CHECK(status NOT IN ('confirmed','seated','completed','no_show') OR resource_id IS NOT NULL),
        CHECK((status='seated' AND seated_at IS NOT NULL AND released_at IS NULL)
           OR (status='completed' AND seated_at IS NOT NULL AND released_at IS NOT NULL AND released_at>=seated_at)
           OR (status NOT IN ('seated','completed') AND seated_at IS NULL AND released_at IS NULL)),
        FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
        FOREIGN KEY(tenant_id,branch_id,resource_id) REFERENCES appointment_resources(tenant_id,branch_id,id),
        FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
    )""")
    op.execute("""CREATE TABLE table_reservation_history (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL,
        reservation_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1),
        action varchar(32) NOT NULL, actor_user_id uuid, resource_id uuid,
        starts_at timestamptz NOT NULL, status varchar(16) NOT NULL,
        created_at timestamptz NOT NULL, UNIQUE(reservation_id,version),
        FOREIGN KEY(tenant_id,branch_id,reservation_id) REFERENCES table_reservations(tenant_id,branch_id,id),
        FOREIGN KEY(tenant_id,branch_id,resource_id) REFERENCES appointment_resources(tenant_id,branch_id,id),
        FOREIGN KEY(tenant_id,actor_user_id) REFERENCES memberships(tenant_id,user_id)
    )""")
    for table in TABLES:
        op.execute(f"CREATE INDEX ix_{table}_tenant_id ON {table}(tenant_id)")
        op.execute(f"CREATE INDEX ix_{table}_branch_id ON {table}(branch_id)")
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} FOR ALL USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true))"
        )
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        for role in ("anon", "authenticated", "service_role"):
            op.execute(
                f"DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN REVOKE ALL ON {table} FROM {role}; END IF; END $$"
            )
        op.execute(
            f"DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT,INSERT ON {table} TO kova_app; END IF; END $$"
        )
    op.execute(
        "CREATE INDEX ix_table_reservations_arrivals ON table_reservations(tenant_id,branch_id,starts_at,id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_table_reservation_arrival ON table_reservations(tenant_id,branch_id,resource_id,starts_at) WHERE status IN ('confirmed','seated')"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_table_reservation_occupied ON table_reservations(tenant_id,branch_id,resource_id) WHERE status='seated'"
    )
    op.execute("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
        GRANT UPDATE(mode) ON booking_pages TO kova_app;
        GRANT UPDATE(resource_id,starts_at,status,version,manage_version,seated_at,released_at) ON table_reservations TO kova_app;
        END IF; END $$""")


def downgrade():
    op.execute("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM table_reservations)
        OR EXISTS(SELECT 1 FROM table_reservation_history)
        OR EXISTS(SELECT 1 FROM appointment_resources WHERE kind='table')
        OR EXISTS(SELECT 1 FROM booking_pages WHERE mode='tables')
        THEN RAISE EXCEPTION 'Cannot discard table reservation configuration or history'; END IF; END $$""")
    for table in reversed(TABLES):
        op.drop_table(table)
    op.drop_column("booking_pages", "mode")
    op.drop_column("appointment_resources", "kind")
