import type {
  LoginRequest,
  MeResponse,
  MessageResponse,
  SessionProbeResponse,
  SignupRequest,
  SignupResponse,
} from "./types";

class ApiError extends Error {
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
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

export function signup(body: SignupRequest): Promise<SignupResponse> {
  return requestJson<SignupResponse>("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifyEmail(token: string): Promise<MessageResponse> {
  return requestJson<MessageResponse>("/api/v1/auth/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function login(body: LoginRequest): Promise<MessageResponse> {
  return requestJson<MessageResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/v1/auth/logout", { method: "POST" });
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
    headers: { "content-type": "application/json" },
  });
  return response.ok;
}
