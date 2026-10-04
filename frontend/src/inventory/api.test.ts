import { afterEach, describe, expect, it, vi } from "vitest";
import { adjustStock, recordStockTake, updateLowStockThreshold } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("inventory idempotency headers", () => {
  it.each([
    { name: "adjustment", send: (key: string) => adjustStock("product-1", 3, "Compra", null, key) },
    { name: "stock take", send: (key: string) => recordStockTake("product-1", 3, "Conteo", key) },
    { name: "threshold", send: (key: string) => updateLowStockThreshold("product-1", 3, key) },
  ])("sends the preserved operation key for $name retries", async ({ send }) => {
    const keys: string[] = [];
    const processed = new Set<string>();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get("Idempotency-Key")!;
      keys.push(key);
      if (!processed.has(key)) {
        processed.add(key);
        throw new TypeError("Response lost after server commit");
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(send("stable-operation-key")).rejects.toThrow("Response lost");
    await send("stable-operation-key");
    expect(keys).toEqual(["stable-operation-key", "stable-operation-key"]);
    expect(processed.size).toBe(1);
  });
});
