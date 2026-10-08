"""Separate workloads preserve old leases and refuse to discard active ingestion."""

from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate


def test_workload_upgrade_backfills_and_blocks_active_ingest_downgrade():
    with _database() as (url, engine):
        applied = _migrate(url, "upgrade", "0075_assistant")
        assert applied.returncode == 0, applied.stderr
        old, ingest, tenant, user = (uuid4() for _ in range(4))
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO assistant_control.slots "
                              "(id,tenant_key,user_key,expires_at) VALUES "
                              "(:id,:tenant,:user,now()+interval '11 minutes')"),
                         {"id": old, "tenant": tenant, "user": user})
        applied = _migrate(url, "upgrade", "0076_assistant_workload_slots")
        assert applied.returncode == 0, applied.stderr
        with engine.begin() as conn:
            assert conn.scalar(text("SELECT workload FROM assistant_control.slots "
                                    "WHERE id=:id"), {"id": old}) == "chat"
            conn.execute(text("INSERT INTO assistant_control.slots "
                              "(id,tenant_key,user_key,expires_at,workload) VALUES "
                              "(:id,:tenant,:user,now()+interval '11 minutes','ingest')"),
                         {"id": ingest, "tenant": tenant, "user": user})
        blocked = _migrate(url, "downgrade", "0075_assistant")
        assert blocked.returncode != 0
        assert "stop ingestion and drain leases" in blocked.stderr
        with engine.begin() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == (
                "0076_assistant_workload_slots")
            assert conn.scalar(text("SELECT count(*) FROM assistant_control.slots")) == 2
            conn.execute(text("DELETE FROM assistant_control.slots WHERE id=:id"), {"id": ingest})
        rolled = _migrate(url, "downgrade", "0075_assistant")
        assert rolled.returncode == 0, rolled.stderr
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM assistant_control.slots WHERE id=:id"),
                               {"id": old}) == 1
