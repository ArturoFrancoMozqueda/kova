from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    database_url: str = "postgresql+psycopg://pos:pos@localhost:5432/pos"

    # Auth
    secret_key: str = "change-me-in-production-use-a-long-random-string"
    access_token_ttl_seconds: int = 900        # 15 minutes
    refresh_token_ttl_seconds: int = 2_592_000  # 30 days
    token_ttl_seconds: int = 86_400             # 24 h for verify/reset tokens
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_standard_price_id: str | None = None
    stripe_checkout_success_url: str | None = None
    stripe_checkout_cancel_url: str | None = None
    billing_grace_period_days: int = 7
    internal_api_key: str | None = None

    @property
    def cookie_secure(self) -> bool:
        return self.app_env != "local"


settings = Settings()
