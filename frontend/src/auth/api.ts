import { csrfHeaders } from "../lib/csrf";
import { funnelClientHeaders } from "../telemetry/funnel";
import type {
  LoginRequest,
  MeResponse,
  MessageResponse,
  SessionProbeResponse,
  SignupRequest,
  SignupResponse,
} from "./types";
import { announceSessionChange, clearLogoutPending } from "./sessionCoordination";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...csrfHeaders(init?.method),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

export function signup(body: SignupRequest): Promise<SignupResponse> {
  // The pseudonymous funnel id travels as a header, not in the body: it is
  // analytics stitching, not part of the account being created. The server
  // records `signup_completed` itself once the account exists — the browser is
  // no longer trusted to assert its own conversion.
  return requestJson<SignupResponse>("/api/v1/auth/signup", {
    method: "POST",
    headers: funnelClientHeaders(),
    body: JSON.stringify(body),
  });
}

/** Ask for a fresh verification email for the *signed-in* account. The address
 * is resolved server-side from the session, never sent by the client. */
export function resendVerificationEmail(): Promise<MessageResponse> {
  return requestJson<MessageResponse>("/api/v1/auth/verify/resend", {
    method: "POST",
  });
}

export function verifyEmail(token: string): Promise<MessageResponse> {
  return requestJson<MessageResponse>("/api/v1/auth/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function login(body: LoginRequest): Promise<MessageResponse> {
  const response = await requestJson<MessageResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
  // The shared cookie may now represent another user or tenant. Discard the
  // previously verified local identity before probing it; a dropped session
  // response must never reopen the old tenant as an offline fallback.
  await import("@/offline/offlineAccess")
    .then(({ clearOfflineAccess }) => clearOfflineAccess())
    .catch(() => undefined);
  clearLogoutPending();
  // Cookies are shared across tabs. Tell every already-open Kova surface to
  // suspend its old identity and probe the server before it can mutate again.
  announceSessionChange();
  return response;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/v1/auth/logout", {
    method: "POST",
    headers: { ...csrfHeaders("POST") },
  });
  if (!response.ok && response.status !== 401) {
    throw new ApiError(await response.text(), response.status);
  }
}

export function getMe(): Promise<MeResponse> {
  return requestJson<MeResponse>("/api/v1/auth/me");
}

export function getSession(): Promise<SessionProbeResponse> {
  return requestJson<SessionProbeResponse>("/api/v1/auth/session");
}

export async function refreshSession(): Promise<boolean> {
  const response = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", ...csrfHeaders("POST") },
  });
  if (response.ok) return true;
  if (response.status === 401) return false;
  throw new ApiError(await response.text(), response.status);
}

export function requestPasswordReset(email: string): Promise<MessageResponse & { dev_reset_token?: string | null }> {
  return requestJson<MessageResponse & { dev_reset_token?: string | null }>(
    "/api/v1/auth/password-reset/request",
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
  );
}

export function confirmPasswordReset(token: string, newPassword: string): Promise<MessageResponse> {
  return requestJson<MessageResponse>("/api/v1/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}
