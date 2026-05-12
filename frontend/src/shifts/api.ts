import type { CashMovement, CashMovementPayload, Shift, ShiftClosePayload, ShiftOpenPayload } from "./types";

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
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

export function getOpenShift(): Promise<Shift | null> {
  return requestJson<Shift | null>("/api/v1/shifts/current");
}

export function getShift(shiftId: string): Promise<Shift> {
  return requestJson<Shift>(`/api/v1/shifts/${shiftId}`);
}

export function listClosedShifts(): Promise<Shift[]> {
  return requestJson<Shift[]>("/api/v1/shifts");
}

export function openShift(payload: ShiftOpenPayload): Promise<Shift> {
  return requestJson<Shift>("/api/v1/shifts", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

export function closeShift(shiftId: string, payload: ShiftClosePayload): Promise<Shift> {
  return requestJson<Shift>(`/api/v1/shifts/${shiftId}/close`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

export function recordCashMovement(shiftId: string, payload: CashMovementPayload): Promise<CashMovement> {
  return requestJson<CashMovement>(`/api/v1/shifts/${shiftId}/cash-movements`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listCashMovements(shiftId: string): Promise<CashMovement[]> {
  return requestJson<CashMovement[]>(`/api/v1/shifts/${shiftId}/cash-movements`);
}
