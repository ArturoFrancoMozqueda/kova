from pydantic_settings import BaseSettings, SettingsConfigDict


def sqlalchemy_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + database_url[len("postgresql://") :]
    if database_url.startswith("postgres://"):
        return "postgresql+psycopg://" + database_url[len("postgres://") :]
    return database_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "production"
    database_url: str = "postgresql+psycopg://pos:pos@localhost:5432/pos"
    database_pool_size: int = 5
    database_max_overflow: int = 0
    database_pool_timeout: int = 10
    database_pool_recycle_seconds: int = 300
    frontend_url: str = "http://localhost:5173"

    # Auth
    secret_key: str = "change-me-in-production-use-a-long-random-string"
    access_token_ttl_seconds: int = 900        # 15 minutes
    refresh_token_ttl_seconds: int = 2_592_000  # 30 days
    # Absolute ceiling on a session's lifetime measured from its creation. Refresh
    # rotation extends the sliding window but can never push a session past this cap,
    # so a continuously-refreshed (e.g. stolen) refresh token still forces re-login.
    refresh_token_absolute_ttl_seconds: int = 7_776_000  # 90 days
    token_ttl_seconds: int = 86_400             # 24 h for verify/reset tokens
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_standard_price_id: str | None = None
    stripe_checkout_success_url: str | None = None
    stripe_checkout_cancel_url: str | None = None
    stripe_allow_test_mode_in_production: bool = False
    billing_trial_days: int = 7
    billing_grace_period_days: int = 7
    internal_api_key: str | None = None
    resend_api_key: str | None = None
    # Rate limiting — when both are set, the limiter uses Upstash Redis; otherwise
    # it falls back to a single-process in-memory limiter (tolerable for local dev
    # and single-instance deploys but unsafe across replicas).
    upstash_redis_rest_url: str | None = None
    upstash_redis_rest_token: str | None = None
    email_from: str = "onboarding@resend.dev"

    @property
    def cookie_secure(self) -> bool:
        return self.app_env != "local"


settings = Settings()
