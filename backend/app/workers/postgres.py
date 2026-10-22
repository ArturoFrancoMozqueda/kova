"""Keep PostgreSQL error contracts stable across psycopg and the pure Python driver."""

from types import SimpleNamespace

from sqlalchemy import event
from sqlalchemy.dialects import registry
from sqlalchemy.dialects.postgresql.pg8000 import PGDialect_pg8000
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

_INITIALIZATION_QUERY = (
    "SELECT pg_catalog.version(), current_schema(), "
    "pg_catalog.current_setting('transaction_isolation'), "
    "pg_catalog.current_setting('standard_conforming_strings')"
)


class _InitializationScalar:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _InitializationDbapi:
    def __init__(self, connection, isolation):
        self._connection = connection
        self.isolation = isolation

    def __getattr__(self, name):
        return getattr(self._connection, name)


class _InitializationPoolConnection:
    def __init__(self, connection, isolation):
        self._connection = connection
        self.dbapi_connection = _InitializationDbapi(connection.dbapi_connection, isolation)

    def __getattr__(self, name):
        return getattr(self._connection, name)


class _InitializationConnection:
    """Reuse one live metadata read while upstream performs normal initialization."""

    def __init__(self, connection, values):
        version, schema, isolation, standard_strings = values
        self._connection = connection
        self.connection = _InitializationPoolConnection(connection.connection, isolation)
        self._scalars = {
            "select pg_catalog.version()": version,
            "select current_schema()": schema,
            "show standard_conforming_strings": standard_strings,
        }

    def exec_driver_sql(self, statement, *args, **kwargs):
        key = statement.strip().lower()
        if not args and not kwargs and key in self._scalars:
            return _InitializationScalar(self._scalars[key])
        return self._connection.exec_driver_sql(statement, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._connection, name)


class WorkersPGDialect(PGDialect_pg8000):
    """Run the existing dialect discovery with one live PostgreSQL round trip."""

    supports_statement_cache = True

    def initialize(self, connection):
        values = connection.exec_driver_sql(_INITIALIZATION_QUERY).one()
        # Upstream still parses the server version and sets every capability.
        # The wrapper exists only on this call stack, never on an Engine/session.
        super().initialize(_InitializationConnection(connection, values))

    def get_default_isolation_level(self, dbapi_connection):
        if isinstance(dbapi_connection, _InitializationDbapi):
            return dbapi_connection.isolation.upper()
        return super().get_default_isolation_level(dbapi_connection)


registry.register("postgresql.kova_pg8000", "app.workers.postgres", "WorkersPGDialect")


def connect_binding(*, privileged=False):
    from pg8000.dbapi import connect

    from app.config import settings
    from app.workers.context import environment

    env = environment.get()
    binding = getattr(env, "DB_PRIVILEGED" if privileged else "DB_APP", None)
    if binding is None:
        raise RuntimeError("Database connection requires an active binding context")
    return connect(
        host=binding.host,
        port=int(binding.port),
        user=binding.user,
        password=binding.password,
        database=binding.database,
        ssl_context=False,
        timeout=max(20, settings.database_pool_timeout),
    )


@event.listens_for(Engine, "handle_error", retval=True)
def normalize_pg8000_error(context):
    if context.engine is None or context.engine.dialect.driver != "pg8000":
        return None
    original = context.original_exception
    if not original.args or not isinstance(original.args[0], dict):
        return None
    fields = original.args[0]
    code = fields.get("C")
    if not isinstance(code, str) or len(code) != 5:
        return None
    original.sqlstate = code
    original.diag = SimpleNamespace(constraint_name=fields.get("n"))
    # pg8000 classifies several class-23 constraint failures as ProgrammingError.
    # Kova deliberately catches IntegrityError for atomic idempotent inserts.
    # Reclassification follows the server's SQLSTATE, never an error message.
    if code.startswith("23"):
        return IntegrityError(
            context.statement,
            context.parameters,
            original,
            hide_parameters=context.engine.hide_parameters,
            connection_invalidated=context.is_disconnect,
        )
    return None
