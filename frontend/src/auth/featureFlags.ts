export const FEATURE_FLAGS = ["margin_reports", "customer_orders", "fiscal_global_drafts"] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

export function normalizeFeatureFlags(values: Record<string, boolean> | null | undefined): FeatureFlags {
  return {
    margin_reports: values?.margin_reports === true,
    customer_orders: values?.customer_orders === true,
    fiscal_global_drafts: values?.fiscal_global_drafts === true,
  };
}
