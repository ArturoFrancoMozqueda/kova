import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.billing.models import Subscription
from app.config import settings
from app.onboarding.models import TenantOnboardingState
from app.ops import deep_links, repository
from app.ops.cache import ops_cache
from app.ops.connectors import fly, sentry, uptimerobot, vercel
from app.ops.connectors.base import ConnectorResult
from app.ops.sanitize import sanitize_webhook_payload
from app.ops.schemas import (
    FunnelConversion,
    FunnelResponse,
    FunnelStep,
    FunnelWindow,
    MoneySummary,
    OperationsSummary,
    OpsStatus,
    OverviewHealth,
    OverviewResponse,
    PastDueItem,
    RevenueResponse,
    RiskSummary,
    SourceHealth,
    TechnicalResponse,
    TechnicalSource,
    TenantActivation,
    TenantBilling,
    TenantItem,
    TenantListResponse,
    TenantUsage,
    TrialItem,
    VersionInfo,
    WebhookFailureItem,
    WebhookHealth,
)

# Only observed states elevate the overall status; degraded/not_configured are
# reported per-source but never page the CEO on their own.
_OVERALL_RANK: dict[OpsStatus, int] = {"ok": 0, "warning": 1, "critical": 2}

_DEFAULT_CURRENCY = "MXN"
_NO_SALES_RISK_DAYS = 14

_WINDOW_DAYS: dict[FunnelWindow, int] = {"7d": 7, "30d": 30, "90d": 90}


def _now() -> datetime:
    return datetime.now(UTC)


def db_health(db: Session) -> SourceHealth:
    started = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return SourceHealth(status="critical", detail="database unreachable", checked_at=_now())
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    return SourceHealth(status="ok", latency_ms=latency_ms, checked_at=_now())


# ── External connectors: cached, concurrent fan-out ──────────────────────────

# Fetchers keyed by source name; each returns a ConnectorResult and never raises.
_CONNECTORS: dict[str, object] = {
    "sentry": lambda t: sentry.fetch_unresolved_issues(timeout=t),
    "fly": lambda t: fly.fetch_status(timeout=t),
    "vercel": lambda t: vercel.fetch_latest_deployment(timeout=t),
    "uptimerobot": lambda t: uptimerobot.fetch_monitors(timeout=t),
}


def _connector_ttl(result: ConnectorResult) -> float:
    # Cache real observations for the full window; re-probe degraded sources
    # sooner so a transient outage clears quickly.
    if result.status == "degraded":
        return min(30.0, settings.ops_cache_ttl_seconds)
    return float(settings.ops_cache_ttl_seconds)


def _fetch_connector(name: str) -> ConnectorResult:
    fetcher = _CONNECTORS[name]
    timeout = float(settings.ops_connector_timeout_seconds)

    def compute() -> ConnectorResult:
        try:
            return fetcher(timeout)  # type: ignore[operator]
        except Exception as exc:  # noqa: BLE001 — a connector must never 500 the dashboard
            return ConnectorResult(status="degraded", error_summary=type(exc).__name__)

    return ops_cache.get_or_set(f"connector:{name}", _connector_ttl, compute)


def fetch_all_connectors() -> dict[str, ConnectorResult]:
    """Run every connector concurrently (cached). One slow/broken source can't
    block or break the others."""
    names = list(_CONNECTORS)
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        results = list(pool.map(_fetch_connector, names))
    return dict(zip(names, results, strict=True))


def _connector_to_source_health(result: ConnectorResult) -> SourceHealth:
    return SourceHealth(
        status=result.status,
        detail=result.error_summary,
        checked_at=result.checked_at,
    )


def overall_status(sources: dict[str, SourceHealth]) -> OpsStatus:
    worst: OpsStatus = "ok"
    for source in sources.values():
        rank = _OVERALL_RANK.get(source.status)
        if rank is not None and rank > _OVERALL_RANK[worst]:
            worst = source.status
    return worst


def _active_currency(db: Session) -> str:
    """Currency of active subscriptions; MXN when none exist. Summing MRR across
    mixed currencies would be meaningless, so we report the dominant one."""
    row = (
        db.query(Subscription.currency, func.count(Subscription.id))
        .filter(Subscription.status == "active")
        .group_by(Subscription.currency)
        .order_by(func.count(Subscription.id).desc())
        .first()
    )
    return row[0] if row else _DEFAULT_CURRENCY


def _stripe_webhook_status(failed_7d: int, stuck: int) -> OpsStatus:
    if failed_7d or stuck:
        return "warning"
    return "ok"


def build_money(db: Session) -> MoneySummary:
    counts = repository.subscription_status_counts(db)
    return MoneySummary(
        currency=_active_currency(db),
        mrr_minor_units=repository.mrr_minor_units(db),
        trialing_mrr_minor_units=repository.mrr_minor_units(db, statuses=("trialing",)),
        active=counts.get("active", 0),
        trialing=counts.get("trialing", 0),
        past_due=counts.get("past_due", 0),
        canceling=repository.canceling_count(db),
    )


def build_risk(db: Session) -> RiskSummary:
    now = _now()
    return RiskSummary(
        failed_webhooks_24h=repository.failed_webhooks_count(db, since=now - timedelta(hours=24)),
        past_due_tenants=repository.past_due_tenants_count(db),
        trials_expiring_7d=repository.trials_expiring_count(db, within_days=7),
        grace_period_expired=repository.grace_period_expired_count(db),
    )


def build_operations(db: Session) -> OperationsSummary:
    now = _now()
    orders_24h, sales_24h = repository.orders_summary(db, since=now - timedelta(hours=24))
    return OperationsSummary(
        orders_24h=orders_24h,
        sales_24h_amount=f"{sales_24h:.2f}",
        signups_7d=repository.signups_count(db, since=now - timedelta(days=7)),
        tenants_active_7d=repository.active_tenants_count(db, since=now - timedelta(days=7)),
    )


def build_overview(db: Session) -> OverviewResponse:
    now = _now()
    failed_7d = repository.failed_webhooks_count(db, since=now - timedelta(days=7))
    stuck = repository.stuck_received_count(db, older_than=now - timedelta(hours=1))
    connectors = fetch_all_connectors()
    sources: dict[str, SourceHealth] = {
        "db": db_health(db),
        "stripe_webhooks": SourceHealth(
            status=_stripe_webhook_status(failed_7d, stuck), checked_at=now
        ),
        "sentry": _connector_to_source_health(connectors["sentry"]),
        "fly": _connector_to_source_health(connectors["fly"]),
        "vercel": _connector_to_source_health(connectors["vercel"]),
        "uptimerobot": _connector_to_source_health(connectors["uptimerobot"]),
    }
    return OverviewResponse(
        generated_at=now,
        environment=settings.app_env,
        version=VersionInfo(git_sha=settings.git_sha),
        health=OverviewHealth(overall=overall_status(sources), sources=sources),
        money=build_money(db),
        risk=build_risk(db),
        operations=build_operations(db),
    )


# ── Technical ─────────────────────────────────────────────────────────────────


def _to_technical_source(result: ConnectorResult) -> TechnicalSource:
    data = result.data if isinstance(result.data, dict) else None
    return TechnicalSource(
        status=result.status,
        checked_at=result.checked_at,
        error_summary=result.error_summary,
        data=data,
    )


def build_technical(db: Session) -> TechnicalResponse:
    now = _now()
    health = db_health(db)
    connectors = fetch_all_connectors()
    return TechnicalResponse(
        generated_at=now,
        db=TechnicalSource(
            status=health.status,
            checked_at=health.checked_at,
            error_summary=health.detail,
            data={"latency_ms": health.latency_ms},
        ),
        uptimerobot=_to_technical_source(connectors["uptimerobot"]),
        sentry=_to_technical_source(connectors["sentry"]),
        fly=_to_technical_source(connectors["fly"]),
        vercel=_to_technical_source(connectors["vercel"]),
    )


# ── Revenue ───────────────────────────────────────────────────────────────────


def build_revenue(db: Session) -> RevenueResponse:
    now = _now()
    counts = repository.subscription_status_counts(db)

    trials = [
        TrialItem(tenant_id=sub.tenant_id, tenant_name=name, trial_ends_at=sub.trial_ends_at)
        for sub, name in repository.list_subscriptions_by_status(db, status="trialing")
    ]
    past_due = [
        PastDueItem(
            tenant_id=sub.tenant_id,
            tenant_name=name,
            past_due_at=sub.past_due_at,
            grace_period_ends_at=sub.grace_period_ends_at,
        )
        for sub, name in repository.list_subscriptions_by_status(db, status="past_due")
    ]

    failed_7d = repository.failed_webhooks_count(db, since=now - timedelta(days=7))
    stuck = repository.stuck_received_count(db, older_than=now - timedelta(hours=1))
    recent_failures = [
        WebhookFailureItem(
            stripe_event_id=event.stripe_event_id,
            event_type=event.event_type,
            process_attempts=event.process_attempts,
            error_reason=event.error_reason,
            created_at=event.created_at,
            tenant_id=event.tenant_id,
            deep_link=deep_links.stripe_event(event.stripe_event_id),
        )
        for event in repository.recent_failed_webhooks(db)
    ]

    return RevenueResponse(
        generated_at=now,
        currency=_active_currency(db),
        mrr_minor_units=repository.mrr_minor_units(db),
        trialing_mrr_minor_units=repository.mrr_minor_units(db, statuses=("trialing",)),
        by_status=counts,
        canceling_count=repository.canceling_count(db),
        trials=trials,
        past_due=past_due,
        webhook_health=WebhookHealth(
            status=_stripe_webhook_status(failed_7d, stuck),
            failed_7d=failed_7d,
            stuck_received_1h=stuck,
            last_event_at=repository.last_webhook_at(db),
            recent_failures=recent_failures,
        ),
    )


# ── Funnel ────────────────────────────────────────────────────────────────────


def build_funnel(db: Session, *, window: FunnelWindow) -> FunnelResponse:
    now = _now()
    since = now - timedelta(days=_WINDOW_DAYS[window])
    cohort = repository.cohort_tenant_ids(db, since=since)
    cohort_set = set(cohort)

    verified = repository.verified_owner_tenant_ids(db, tenant_ids=cohort)
    first_product = repository._telemetry_tenants_with_event(
        db, event_name="first_product_created", tenant_ids=cohort
    ) | repository._onboarding_tenants_with_flag(
        db, column=TenantOnboardingState.first_product_completed, tenant_ids=cohort
    )
    first_sale = repository._telemetry_tenants_with_event(
        db, event_name="first_sale_completed", tenant_ids=cohort
    ) | repository._onboarding_tenants_with_flag(
        db, column=TenantOnboardingState.first_sale_completed, tenant_ids=cohort
    )
    checkout_started = repository._telemetry_tenants_with_event(
        db, event_name="checkout_started", tenant_ids=cohort
    )
    paid = repository._telemetry_tenants_with_event(
        db, event_name="trial_to_paid", tenant_ids=cohort
    )

    # Every step is intersected with the cohort so numerators and denominators
    # come from the same population.
    step_sets = {
        "signup": cohort_set,
        "email_verified": verified & cohort_set,
        "first_product": first_product & cohort_set,
        "first_sale": first_sale & cohort_set,
        "checkout_started": checkout_started & cohort_set,
        "paid": paid & cohort_set,
    }
    order = ["signup", "email_verified", "first_product", "first_sale", "checkout_started", "paid"]
    steps = [FunnelStep(name=name, count=len(step_sets[name])) for name in order]

    conversions: list[FunnelConversion] = []
    for prev, nxt in zip(order, order[1:], strict=False):
        prev_count = len(step_sets[prev])
        rate = (len(step_sets[nxt]) / prev_count) if prev_count else 0.0
        conversions.append(
            FunnelConversion(**{"from": prev, "to": nxt, "rate": round(rate, 4)})
        )

    return FunnelResponse(
        generated_at=now,
        window=window,
        cohort_size=len(cohort_set),
        steps=steps,
        conversions=conversions,
    )


# ── Tenants ───────────────────────────────────────────────────────────────────


def _tenant_risk_flags(
    *,
    subscription: Subscription | None,
    last_order_at: datetime | None,
    orders_30d: int,
    now: datetime,
) -> list[str]:
    flags: list[str] = []
    if subscription is not None:
        if subscription.status == "past_due":
            flags.append("past_due")
        if (
            subscription.status == "trialing"
            and subscription.trial_ends_at is not None
            and subscription.trial_ends_at < now + timedelta(days=7)
        ):
            flags.append("trial_expiring")
    if orders_30d == 0:
        flags.append("never_activated" if last_order_at is None else "no_sales_14d")
    elif last_order_at is not None and last_order_at < now - timedelta(days=_NO_SALES_RISK_DAYS):
        flags.append("no_sales_14d")
    return flags


def build_tenants(
    db: Session, *, search: str | None, offset: int, limit: int
) -> TenantListResponse:
    now = _now()
    tenants, total = repository.list_tenants(db, search=search, offset=offset, limit=limit)
    tenant_ids = [t.id for t in tenants]

    subs = repository.subscriptions_by_tenant(db, tenant_ids=tenant_ids)
    onboarding = repository.onboarding_by_tenant(db, tenant_ids=tenant_ids)
    owner_emails = repository.owner_emails_by_tenant(db, tenant_ids=tenant_ids)
    users_counts = repository.users_count_by_tenant(db, tenant_ids=tenant_ids)
    activity = repository.order_activity_by_tenant(
        db,
        tenant_ids=tenant_ids,
        since_7d=now - timedelta(days=7),
        since_30d=now - timedelta(days=30),
    )

    items: list[TenantItem] = []
    for tenant in tenants:
        sub = subs.get(tenant.id)
        ob = onboarding.get(tenant.id)
        act = activity.get(tenant.id, {"orders_7d": 0, "orders_30d": 0, "last_order_at": None})
        customer_link = (
            deep_links.stripe_customer(sub.stripe_customer_id)
            if sub and sub.stripe_customer_id
            else None
        )
        billing = TenantBilling(
            status=sub.status if sub else None,
            plan_name=sub.plan_name if sub else None,
            amount_minor_units=sub.amount_minor_units if sub else None,
            currency=sub.currency if sub else None,
            trial_ends_at=sub.trial_ends_at if sub else None,
            past_due_at=sub.past_due_at if sub else None,
            grace_period_ends_at=sub.grace_period_ends_at if sub else None,
            cancel_at_period_end=sub.cancel_at_period_end if sub else False,
            stripe_customer_id=sub.stripe_customer_id if sub else None,
            stripe_customer_deep_link=customer_link,
        )
        activation = TenantActivation(
            business_profile=ob.business_profile_completed if ob else False,
            first_product=ob.first_product_completed if ob else False,
            shift_opened=ob.shift_opened_completed if ob else False,
            first_sale=ob.first_sale_completed if ob else False,
            billing=ob.billing_completed if ob else False,
            completed_count=sum(
                [
                    ob.business_profile_completed,
                    ob.first_product_completed,
                    ob.shift_opened_completed,
                    ob.first_sale_completed,
                    ob.billing_completed,
                ]
            )
            if ob
            else 0,
        )
        items.append(
            TenantItem(
                tenant_id=tenant.id,
                name=tenant.name,
                slug=tenant.slug,
                is_active=tenant.is_active,
                created_at=tenant.created_at,
                owner_email=owner_emails.get(tenant.id),
                users_count=users_counts.get(tenant.id, 0),
                billing=billing,
                activation=activation,
                usage=TenantUsage(
                    orders_7d=act["orders_7d"],
                    orders_30d=act["orders_30d"],
                    last_order_at=act["last_order_at"],
                ),
                risk_flags=_tenant_risk_flags(
                    subscription=sub,
                    last_order_at=act["last_order_at"],
                    orders_30d=act["orders_30d"],
                    now=now,
                ),
            )
        )

    return TenantListResponse(generated_at=now, items=items, total=total)


# sanitize_webhook_payload is re-exported for the incidents/trace phases.
__all__ = ["sanitize_webhook_payload"]
