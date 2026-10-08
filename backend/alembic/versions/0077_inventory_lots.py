"""Optional lot tracking with reconciled allocations and tenant ownership."""

import sqlalchemy as sa

from alembic import op

revision = "0077_inventory_lots"
down_revision = "0076_assistant_workload_slots"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "products", sa.Column("track_lots", sa.Boolean(), nullable=False, server_default="false")
    )
    op.add_column(
        "products",
        sa.Column(
            "rotation_label", sa.String(24), nullable=False, server_default="consumo_preferente"
        ),
    )
    for field in ("rotation_days", "expiry_days"):
        op.add_column("products", sa.Column(field, sa.Integer(), nullable=True))
        op.create_check_constraint(
            f"ck_products_{field}", "products", f"{field} IS NULL OR {field} BETWEEN 1 AND 36500"
        )
    op.create_check_constraint(
        "ck_products_lot_tracking", "products", "NOT track_lots OR track_inventory"
    )
    op.create_check_constraint(
        "ck_products_rotation_label",
        "products",
        "rotation_label IN ('consumo_preferente','fecha_objetivo')",
    )
    op.add_column(
        "order_items",
        sa.Column("lot_tracked", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "inventory_movements",
        sa.Column("lot_tracked", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("inventory_movements", sa.Column("order_item_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_movement_order_item",
        "inventory_movements",
        "order_items",
        ["tenant_id", "order_item_id"],
        ["tenant_id", "id"],
    )
    op.add_column(
        "inventory_reservations",
        sa.Column("lot_tracked", sa.Boolean(), nullable=False, server_default="false"),
    )
    for table in ("inventory_movements", "inventory_reservations"):
        op.create_unique_constraint(
            f"uq_{table}_lot_owner", table, ["tenant_id", "branch_id", "product_id", "id"]
        )
    op.create_table(
        "inventory_lots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(100), nullable=False),
        sa.Column("is_unknown", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("manufactured_on", sa.Date(), nullable=True),
        sa.Column("rotation_on", sa.Date(), nullable=True),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("rotation_label", sa.String(24), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
        sa.UniqueConstraint("tenant_id", "product_id", "id", name="uq_lots_owner_product"),
        sa.UniqueConstraint("tenant_id", "product_id", "code", name="uq_lots_code"),
        sa.CheckConstraint(
            "rotation_label IN ('consumo_preferente','fecha_objetivo')",
            name="ck_lots_rotation_label",
        ),
        sa.CheckConstraint(
            "manufactured_on IS NULL OR ((rotation_on IS NULL OR rotation_on >= manufactured_on) AND (expires_on IS NULL OR expires_on >= manufactured_on))",
            name="ck_lots_dates",
        ),
        sa.CheckConstraint(
            "NOT is_unknown OR (manufactured_on IS NULL AND rotation_on IS NULL AND expires_on IS NULL)",
            name="ck_unknown_dates",
        ),
    )
    for table, parent, parent_field, qty, check, uq in (
        (
            "inventory_lot_allocations",
            "inventory_movements",
            "movement_id",
            "quantity_delta",
            "quantity_delta <> 0",
            "uq_lot_movement",
        ),
        (
            "inventory_lot_reservations",
            "inventory_reservations",
            "reservation_id",
            "quantity",
            "quantity > 0",
            "uq_lot_reservation",
        ),
    ):
        op.create_table(
            table,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("branch_id", sa.Uuid(), nullable=False),
            sa.Column("product_id", sa.Uuid(), nullable=False),
            sa.Column("lot_id", sa.Uuid(), nullable=False),
            sa.Column(parent_field, sa.Uuid(), nullable=False),
            sa.Column(qty, sa.Integer(), nullable=False),
            sa.UniqueConstraint(parent_field, "lot_id", name=uq),
            sa.ForeignKeyConstraint(
                ["tenant_id", "product_id", "lot_id"],
                ["inventory_lots.tenant_id", "inventory_lots.product_id", "inventory_lots.id"],
            ),
            sa.ForeignKeyConstraint(
                ["tenant_id", "branch_id", "product_id", parent_field],
                [
                    f"{parent}.tenant_id",
                    f"{parent}.branch_id",
                    f"{parent}.product_id",
                    f"{parent}.id",
                ],
            ),
            sa.CheckConstraint(
                check,
                name="ck_lot_delta" if qty == "quantity_delta" else "ck_lot_reserved_quantity",
            ),
        )
    for table in ("inventory_lots", "inventory_lot_allocations", "inventory_lot_reservations"):
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.create_index(f"ix_{table}_product_id", table, ["product_id"])
        if table != "inventory_lots":
            op.create_index(f"ix_{table}_branch_id", table, ["branch_id"])
            op.create_index(f"ix_{table}_lot_id", table, ["lot_id"])
            field = "movement_id" if table.endswith("allocations") else "reservation_id"
            op.create_index(f"ix_{table}_{field}", table, [field])
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table} FOR ALL
              USING (tenant_id::text = current_setting('app.tenant_id', true))
              WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
            REVOKE ALL ON {table} FROM PUBLIC;
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT, INSERT ON {table} TO kova_app;
                IF '{table}' = 'inventory_lots' THEN GRANT UPDATE (code, manufactured_on, rotation_on, expires_on) ON {table} TO kova_app; END IF;
                IF '{table}' = 'inventory_lot_reservations' THEN GRANT DELETE ON {table} TO kova_app; END IF; END IF;
            END $$;
        """)
    # Deferred checks permit parent + children in one transaction, never a partial commit.
    # SECURITY INVOKER keeps the calling tenant's RLS context authoritative.
    op.execute("""
        CREATE FUNCTION stamp_inventory_lot_movement() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
        DECLARE tracked boolean;
        BEGIN
          SELECT track_lots INTO tracked FROM products WHERE tenant_id=NEW.tenant_id AND id=NEW.product_id FOR UPDATE;
          NEW.lot_tracked := NEW.lot_tracked OR COALESCE(tracked,false);
          RETURN NEW;
        END $$;
        CREATE TRIGGER lot_movement_stamp BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION stamp_inventory_lot_movement();
        REVOKE ALL ON FUNCTION stamp_inventory_lot_movement() FROM PUBLIC;
        CREATE FUNCTION check_inventory_lot_movement() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
        DECLARE mid uuid; tid uuid; required boolean; expected integer; actual bigint;
        BEGIN
          IF TG_TABLE_NAME = 'inventory_movements' THEN mid := NEW.id; tid := NEW.tenant_id;
          ELSIF TG_OP = 'DELETE' THEN mid := OLD.movement_id; tid := OLD.tenant_id;
          ELSE mid := NEW.movement_id; tid := NEW.tenant_id; END IF;
          SELECT lot_tracked, quantity_delta INTO required, expected FROM inventory_movements WHERE id=mid AND tenant_id=tid;
          IF NOT FOUND THEN RETURN NULL; END IF;
          IF NOT required AND TG_TABLE_NAME='inventory_movements' THEN RETURN NULL; END IF;
          SELECT COALESCE(sum(quantity_delta),0) INTO actual FROM inventory_lot_allocations WHERE movement_id=mid AND tenant_id=tid;
          IF (required OR actual <> 0) AND actual <> expected THEN RAISE EXCEPTION 'Lot allocations do not reconcile' USING ERRCODE='23514'; END IF;
          IF EXISTS (SELECT 1 FROM inventory_lot_allocations WHERE movement_id=mid AND tenant_id=tid AND sign(quantity_delta) <> sign(expected)) THEN RAISE EXCEPTION 'Invalid allocation sign' USING ERRCODE='23514'; END IF;
          IF EXISTS (SELECT 1 FROM inventory_lot_allocations a WHERE a.movement_id=mid AND a.tenant_id=tid AND
              (SELECT sum(b.quantity_delta) FROM inventory_lot_allocations b WHERE b.tenant_id=a.tenant_id AND b.branch_id=a.branch_id AND b.lot_id=a.lot_id) < 0)
            THEN RAISE EXCEPTION 'Negative lot stock' USING ERRCODE='23514'; END IF;
          RETURN NULL;
        END $$;
        CREATE CONSTRAINT TRIGGER lot_movement_total AFTER INSERT OR UPDATE ON inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_lot_movement();
        CREATE CONSTRAINT TRIGGER lot_allocation_total AFTER INSERT OR UPDATE OR DELETE ON inventory_lot_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_lot_movement();
        CREATE FUNCTION check_inventory_lot_reservation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
        DECLARE rid uuid; tid uuid; required boolean; expected integer; actual bigint;
        BEGIN
          IF TG_TABLE_NAME = 'inventory_reservations' THEN rid := NEW.id; tid := NEW.tenant_id;
          ELSIF TG_OP = 'DELETE' THEN rid := OLD.reservation_id; tid := OLD.tenant_id;
          ELSE rid := NEW.reservation_id; tid := NEW.tenant_id; END IF;
          SELECT lot_tracked, quantity INTO required, expected FROM inventory_reservations WHERE id=rid AND tenant_id=tid;
          IF NOT FOUND THEN RETURN NULL; END IF;
          IF NOT required AND TG_TABLE_NAME='inventory_reservations' THEN RETURN NULL; END IF;
          SELECT COALESCE(sum(quantity),0) INTO actual FROM inventory_lot_reservations WHERE reservation_id=rid AND tenant_id=tid;
          IF (required OR actual <> 0) AND actual <> expected THEN RAISE EXCEPTION 'Lot reservations do not reconcile' USING ERRCODE='23514'; END IF;
          RETURN NULL;
        END $$;
        CREATE CONSTRAINT TRIGGER lot_reservation_total AFTER INSERT OR UPDATE ON inventory_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_lot_reservation();
        CREATE CONSTRAINT TRIGGER lot_reserved_total AFTER INSERT OR UPDATE OR DELETE ON inventory_lot_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_lot_reservation();
        REVOKE ALL ON FUNCTION check_inventory_lot_movement(), check_inventory_lot_reservation() FROM PUBLIC;
    """)


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM inventory_lots) THEN RAISE EXCEPTION 'Cannot downgrade recorded lots'; END IF; END $$;"
    )
    for table, trigger in (
        ("inventory_movements", "lot_movement_total"),
        ("inventory_lot_allocations", "lot_allocation_total"),
        ("inventory_reservations", "lot_reservation_total"),
        ("inventory_lot_reservations", "lot_reserved_total"),
    ):
        op.execute(f"DROP TRIGGER {trigger} ON {table}")
    op.execute(
        "DROP TRIGGER lot_movement_stamp ON inventory_movements; DROP FUNCTION stamp_inventory_lot_movement();"
    )
    op.execute(
        "DROP FUNCTION check_inventory_lot_movement(); DROP FUNCTION check_inventory_lot_reservation();"
    )
    for table in ("inventory_lot_reservations", "inventory_lot_allocations", "inventory_lots"):
        op.drop_table(table)
    for table in ("inventory_movements", "inventory_reservations"):
        op.drop_constraint(f"uq_{table}_lot_owner", table)
        op.drop_column(table, "lot_tracked")
    op.drop_constraint("fk_movement_order_item", "inventory_movements")
    op.drop_column("inventory_movements", "order_item_id")
    op.drop_column("order_items", "lot_tracked")
    for constraint in (
        "ck_products_lot_tracking",
        "ck_products_rotation_label",
        "ck_products_rotation_days",
        "ck_products_expiry_days",
    ):
        op.drop_constraint(constraint, "products")
    for field in ("track_lots", "rotation_label", "rotation_days", "expiry_days"):
        op.drop_column("products", field)
