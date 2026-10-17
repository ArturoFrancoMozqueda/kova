"""Initialize the existing API inside a request with explicit Workers bindings."""

import asyncio

_application = None
_initialization = asyncio.Lock()


def environment(env, *, privileged=True) -> dict[str, str]:
    from app.config import Settings

    values = {}
    # SDK environments expose bindings as attributes, not enumerable JS keys.
    # Read only recognized configuration names, never opaque resource objects.
    for name, field in Settings.model_fields.items():
        alias = field.validation_alias
        aliases = alias.choices if hasattr(alias, "choices") else [alias or name]
        for candidate in (*aliases, name.upper(), name):
            value = getattr(env, candidate, None)
            if isinstance(value, str):
                values[candidate] = value
    # Documents are deliberately postponed on Workers Free. Existing data is
    # retained; no daemon, file job or Fly machine wake may be started here.
    values["ASSISTANT_DOCUMENTS_ENABLED"] = "false"
    values["ASSISTANT_INGEST_ON_DEMAND"] = "false"
    from sqlalchemy.engine import URL

    databases = [("APP_DATABASE_URL", "DB_APP")]
    if privileged:
        databases.append(("MIGRATION_DATABASE_URL", "DB_PRIVILEGED"))
    for variable, binding in databases:
        database = getattr(env, binding, None)
        if database is not None:
            values[variable] = URL.create(
                "postgresql+pg8000",
                username=database.user,
                password=database.password,
                host=database.host,
                port=int(database.port),
                database=database.database,
            ).render_as_string(hide_password=False)
        elif values.get("APP_ENV", "production") != "local":
            raise RuntimeError("Workers requires separate runtime/privileged Hyperdrive bindings")
    if "MIGRATION_DATABASE_URL" in values:
        values["DATABASE_URL"] = values["MIGRATION_DATABASE_URL"]
    if not privileged:
        # The isolated job Worker has no privileged binding or owner URL.
        # Its unused privileged-engine factory can only connect as kova_app.
        values["DATABASE_URL"] = values["APP_DATABASE_URL"]
        values["MIGRATION_DATABASE_URL"] = values["APP_DATABASE_URL"]
    return values


def install_sync_adapter() -> None:
    import anyio.to_thread

    async def run_sync(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
        # Python sockets use JSPI to suspend without an OS thread. Retain the
        # dependency limiter and exception/finally semantics on the event loop.
        if limiter is not None:
            async with limiter:
                return func(*args)
        return func(*args)

    anyio.to_thread.run_sync = run_sync


def configure(env, *, privileged=True):
    install_sync_adapter()
    from app import config

    values = environment(env, privileged=privileged)
    arguments = {}
    for name, field in config.Settings.model_fields.items():
        alias = field.validation_alias
        aliases = alias.choices if hasattr(alias, "choices") else [alias or name]
        for candidate in [*aliases, name.upper(), name]:
            if candidate in values:
                arguments[aliases[0]] = values[candidate]
                break
    # Never load bundled .env files or place tenant state in configuration.
    config.settings = config.Settings(_env_file=None, **arguments)


async def application(env):
    global _application
    if _application is not None:
        return _application
    async with _initialization:
        if _application is None:
            configure(env)
            from app.main import app

            _application = app
    return _application
