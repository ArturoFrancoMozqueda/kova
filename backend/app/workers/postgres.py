"""Keep PostgreSQL error contracts stable across psycopg and the pure Python driver."""

from types import SimpleNamespace

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError


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
