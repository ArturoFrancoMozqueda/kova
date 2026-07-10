from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.config import settings, sqlalchemy_database_url

config = context.config
# DDL must run as the table owner, not the least-privilege runtime role
# (`kova_app`). Use the explicit migration/owner URL; the app runtime uses
# app_database_url. See PLAN-02 and ADR-009.
config.set_main_option(
    "sqlalchemy.url", sqlalchemy_database_url(settings.effective_migration_database_url)
)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No domain models yet (Sprint 0A is structural). Future sprints set this to
# the project's SQLAlchemy MetaData for autogenerate.
target_metadata = None


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
