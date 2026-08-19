// Centralized query keys and polling intervals for the ops dashboard.
// Freshness target is 1-5 min: high-criticality data polls at 60s, slower
// aggregates at 120s. /me never polls (allowlist can't change mid-session).
import { useQuery } from "@tanstack/react-query";
import {
  getFunnel,
  getIncident,
  getIncidents,
  getOpsMe,
  getOverview,
  getRevenue,
  getTechnical,
  getTenants,
  getTrace,
} from "./api";
import type { FunnelWindow, TraceParams } from "./types";

const FAST = 60_000;
const SLOW = 120_000;

export const opsKeys = {
  me: ["ops", "me"] as const,
  overview: ["ops", "overview"] as const,
  technical: ["ops", "technical"] as const,
  revenue: ["ops", "revenue"] as const,
  funnel: (w: FunnelWindow) => ["ops", "funnel", w] as const,
  tenants: (search: string) => ["ops", "tenants", search] as const,
  incidents: (filters: Record<string, string | undefined>) => ["ops", "incidents", filters] as const,
  incident: (key: string) => ["ops", "incident", key] as const,
  trace: (params: TraceParams) => ["ops", "trace", params] as const,
};

export function useOpsMe(enabled: boolean) {
  return useQuery({
    queryKey: opsKeys.me,
    queryFn: getOpsMe,
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

export const useOverview = () =>
  useQuery({ queryKey: opsKeys.overview, queryFn: getOverview, refetchInterval: FAST });

export const useTechnical = () =>
  useQuery({ queryKey: opsKeys.technical, queryFn: getTechnical, refetchInterval: FAST });

export const useRevenue = () =>
  useQuery({ queryKey: opsKeys.revenue, queryFn: getRevenue, refetchInterval: SLOW });

export const useFunnel = (window: FunnelWindow) =>
  useQuery({ queryKey: opsKeys.funnel(window), queryFn: () => getFunnel(window), refetchInterval: SLOW });

export const useTenants = (search: string) =>
  useQuery({ queryKey: opsKeys.tenants(search), queryFn: () => getTenants({ search }), refetchInterval: SLOW });

export const useIncidents = (filters: { severity?: string; source?: string; triage_status?: string }) =>
  useQuery({ queryKey: opsKeys.incidents(filters), queryFn: () => getIncidents(filters), refetchInterval: FAST });

export const useIncident = (key: string) =>
  useQuery({ queryKey: opsKeys.incident(key), queryFn: () => getIncident(key), refetchInterval: FAST });

export function useTrace(params: TraceParams) {
  const hasAnyParam = Object.values(params).some(Boolean);
  return useQuery({
    queryKey: opsKeys.trace(params),
    queryFn: () => getTrace(params),
    enabled: hasAnyParam,
  });
}
