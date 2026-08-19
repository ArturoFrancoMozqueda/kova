// API client for the internal ops dashboard. Mirrors the repo's per-feature
// requestJson/ApiError pattern (see reports/api.ts). CSRF headers are attached
// to state-changing calls; the guard needs ApiError.status to tell 401 from 403.
import { csrfHeaders } from "@/lib/csrf";
import type {
  Funnel,
  FunnelWindow,
  IncidentDetail,
  IncidentList,
  OpsMe,
  OpsMfaConfirm,
  OpsMfaSetup,
  OpsMfaStatus,
  OpsMfaVerify,
  OpsNote,
  Overview,
  Revenue,
  Technical,
  TenantList,
  TraceParams,
  TraceResult,
  TriageStatus,
} from "./types";

const BASE = "/api/v1/internal/ops";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

function mutate<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json", ...csrfHeaders(method) },
    body: JSON.stringify(body),
  });
}

export const getOpsMe = () => requestJson<OpsMe>(`${BASE}/me`);
export const getOpsMfaStatus = () => requestJson<OpsMfaStatus>(`${BASE}/mfa/status`);
export const setupOpsMfa = (password: string, enrollmentKey: string) =>
  mutate<OpsMfaSetup>(`${BASE}/mfa/setup`, "POST", { password, enrollment_key: enrollmentKey });
export const confirmOpsMfa = (password: string, enrollmentKey: string, code: string) =>
  mutate<OpsMfaConfirm>(`${BASE}/mfa/confirm`, "POST", {
    password,
    enrollment_key: enrollmentKey,
    code,
  });
export const verifyOpsMfa = (code: string) =>
  mutate<OpsMfaVerify>(`${BASE}/mfa/verify`, "POST", { code });
export const getOverview = () => requestJson<Overview>(`${BASE}/overview`);
export const getTechnical = () => requestJson<Technical>(`${BASE}/technical`);
export const getRevenue = () => requestJson<Revenue>(`${BASE}/revenue`);
export const getFunnel = (window: FunnelWindow) =>
  requestJson<Funnel>(`${BASE}/funnel?window=${window}`);

export function getTenants(params: { search?: string } = {}): Promise<TenantList> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  const suffix = qs.toString() ? `?${qs}` : "";
  return requestJson<TenantList>(`${BASE}/tenants${suffix}`);
}

export function getIncidents(
  params: { severity?: string; source?: string; triage_status?: string } = {},
): Promise<IncidentList> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  return requestJson<IncidentList>(`${BASE}/incidents${suffix}`);
}

export const getIncident = (key: string) =>
  requestJson<IncidentDetail>(`${BASE}/incidents/${encodeURIComponent(key)}`);

export function getTrace(params: TraceParams): Promise<TraceResult> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  return requestJson<TraceResult>(`${BASE}/trace?${qs}`);
}

export const updateTriage = (key: string, body: { triage_status?: TriageStatus; snoozed_until?: string }) =>
  mutate<IncidentDetail>(`${BASE}/incidents/${encodeURIComponent(key)}/triage`, "PATCH", body);

export function getNotes(params: {
  entity_type?: string;
  entity_source?: string;
  entity_external_id?: string;
  tenant_id?: string;
}): Promise<{ items: OpsNote[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  return requestJson<{ items: OpsNote[]; total: number }>(`${BASE}/notes${suffix}`);
}

export const createNote = (body: {
  entity_type: string;
  entity_source?: string;
  entity_external_id?: string;
  tenant_id?: string;
  body: string;
}) => mutate<OpsNote>(`${BASE}/notes`, "POST", body);
