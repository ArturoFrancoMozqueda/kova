import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the queue module so sync.ts never touches IndexedDB in the test env.
vi.mock("./queue", () => ({
  markOfflineSaleStatus: vi.fn().mockResolvedValue(undefined),
  markOfflineSaleSynced: vi.fn().mockResolvedValue(undefined),
  markOfflineSaleFailed: vi.fn().mockResolvedValue(undefined),
  rollbackOfflineSaleAttempt: vi.fn().mockResolvedValue(undefined),
}));

import { rollbackOfflineSaleAttempt } from "./queue";
import { parseRetryAfterMs, RateLimitError, syncOfflineSales } from "./sync";
import type { OfflineSaleQueueItem } from "./types";

function queueItem(overrides: Partial<OfflineSaleQueueItem> = {}): OfflineSaleQueueItem {
  return {
    client_uuid: "00000000-0000-4000-8000-000000000001",
    status: "pending",
    sale: {
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [{ method: "cash", amount: "18.50", amount_tendered: "20.00" }],
    },
    attempt_count: 0,
    created_at: "2026-07-01T23:50:00.000Z",
    updated_at: "2026-07-01T23:50:00.000Z",
    ...overrides,
  };
}

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });

  it("falls back to a default when the header is missing", () => {
    expect(parseRetryAfterMs(null)).toBe(60_000);
  });

  it("parses an HTTP date into a non-negative delay", () => {
    const future = new Date(Date.now() + 45_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(46_000);
  });
});

describe("syncOfflineSales", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the ring-time occurred_at (created_at) in the payload", async () => {
    let capturedBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return new Response(
          JSON.stringify({
            results: [
              {
                client_uuid: "00000000-0000-4000-8000-000000000001",
                status: "synced",
                order_id: "order-1",
                order: null,
                error: null,
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    await syncOfflineSales([queueItem()]);

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody as string);
    expect(parsed.sales[0].occurred_at).toBe("2026-07-01T23:50:00.000Z");
  });

  it("throws RateLimitError honoring Retry-After on 429 and rolls back to pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "12" },
          }),
      ),
    );

    await expect(syncOfflineSales([queueItem()])).rejects.toBeInstanceOf(RateLimitError);
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.any(String),
    );
  });

  it("exposes the Retry-After delay on the thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "12" },
          }),
      ),
    );

    const err = await syncOfflineSales([queueItem()]).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(12_000);
  });
});
