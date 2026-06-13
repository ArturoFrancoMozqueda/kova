export type StandardPlan = {
  name: string;
  amount_minor_units: number;
  currency: string;
  interval: string;
};

export type Subscription = {
  id: string;
  tenant_id: string;
  status: string;
  plan_name: string;
  currency: string;
  amount_minor_units: number;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  past_due_at: string | null;
  grace_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BillingAccess = {
  allowed: boolean;
  reason: string;
  trialing: boolean;
  trial_ends_at: string | null;
  blocked_at: string | null;
  recovery_path: string;
  // Set only during the past_due grace window, so the UI can show urgency.
  grace_period_ends_at: string | null;
};

export type BillingSubscription = {
  plan: StandardPlan;
  subscription: Subscription | null;
  access: BillingAccess;
};

export type CheckoutSession = {
  checkout_url: string;
  checkout_session_id: string;
};
