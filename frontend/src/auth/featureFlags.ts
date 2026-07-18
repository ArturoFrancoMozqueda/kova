export const FEATURE_FLAGS = ["margin_reports"] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

export function normalizeFeatureFlags(values: Record<string, boolean> | null | undefined): FeatureFlags {
  return {
    margin_reports: values?.margin_reports === true,
  };
}
