import { useQuery } from "@tanstack/react-query";

import { DEFAULT_TIMEZONE } from "@/i18n/date";
import { getBusinessProfile } from "@/settings/api";

/**
 * The tenant's configured timezone, fetched once and cached app-wide via
 * react-query (so the many date-dependent views share one request). Falls back
 * to America/Mexico_City until loaded or if the profile can't be read. Use this
 * instead of letting date helpers default to CDMX, so operators outside CDMX
 * see their own local day.
 */
export function useTenantTimezone(): string {
  const { data } = useQuery({
    queryKey: ["business-profile", "timezone"],
    queryFn: getBusinessProfile,
    // Timezone effectively never changes within a session.
    staleTime: 10 * 60_000,
  });
  return data?.timezone || DEFAULT_TIMEZONE;
}
