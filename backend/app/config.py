from typing import Literal
from uuid import UUID

from pydantic import Field, SecretStr, field_validator
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
    # Owner/privileged connection. Used by (a) Alembic migrations, which must run
    # as the table owner to issue DDL, and (b) the small set of deliberately
    # tenant-agnostic request paths (webhook, public assets, pre-session auth) via
    # the privileged engine. The owner/superuser (or a BYPASSRLS role) is the only
    # role permitted to bypass RLS.
    database_url: str = "postgresql+psycopg://pos:pos@localhost:5432/pos"
    # Runtime application connection. Should point at the least-privilege,
    # non-owner `kova_app` role so RLS tenant_isolation policies are enforced.
    # Falls back to `database_url` when unset so local dev / tests keep working
    # even before the role is provisioned (RLS simply stays inert, as it is today).
    app_database_url: str | None = None
    # Explicit owner URL for migrations. Falls back to `database_url`. Kept
    # separate so the runtime app can point at `kova_app` while DDL still runs
    # as the owner.
    migration_database_url: str | None = None
    database_pool_size: int = 5
    database_max_overflow: int = 0
    database_pool_timeout: int = 10
    database_pool_recycle_seconds: int = 300
    frontend_url: str = "http://localhost:5173"
    # Immutable source identity injected by the Fly image build. It is public
    # deployment metadata, never a secret, and lets post-deploy gates prove the
    # frontend and backend came from the same commit.
    kova_release_sha: str = "unknown"

    # Auth
    secret_key: str = "change-me-in-production-use-a-long-random-string"
    access_token_ttl_seconds: int = 900  # 15 minutes
    refresh_token_ttl_seconds: int = 2_592_000  # 30 days
    # Absolute ceiling on a session's lifetime measured from its creation. Refresh
    # rotation extends the sliding window but can never push a session past this cap,
    # so a continuously-refreshed (e.g. stolen) refresh token still forces re-login.
    refresh_token_absolute_ttl_seconds: int = 7_776_000  # 90 days
    token_ttl_seconds: int = 86_400  # 24 h for verify/reset tokens
    # Kept separate from authentication token expiry. Idempotency keys remain
    # reserved for the tenant lifetime; this value only marks the minimum
    # period for which the stored response must stay readily replayable.
    idempotency_response_ttl_seconds: int = Field(default=86_400, gt=0)
    # Short-lived, non-authenticating proof issued to the public landing before
    # it can write anonymous funnel events. It is bound to the pseudonymous
    # client id and carries no user, tenant, or permission claims.
    anonymous_telemetry_token_ttl_seconds: int = Field(default=900, gt=0, le=3600)
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
    # Emergency server-side stop for every fiscal global-draft surface. This
    # wins over the globally-enabled default and tenant overrides.
    fiscal_global_drafts_kill_switch: bool = False
    # Dedicated encryption root for tenant-scoped provider organization keys.
    # Provision once in the host secret store; never derive from auth or put in DB.
    kova_cfdi_credentials_key: SecretStr | None = None
    kova_cfdi_enabled: bool = True
    kova_cfdi_timeout_seconds: int = Field(default=20, ge=5, le=30)
    account_deletion_grace_days: int = 30
    resend_api_key: str | None = None
    # Rate limiting — when both are set, the limiter uses Upstash Redis; otherwise
    # it falls back to a single-process in-memory limiter (tolerable for local dev
    # and single-instance deploys but unsafe across replicas).
    upstash_redis_rest_url: str | None = None
    upstash_redis_rest_token: str | None = None
    trusted_client_ip_header: str = "fly-client-ip"
    email_from: str = "onboarding@resend.dev"

    # Assistant is opt-in by server cohort; never call inference by default.
    assistant_provider_verified: bool = False
    assistant_enabled: bool = False
    assistant_mutations_enabled: bool = False
    assistant_documents_enabled: bool = False
    assistant_email_enabled: bool = False
    assistant_tenant_ids: str = ""
    assistant_cloudflare_account_id: str = ""
    assistant_cloudflare_token: SecretStr | None = None
    assistant_r2_access_key: SecretStr | None = None
    assistant_r2_secret_key: SecretStr | None = None
    assistant_r2_bucket: str = "kova-assistant"
    assistant_daily_budget: int = Field(default=9000, ge=1, le=9000)
    assistant_chat_budget: int = Field(default=8000, ge=1, le=8000)
    assistant_chat_uses_total_budget: bool = False
    assistant_model: str = "@cf/qwen/qwen3.8-27b"
    assistant_help_model: str = "@cf/qwen/qwen3-30b-a3b-fp8"
    # Preserve deployed Cloudflare configuration until Groq passes the pilot gates.
    assistant_generation_provider: Literal["cloudflare", "groq"] = "cloudflare"
    assistant_groq_api_key: SecretStr | None = None
    assistant_groq_model: str = "openai/gpt-oss-20b"
    assistant_groq_free_verified: bool = False
    assistant_groq_zdr_verified: bool = False
    assistant_groq_quality_verified: bool = False
    # Headroom below the published free allowances. Lower these if the account
    # has smaller limits; never silently upgrade or route to another provider.
    assistant_groq_daily_tokens: int = Field(default=180000, ge=1, le=200000)
    assistant_groq_daily_requests: int = Field(default=900, ge=1, le=1000)
    assistant_groq_minute_tokens: int = Field(default=7200, ge=1, le=8000)
    assistant_groq_minute_requests: int = Field(default=27, ge=1, le=30)

    @field_validator("assistant_tenant_ids")
    @classmethod
    def validate_assistant_cohort(cls, value: str) -> str:
        return ",".join(
            sorted({str(UUID(part.strip())) for part in value.split(",") if part.strip()})
        )

    # Internal ops dashboard (founder only). Production requires one exact
    # verified email plus its immutable user UUID. Leaving both empty disables
    # access. Connector tokens are optional — a missing token surfaces that
    # integration as "not_configured", never an error.
    internal_admin_emails: str = ""
    internal_admin_user_id: UUID | None = None
    # Server-only root used to derive the founder's TOTP seed. Keeping the root
    # outside Postgres means a database-only compromise cannot clone the factor.
    internal_ops_mfa_root_key: SecretStr | None = None
    internal_ops_mfa_enrollment_key: SecretStr | None = None
    internal_ops_mfa_step_up_ttl_seconds: int = Field(default=3600, ge=300, le=43200)
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
    def effective_app_database_url(self) -> str:
        """Runtime app connection (kova_app), falling back to the owner URL."""
        return self.app_database_url or self.database_url

    @property
    def effective_migration_database_url(self) -> str:
        """Owner connection for DDL/migrations, falling back to database_url."""
        return self.migration_database_url or self.database_url

    @property
    def internal_admin_email_set(self) -> frozenset[str]:
        return frozenset(
            entry.strip().lower()
            for entry in self.internal_admin_emails.split(",")
            if entry.strip()
        )


settings = Settings()
