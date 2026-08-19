// Types mirroring the backend contracts at /api/v1/internal/ops/*.
export interface OpsMfaStatus {
  enrolled: boolean;
  step_up_valid: boolean;
  recovery_codes_remaining: number;
}

export interface OpsMfaSetup {
  secret: string;
  qr_png_data_url: string;
}

export interface OpsMfaConfirm {
  recovery_codes: string[];
  step_up_valid: true;
}

export interface OpsMfaVerify {
  step_up_valid: true;
  used_recovery_code: boolean;
}

export type OpsStatus = "ok" | "warning" | "critical" | "degraded" | "not_configured";
export type IncidentSeverity = "critical" | "warning" | "info";
export type IncidentSource =
  | "stripe_webhook"
  | "subscription"
  | "sentry"
  | "uptimerobot"
  | "fly"
  | "vercel"
  | "db";
export type TriageStatus = "new" | "acknowledged" | "investigating" | "resolved" | "ignored";
export type NoteEntityType = "incident" | "tenant" | "general";
export type NoteStatus = "open" | "resolved" | "archived";
export type FunnelWindow = "7d" | "30d" | "90d";

export type OpsMe = { email: string; is_internal_admin: true };

export type SourceHealth = {
  status: OpsStatus;
  latency_ms?: number | null;
  detail?: string | null;
  checked_at?: string | null;
};

export type MoneySummary = {
  currency: string;
  mrr_minor_units: number;
  trialing_mrr_minor_units: number;
  active: number;
  trialing: number;
  past_due: number;
  canceling: number;
};

export type RiskSummary = {
  failed_webhooks_24h: number;
  past_due_tenants: number;
  trials_expiring_7d: number;
  grace_period_expired: number;
};

export type OperationsSummary = {
  orders_24h: number;
  sales_24h_amount: string;
  signups_7d: number;
  tenants_active_7d: number;
};

export type GrowthTruths = {
  users_created: number;
  users_verified: number;
  tenants_with_completed_sale: number;
  paying_tenants: number;
};

export type Overview = {
  generated_at: string;
  environment: string;
  version: { git_sha: string | null };
  health: { overall: OpsStatus; sources: Record<string, SourceHealth> };
  growth: GrowthTruths;
  money: MoneySummary;
  risk: RiskSummary;
  operations: OperationsSummary;
};

export type TechnicalSource = {
  status: OpsStatus;
  checked_at?: string | null;
  error_summary?: string | null;
  data?: Record<string, unknown> | null;
};

export type Technical = {
  generated_at: string;
  db: TechnicalSource;
  uptimerobot: TechnicalSource;
  sentry: TechnicalSource;
  fly: TechnicalSource;
  vercel: TechnicalSource;
};

export type WebhookFailure = {
  stripe_event_id: string;
  event_type: string;
  process_attempts: number;
  error_reason: string | null;
  created_at: string;
  tenant_id: string | null;
  deep_link: string | null;
};

export type Revenue = {
  generated_at: string;
  currency: string;
  mrr_minor_units: number;
  trialing_mrr_minor_units: number;
  by_status: Record<string, number>;
  canceling_count: number;
  trials: { tenant_id: string; tenant_name: string; trial_ends_at: string | null }[];
  past_due: {
    tenant_id: string;
    tenant_name: string;
    past_due_at: string | null;
    grace_period_ends_at: string | null;
  }[];
  webhook_health: {
    status: OpsStatus;
    failed_7d: number;
    stuck_received_1h: number;
    last_event_at: string | null;
    recent_failures: WebhookFailure[];
  };
};

export type FunnelStep = { name: string; count: number };
export type Funnel = {
  generated_at: string;
  window: FunnelWindow;
  cohort_size: number;
  steps: FunnelStep[];
  conversions: { from: string; to: string; rate: number }[];
};

export type TenantItem = {
  tenant_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  owner_email: string | null;
  users_count: number;
  billing: {
    status: string | null;
    plan_name: string | null;
    amount_minor_units: number | null;
    currency: string | null;
    trial_ends_at: string | null;
    past_due_at: string | null;
    grace_period_ends_at: string | null;
    cancel_at_period_end: boolean;
    stripe_customer_id: string | null;
    stripe_customer_deep_link: string | null;
  };
  activation: {
    business_profile: boolean;
    first_product: boolean;
    shift_opened: boolean;
    first_sale: boolean;
    billing: boolean;
    completed_count: number;
  };
  usage: { orders_7d: number; orders_30d: number; last_order_at: string | null };
  risk_flags: string[];
};

export type TenantList = { generated_at: string; items: TenantItem[]; total: number };

export type IncidentCorrelation = {
  tenant_id: string | null;
  user_id: string | null;
  request_id: string | null;
  stripe_event_id: string | null;
};

export type DeepLink = { label: string; url: string };

export type IncidentItem = {
  key: string;
  source: IncidentSource;
  external_id: string;
  severity: IncidentSeverity;
  title: string;
  detected_at: string;
  last_seen_at: string | null;
  correlation: IncidentCorrelation;
  triage: { status: TriageStatus; snoozed_until: string | null; updated_at: string | null };
  deep_links: DeepLink[];
};

export type IncidentList = {
  generated_at: string;
  items: IncidentItem[];
  total: number;
  degraded_sources: string[];
};

export type TimelineEvent = { ts: string; kind: string; summary: string; actor: string | null };

export type OpsNote = {
  id: string;
  author_user_id: string;
  author_email: string;
  entity_type: NoteEntityType;
  entity_source: string | null;
  entity_external_id: string | null;
  tenant_id: string | null;
  body: string;
  status: NoteStatus;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type IncidentDetail = {
  incident: IncidentItem;
  detail: Record<string, unknown> | null;
  timeline: TimelineEvent[];
  notes: OpsNote[];
};

export type TraceEvent = {
  ts: string | null;
  source: string;
  kind: string;
  summary: string;
  correlation: IncidentCorrelation;
  deep_link: string | null;
};

export type TraceResult = {
  generated_at: string;
  query: Record<string, unknown>;
  timeline: TraceEvent[];
  sources_queried: Record<string, string>;
  deep_links: Record<string, string>;
};

export type TraceParams = {
  request_id?: string;
  tenant_id?: string;
  user_id?: string;
  stripe_event_id?: string;
  sentry_event_id?: string;
  from?: string;
  to?: string;
};
