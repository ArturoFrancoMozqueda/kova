import { useAuthContext } from "./AuthContext";
import type { FeatureFlag } from "./featureFlags";

export function useFeature(flag: FeatureFlag): boolean {
  const { state } = useAuthContext();
  return state.status === "authenticated" && state.featureFlags[flag];
}
