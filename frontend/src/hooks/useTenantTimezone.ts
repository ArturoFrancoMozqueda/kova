import { useQuery } from "@tanstack/react-query";

import { DEFAULT_TIMEZONE } from "@/i18n/date";
import { getBusinessProfile } from "@/settings/api";

export interface TenantTimezone {
  /** The tenant timezone, or America/Mexico_City until resolved / on error. */
  timezone: string;
  /** False while the profile request is still in flight (timezone is the fallback). */
  isResolved: boolean;
}

/**
 * The tenant's configured timezone, fetched once and cached app-wide via
 * react-query (so the many date-dependent views share one request). Falls back
 * to America/Mexico_City until loaded or if the profile can't be read. Use this
 * instead of letting date helpers default to CDMX, so operators outside CDMX
 * see their own local day.
 *
 * `isResolved` lets callers that seed date state from "today" wait for the real
 * timezone before snapping, instead of locking in the CDMX fallback.
 */
export function useTenantTimezone(): TenantTimezone {
  const { data, isPending } = useQuery({
    queryKey: ["business-profile", "timezone"],
    queryFn: getBusinessProfile,
    // Timezone effectively never changes within a session.
    staleTime: 10 * 60_000,
  });
  return { timezone: data?.timezone || DEFAULT_TIMEZONE, isResolved: !isPending };
}
