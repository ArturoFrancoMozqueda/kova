from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# Shared status vocabulary for every ops signal:
# ok/warning/critical describe observed state; degraded means the source
# errored (unknown state); not_configured means the integration has no token.
OpsStatus = Literal["ok", "warning", "critical", "degraded", "not_configured"]


class OpsMeResponse(BaseModel):
    email: str
    is_internal_admin: Literal[True] = True


class SourceHealth(BaseModel):
    status: OpsStatus
    latency_ms: float | None = None
    detail: str | None = None
    checked_at: datetime | None = None


class VersionInfo(BaseModel):
    git_sha: str | None = None


class OverviewHealth(BaseModel):
    overall: OpsStatus
    sources: dict[str, SourceHealth]


class MoneySummary(BaseModel):
    currency: str
    mrr_minor_units: int
    trialing_mrr_minor_units: int
    active: int
    trialing: int
    past_due: int
    canceling: int


class RiskSummary(BaseModel):
    failed_webhooks_24h: int
    past_due_tenants: int
    trials_expiring_7d: int
    grace_period_expired: int


class OperationsSummary(BaseModel):
    orders_24h: int
    sales_24h_amount: str
    signups_7d: int
    tenants_active_7d: int


class GrowthTruths(BaseModel):
    """Canonical lifetime growth counts shared with the protected snapshot."""

    users_created: int
    users_verified: int
    tenants_with_completed_sale: int
    paying_tenants: int


class OverviewResponse(BaseModel):
    generated_at: datetime
    environment: str
    version: VersionInfo
    health: OverviewHealth
    growth: GrowthTruths
    money: MoneySummary
    risk: RiskSummary
    operations: OperationsSummary


# ── Revenue ───────────────────────────────────────────────────────────────────


class TrialItem(BaseModel):
    tenant_id: UUID
    tenant_name: str
    trial_ends_at: datetime | None


class PastDueItem(BaseModel):
    tenant_id: UUID
    tenant_name: str
    past_due_at: datetime | None
    grace_period_ends_at: datetime | None


class WebhookFailureItem(BaseModel):
    stripe_event_id: str
    event_type: str
    process_attempts: int
    error_reason: str | None
    created_at: datetime
    tenant_id: UUID | None
    deep_link: str | None


class WebhookHealth(BaseModel):
    status: OpsStatus
    failed_7d: int
    stuck_received_1h: int
    last_event_at: datetime | None
    recent_failures: list[WebhookFailureItem]


class RevenueResponse(BaseModel):
    generated_at: datetime
    currency: str
    mrr_minor_units: int
    trialing_mrr_minor_units: int
    by_status: dict[str, int]
    canceling_count: int
    trials: list[TrialItem]
    past_due: list[PastDueItem]
    webhook_health: WebhookHealth


# ── Funnel ────────────────────────────────────────────────────────────────────

FunnelWindow = Literal["7d", "30d", "90d"]


class FunnelStep(BaseModel):
    name: str
    count: int


class FunnelConversion(BaseModel):
    from_step: str = Field(alias="from")
    to_step: str = Field(alias="to")
    rate: float

    model_config = {"populate_by_name": True}


class FunnelResponse(BaseModel):
    generated_at: datetime
    window: FunnelWindow
    cohort_size: int
    steps: list[FunnelStep]
    conversions: list[FunnelConversion]


# ── Tenants ───────────────────────────────────────────────────────────────────


class TenantBilling(BaseModel):
    status: str | None
    plan_name: str | None
    amount_minor_units: int | None
    currency: str | None
    trial_ends_at: datetime | None
    past_due_at: datetime | None
    grace_period_ends_at: datetime | None
    cancel_at_period_end: bool
    stripe_customer_id: str | None
    stripe_customer_deep_link: str | None


class TenantActivation(BaseModel):
    business_profile: bool
    first_product: bool
    shift_opened: bool
    first_sale: bool
    billing: bool
    completed_count: int


class TenantUsage(BaseModel):
    orders_7d: int
    orders_30d: int
    last_order_at: datetime | None


class TenantItem(BaseModel):
    tenant_id: UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime
    owner_email: str | None
    users_count: int
    billing: TenantBilling
    activation: TenantActivation
    usage: TenantUsage
    risk_flags: list[str]


class TenantListResponse(BaseModel):
    generated_at: datetime
    items: list[TenantItem]
    total: int


# ── Technical ─────────────────────────────────────────────────────────────────


class TechnicalSource(BaseModel):
    status: OpsStatus
    checked_at: datetime | None = None
    error_summary: str | None = None
    # Connector-produced, already-allowlisted payload (issues, machines, monitors…).
    data: dict | None = None


class TechnicalResponse(BaseModel):
    generated_at: datetime
    db: TechnicalSource
    uptimerobot: TechnicalSource
    sentry: TechnicalSource
    fly: TechnicalSource
    vercel: TechnicalSource


# ── Notes / triage ──────────────────────────────────────────────────────────

NoteEntityType = Literal["incident", "tenant", "general"]
NoteStatus = Literal["open", "resolved", "archived"]
TriageStatus = Literal["new", "acknowledged", "investigating", "resolved", "ignored"]


class OpsNoteCreate(BaseModel):
    entity_type: NoteEntityType
    entity_source: str | None = Field(default=None, max_length=40)
    entity_external_id: str | None = Field(default=None, max_length=255)
    tenant_id: UUID | None = None
    body: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def _require_entity_reference(self) -> "OpsNoteCreate":
        if self.entity_type == "incident" and not (
            self.entity_source and self.entity_external_id
        ):
            raise ValueError(
                "incident notes require entity_source and entity_external_id"
            )
        if self.entity_type == "tenant" and self.tenant_id is None:
            raise ValueError("tenant notes require tenant_id")
        return self


class OpsNoteUpdate(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=5000)
    status: NoteStatus | None = None
    pinned: bool | None = None

    @model_validator(mode="after")
    def _require_some_change(self) -> "OpsNoteUpdate":
        if self.body is None and self.status is None and self.pinned is None:
            raise ValueError("at least one of body, status or pinned is required")
        return self


class OpsNoteResponse(BaseModel):
    id: UUID
    author_user_id: UUID
    author_email: str
    entity_type: NoteEntityType
    entity_source: str | None
    entity_external_id: str | None
    tenant_id: UUID | None
    body: str
    status: NoteStatus
    pinned: bool
    created_at: datetime
    updated_at: datetime


class OpsNoteListResponse(BaseModel):
    items: list[OpsNoteResponse]
    total: int


# ── Incidents ─────────────────────────────────────────────────────────────────

IncidentSeverity = Literal["critical", "warning", "info"]
IncidentSource = Literal[
    "stripe_webhook", "subscription", "sentry", "uptimerobot", "fly", "vercel", "db"
]


class IncidentCorrelation(BaseModel):
    tenant_id: UUID | None = None
    user_id: UUID | None = None
    request_id: str | None = None
    stripe_event_id: str | None = None


class IncidentTriage(BaseModel):
    status: TriageStatus
    snoozed_until: datetime | None = None
    updated_at: datetime | None = None


class DeepLink(BaseModel):
    label: str
    url: str


class IncidentItem(BaseModel):
    key: str
    source: IncidentSource
    external_id: str
    severity: IncidentSeverity
    title: str
    detected_at: datetime
    last_seen_at: datetime | None = None
    correlation: IncidentCorrelation
    triage: IncidentTriage
    deep_links: list[DeepLink]


class IncidentListResponse(BaseModel):
    generated_at: datetime
    items: list[IncidentItem]
    total: int
    degraded_sources: list[str]


class TimelineEvent(BaseModel):
    ts: datetime
    kind: str
    summary: str
    actor: str | None = None


class IncidentDetailResponse(BaseModel):
    incident: IncidentItem
    detail: dict | None = None
    timeline: list[TimelineEvent]
    notes: list[OpsNoteResponse]


class TriageUpdate(BaseModel):
    triage_status: TriageStatus | None = None
    snoozed_until: datetime | None = None

    @model_validator(mode="after")
    def _require_change(self) -> "TriageUpdate":
        if self.triage_status is None and self.snoozed_until is None:
            raise ValueError("triage_status or snoozed_until is required")
        return self


# ── Trace ─────────────────────────────────────────────────────────────────────


class TraceQuery(BaseModel):
    request_id: str | None = None
    tenant_id: UUID | None = None
    user_id: UUID | None = None
    stripe_event_id: str | None = None
    sentry_event_id: str | None = None
    from_ts: datetime | None = Field(default=None, alias="from")
    to_ts: datetime | None = Field(default=None, alias="to")

    model_config = {"populate_by_name": True}


class TraceEvent(BaseModel):
    ts: datetime | None
    source: str
    kind: str
    summary: str
    correlation: IncidentCorrelation
    deep_link: str | None = None


class TraceResponse(BaseModel):
    generated_at: datetime
    query: TraceQuery
    timeline: list[TraceEvent]
    # Per-source honesty: which sources we actually queried and their state.
    # e.g. {"local_db": "ok", "sentry": "not_configured", "fly_logs": "deep_link_only"}
    sources_queried: dict[str, str]
    deep_links: dict[str, str]
