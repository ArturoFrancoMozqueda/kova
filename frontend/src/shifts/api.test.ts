import { afterEach, describe, expect, it, vi } from "vitest";
import { recordCashMovement } from "./api";

describe("recordCashMovement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses the caller-provided intent identity and payload after a lost response", async () => {
    const responseBody = {
      id: "movement-1",
      shift_id: "shift-1",
      type: "cash_out",
      amount: "20.00",
      reason: "Compra de insumos",
      created_at: "2026-09-06T12:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Response lost"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      type: "cash_out" as const,
      amount: "20.00",
      reason: "Compra de insumos",
    };
    const idempotencyKey = "stable-movement-intent";

    await expect(
      recordCashMovement("shift-1", payload, idempotencyKey),
    ).rejects.toThrow("Response lost");
    await expect(
      recordCashMovement("shift-1", payload, idempotencyKey),
    ).resolves.toEqual(responseBody);

    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(firstInit.body).toBe(retryInit.body);
    expect(firstInit.headers).toMatchObject({
      "Idempotency-Key": idempotencyKey,
    });
    expect(retryInit.headers).toMatchObject({
      "Idempotency-Key": idempotencyKey,
    });
  });
});
