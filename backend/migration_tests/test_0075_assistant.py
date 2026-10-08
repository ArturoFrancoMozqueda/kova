"""Assistant migration rollback guard, restrictive ACLs and Data API privacy."""

from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate


def test_assistant_empty_downgrade_and_populated_guard():
    with _database() as (url, engine):
        # This test owns migration 0075 and its exact rollback boundary.
        applied = _migrate(url, "upgrade", "0075_assistant")
        assert applied.returncode == 0, applied.stderr
        with engine.connect() as conn:
            assert (
                conn.scalar(
                    text(
                        "SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid "
                        "WHERE c.relname IN ('assistant_records','assistant_chunks') "
                        "AND NOT p.polpermissive"
                    )
                )
                == 8
            )
            assert (
                conn.scalar(
                    text("SELECT has_schema_privilege('public','assistant_control','USAGE')")
                )
                is False
            )
        rolled = _migrate(url, "downgrade", "0074_cfdi_documents")
        assert rolled.returncode == 0, rolled.stderr
        assert _migrate(url, "upgrade", "0075_assistant").returncode == 0
        tenant, user = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES (:id,'Migration QA',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text("INSERT INTO users(id,email,hashed_password) VALUES (:id,:email,'test')"),
                {"id": user, "email": str(user) + "@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO assistant_records(id,tenant_id,owner_user_id,branch_id,kind) "
                    "VALUES (:id,:tenant,:user,:tenant,'conversation')"
                ),
                {"id": uuid4(), "tenant": tenant, "user": user},
            )
        blocked = _migrate(url, "downgrade", "0074_cfdi_documents")
        assert blocked.returncode != 0
        assert "assistant data exists" in blocked.stderr
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0075_assistant"
            assert conn.scalar(text("SELECT count(*) FROM assistant_records")) == 1
