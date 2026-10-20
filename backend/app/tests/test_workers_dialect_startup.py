"""Workers discover the same live database capabilities with one network read."""

from types import SimpleNamespace

import pytest
from sqlalchemy import event
from sqlalchemy.dialects.postgresql.pg8000 import PGDialect_pg8000

from app import db
from app.workers.postgres import (
    _INITIALIZATION_QUERY,
    WorkersPGDialect,
    _InitializationConnection,
)

ATTRIBUTES = (
    "server_version_info", "default_schema_name", "default_isolation_level",
    "_backslash_escapes", "supports_smallserial", "supports_identity_columns",
    "_supports_drop_index_concurrently", "_supports_jsonb_subscripting",
)


class Result:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value

    def one(self):
        return self.value


class DatabaseConnection:
    def __init__(self, values):
        self.values = values
        self.calls = []
        self.connection = SimpleNamespace(dbapi_connection=self)

    def exec_driver_sql(self, statement, *args, **kwargs):
        self.calls.append(statement)
        if statement == _INITIALIZATION_QUERY:
            return Result(self.values)
        scalars = {
            "select pg_catalog.version()": self.values[0],
            "select current_schema()": self.values[1],
            "show standard_conforming_strings": self.values[3],
        }
        return Result(scalars[statement])

    def cursor(self):
        return self

    def execute(self, statement):
        self.calls.append(statement)

    def fetchone(self):
        return (self.values[2],)

    def close(self):
        pass


@pytest.mark.parametrize(("version", "schema", "isolation", "strings"), [
    ("PostgreSQL 16.5 on synthetic", "public", "read committed", "on"),
    ("PostgreSQL 12.14 on synthetic", "tenant_schema", "repeatable read", "off"),
    ("PostgreSQL 18beta3 on synthetic", None, "serializable", "on"),
])
def test_discovery_matches_upstream_without_caching_connection_values(
    version, schema, isolation, strings,
):
    values = (version, schema, isolation, strings)
    old_connection, new_connection = DatabaseConnection(values), DatabaseConnection(values)
    original, batched = PGDialect_pg8000(), WorkersPGDialect()
    original.initialize(old_connection)
    batched.initialize(new_connection)
    assert {name: getattr(batched, name) for name in ATTRIBUTES} == {
        name: getattr(original, name) for name in ATTRIBUTES
    }
    assert len(old_connection.calls) == 4
    assert new_connection.calls == [_INITIALIZATION_QUERY]
    assert batched.driver == original.driver == "pg8000"
    # A later connection must query its own current isolation, not reuse startup.
    later = DatabaseConnection((version, schema, "read uncommitted", strings))
    assert batched.get_default_isolation_level(later) == "READ UNCOMMITTED"
    assert later.calls == ["show transaction isolation level"]


def test_unrecognized_or_parameterized_upstream_queries_delegate_to_real_connection():
    calls = []
    marker = object()

    class Connection(DatabaseConnection):
        def exec_driver_sql(self, *args, **kwargs):
            calls.append((args, kwargs))
            return marker

    real = Connection(("PostgreSQL 16.5", "public", "read committed", "on"))
    proxy = _InitializationConnection(real, real.values)
    assert proxy.exec_driver_sql("select another_server_setting()") is marker
    assert proxy.exec_driver_sql("select current_schema()", parameters=()) is marker
    assert calls == [
        (("select another_server_setting()",), {}),
        (("select current_schema()",), {"parameters": ()}),
    ]
    assert proxy.calls is real.calls


def test_discovery_failure_does_not_fallback_to_assumed_server_values():
    class Connection(DatabaseConnection):
        def exec_driver_sql(self, statement, *args, **kwargs):
            raise RuntimeError("synthetic discovery unavailable")

    dialect = WorkersPGDialect()
    with pytest.raises(RuntimeError, match="synthetic discovery unavailable"):
        dialect.initialize(Connection(()))
    assert dialect.server_version_info is None


def test_real_profile_database_discovery_matches_upstream(owner_engine):
    # Use the CI profile's actual driver; this test needs no optional sibling.
    with owner_engine.connect() as connection:
        original, batched = PGDialect_pg8000(), WorkersPGDialect()
        original.initialize(connection)
        statements = []

        def record(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement)

        event.listen(connection, "before_cursor_execute", record)
        try:
            batched.initialize(connection)
        finally:
            event.remove(connection, "before_cursor_execute", record)
        assert statements == [_INITIALIZATION_QUERY]
        assert {name: getattr(batched, name) for name in ATTRIBUTES} == {
            name: getattr(original, name) for name in ATTRIBUTES
        }


def test_workers_engine_alias_is_confined_to_workers(monkeypatch):
    normal = "postgresql+psycopg://synthetic/database"
    monkeypatch.setattr(db.sys, "platform", "linux")
    assert db._engine_database_url(normal) == normal
    monkeypatch.setattr(db.sys, "platform", "emscripten")
    assert db._engine_database_url(normal) == "postgresql+kova_pg8000://synthetic/database"
    assert db._engine_database_url("postgresql+pg8000://synthetic/database") == (
        "postgresql+kova_pg8000://synthetic/database"
    )
