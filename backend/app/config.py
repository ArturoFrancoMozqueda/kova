from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Internal ops dashboard (CEO). Emails allowed into /api/v1/internal/ops/*;
    # empty allowlist means nobody gets in. Connector tokens are optional — a
    # missing token surfaces that integration as "not_configured", never an error.
    internal_admin_emails: str = ""
    sentry_api_token: str | None = None
    sentry_org_slug: str | None = None
    sentry_project_slug: str | None = None
    sentry_frontend_project_slug: str | None = None
    fly_api_token: str | None = None
    fly_app_name: str = "pos-project-backend"
    vercel_api_token: str | None = None
    vercel_team_id: str | None = None
    vercel_project_id: str | None = None
    uptimerobot_api_key: str | None = None
    ops_cache_ttl_seconds: int = 60
    ops_connector_timeout_seconds: int = 5
    git_sha: str | None = None

    @property
    def cookie_secure(self) -> bool:
        return self.app_env != "local"

    @property
    def internal_admin_email_set(self) -> frozenset[str]:
        return frozenset(
            entry.strip().lower()
            for entry in self.internal_admin_emails.split(",")
            if entry.strip()
        )


settings = Settings()
