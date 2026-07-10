from app.config import sqlalchemy_database_url


def test_sqlalchemy_database_url_uses_psycopg_driver_for_plain_postgresql_url() -> None:
    url = "postgresql://user:pass@db.example.com:5432/postgres?sslmode=require"

    assert (
        sqlalchemy_database_url(url)
        == "postgresql+psycopg://user:pass@db.example.com:5432/postgres?sslmode=require"
    )


def test_sqlalchemy_database_url_keeps_explicit_driver_url() -> None:
    url = "postgresql+psycopg://user:pass@localhost:5432/postgres"

    assert sqlalchemy_database_url(url) == url


def test_sqlalchemy_database_url_accepts_legacy_postgres_scheme() -> None:
    url = "postgres://user:pass@localhost:5432/postgres"

    assert sqlalchemy_database_url(url) == "postgresql+psycopg://user:pass@localhost:5432/postgres"
