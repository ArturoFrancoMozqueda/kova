import { QueryClient } from "@tanstack/react-query";

// Shared client for cached, deduped reads. Defaults tuned for a POS:
// - staleTime 30s: navigating away and back reuses cached data instead of
//   re-hitting the backend on every mount.
// - no refetch on window focus: cashiers tab around constantly; refetching on
//   every focus would hammer the API.
// - one retry: transient blips retry once, real errors surface fast.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
