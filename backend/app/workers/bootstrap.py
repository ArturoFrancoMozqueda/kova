"""Initialize the existing API inside a request with explicit Workers bindings."""

import asyncio
import logging
import re
from contextlib import contextmanager
from time import perf_counter

_application = None
_initialization = asyncio.Lock()
_startup_logger = logging.getLogger("app.startup")


@contextmanager
def _startup_phase(phase, observations):
    started = perf_counter()
    try:
        yield
    finally:
        observations.append((phase, (perf_counter() - started) * 1000))


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
    release = getattr(env, "KOVA_BUILD_SHA", None)
    if release is not None:
        if not isinstance(release, str) or not re.fullmatch(r"[a-fA-F0-9]{40}", release):
            raise RuntimeError("Workers build identity must be a complete commit SHA")
        # New deployments version this public value as text. Legacy sealed
        # metadata stays untouched, so rollback never requires bypassing the
        # platform's checks for genuinely rotated credentials.
        values["kova_release_sha"] = release
    # Documents are deliberately postponed on Workers Free. Existing data is
    # retained; no daemon, file job or Fly machine wake may be started here.
    values["ASSISTANT_DOCUMENTS_ENABLED"] = "false"
    values["ASSISTANT_INGEST_ON_DEMAND"] = "false"
    databases = [("APP_DATABASE_URL", "DB_APP")]
    if privileged:
        databases.append(("MIGRATION_DATABASE_URL", "DB_PRIVILEGED"))
    for variable, binding in databases:
        database = getattr(env, binding, None)
        if database is not None:
            # Hyperdrive connection coordinates belong to the invocation.
            # The shared Engine holds a dialect label only; its creator reads
            # the actual binding from the current request for every connection.
            values[variable] = f"postgresql+pg8000://hyperdrive/{binding.lower()}"
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
    import hashlib

    import anyio.to_thread

    if not hasattr(hashlib, "pbkdf2_hmac"):
        from app.workers.crypto import pbkdf2_hmac

        hashlib.pbkdf2_hmac = pbkdf2_hmac

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
            observations = []
            try:
                with _startup_phase("workers.total", observations):
                    with _startup_phase("workers.configure", observations):
                        configure(env)
                    with _startup_phase("workers.app_main_import", observations):
                        from app.main import app

                    _application = app
            finally:
                # The app installs logging during import. Buffer early durations locally
                # so the first configuration timing is not lost before that handler exists.
                for phase, duration in observations:
                    _startup_logger.info(
                        "startup_phase phase=%s duration_ms=%.3f", phase, duration
                    )
    return _application
