import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the queue module so sync.ts never touches IndexedDB in the test env.
vi.mock("./queue", () => ({
  markOfflineSaleStatus: vi.fn().mockResolvedValue(undefined),
  markOfflineSaleSynced: vi.fn().mockResolvedValue(undefined),
  markOfflineSaleFailed: vi.fn().mockResolvedValue(undefined),
  rollbackOfflineSaleAttempt: vi.fn().mockResolvedValue(undefined),
}));

import { markOfflineSaleFailed, markOfflineSaleStatus, markOfflineSaleSynced, rollbackOfflineSaleAttempt } from "./queue";
import {
  BillingAccessError, parseRetryAfterMs, RateLimitError, SYNC_REQUEST_TIMEOUT_MS, syncOfflineSales,
  SyncTimeoutError, SyncTransientError,
} from "./sync";
import { SyncSessionError } from "./syncStatus";
import type { OfflineSaleQueueItem } from "./types";
import { setActiveOfflineTenant } from "./activeTenant";

function queueItem(overrides: Partial<OfflineSaleQueueItem> = {}): OfflineSaleQueueItem {
  return {
    client_uuid: "00000000-0000-4000-8000-000000000001",
    tenant_id: "tenant-1",
    status: "pending",
    sale: {
      items: [{ product_id: "product-1", quantity: 1 }],
      payments: [{ method: "cash", amount: "18.50", amount_tendered: "20.00" }],
    },
    attempt_count: 0,
    sync_owner: "worker-1",
    lease_id: "lease-1",
    sync_started_at: "2026-07-01T23:50:01.000Z",
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
    setActiveOfflineTenant("tenant-1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveOfflineTenant(null);
  });

  it("preserves unpaid tenants' queued sales and retry budget until payment recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("payment_required", { status: 402 })));
    const item = queueItem();
    await expect(syncOfflineSales("tenant-1", [item])).rejects.toBeInstanceOf(BillingAccessError);
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith("tenant-1", item.client_uuid, "lease-1", expect.any(String));
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
    expect(markOfflineSaleSynced).not.toHaveBeenCalled();
    expect(markOfflineSaleStatus).not.toHaveBeenCalled();
  });

  it("sends each queued branch and rejects a different branch acknowledgement", async () => {
    const item = queueItem({ branch_id: "branch-centro" });
    const orderId = "10000000-0000-4000-8000-000000000001";
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{
      client_uuid: item.client_uuid, status: "synced", order_id: orderId,
      order: { id: orderId, tenant_id: "tenant-1", branch_id: "branch-norte" },
    }] }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    await expect(syncOfflineSales("tenant-1", [item])).rejects.toThrow(/se reintentará/);
    const payload = JSON.parse(request.mock.calls[0][1].body);
    expect(payload.sales[0].branch_id).toBe("branch-centro");
    expect(markOfflineSaleSynced).not.toHaveBeenCalled();
    expect(markOfflineSaleStatus).toHaveBeenCalledWith(
      "tenant-1", item.client_uuid, "lease-1", "pending", expect.any(String),
    );
  });

  it.each([
    { results: [] },
    { results: null },
    {},
    null,
    { results: [null] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "pending" }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced" }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced", order_id: null }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced", order_id: "" }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced", order_id: "not-an-order-id" }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced", order_id: 123 }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001", order: "invalid" }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001", order: { id: "10000000-0000-4000-8000-000000000002", tenant_id: "tenant-1" } }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001", order: { id: "10000000-0000-4000-8000-000000000001", tenant_id: "tenant-2" } }] },
    { results: [{ client_uuid: queueItem().client_uuid, status: "failed", error: { detail: "invalid" } }] },
    { results: [{ client_uuid: "unrequested-sale", status: "synced", order_id: "10000000-0000-4000-8000-000000000001" }] },
    { results: [
      { client_uuid: queueItem().client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001" },
      { client_uuid: queueItem().client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001" },
    ] },
    { results: [
      { client_uuid: queueItem().client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001" },
      { client_uuid: "unrequested-sale", status: "synced", order_id: "10000000-0000-4000-8000-000000000002" },
    ] },
    { results: [
      { client_uuid: queueItem().client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001" },
      { client_uuid: queueItem().client_uuid, status: "failed", error: "Conflicting acknowledgement" },
    ] },
  ])("keeps the sale retryable when the acknowledgement is invalid: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));

    await expect(syncOfflineSales("tenant-1", [queueItem()])).rejects.toThrow(/se reintentará/);

    expect(markOfflineSaleStatus).toHaveBeenCalledWith(
      "tenant-1", queueItem().client_uuid, "lease-1", "pending", expect.any(String),
    );
    expect(markOfflineSaleSynced).not.toHaveBeenCalled();
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
  });

  it("releases every lease when a successful response omits one sale", async () => {
    const first = queueItem();
    const second = queueItem({ client_uuid: "00000000-0000-4000-8000-000000000002", lease_id: "lease-2" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ client_uuid: first.client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001" }],
    }), { status: 200 })));

    await expect(syncOfflineSales("tenant-1", [first, second])).rejects.toThrow(/se reintentará/);

    for (const item of [first, second]) {
      expect(markOfflineSaleStatus).toHaveBeenCalledWith(
        "tenant-1", item.client_uuid, item.lease_id, "pending", expect.any(String),
      );
    }
    expect(markOfflineSaleSynced).not.toHaveBeenCalled();
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
  });

  it("handles a complete batch in response order with independent sale outcomes", async () => {
    const first = queueItem();
    const second = queueItem({ client_uuid: "00000000-0000-4000-8000-000000000002", lease_id: "lease-2" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { client_uuid: second.client_uuid, status: "failed", error: "Producto no disponible" },
        { client_uuid: first.client_uuid, status: "synced", order_id: "10000000-0000-4000-8000-000000000001" },
      ],
    }), { status: 200 })));

    const results = await syncOfflineSales("tenant-1", [first, second]);

    expect(results).toHaveLength(2);
    expect(markOfflineSaleSynced).toHaveBeenCalledWith("tenant-1", first.client_uuid, "lease-1", "10000000-0000-4000-8000-000000000001");
    expect(markOfflineSaleFailed).toHaveBeenCalledWith("tenant-1", second.client_uuid, "lease-2", "Producto no disponible");
    expect(markOfflineSaleStatus).not.toHaveBeenCalled();
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
                order_id: "10000000-0000-4000-8000-000000000001",
                order: {
                  id: "10000000-0000-4000-8000-000000000001",
                  tenant_id: "tenant-1",
                  status: "completed",
                  subtotal_amount: "18.50",
                  total_amount: "18.50",
                  items: [],
                  payments: [],
                },
                error: null,
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    await syncOfflineSales("tenant-1", [
      queueItem({
        receipt_snapshot: {
          business_name: "Panadería Kova",
          created_at: "2026-07-01T23:50:00.000Z",
          items: [],
          subtotal_amount: "18.50",
          total_amount: "18.50",
          payments: [{ method: "cash", amount_amount: "18.50" }],
          total_tendered: "20.00",
          total_change: "1.50",
        },
      }),
    ]);

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody as string);
    expect(parsed.sales[0].occurred_at).toBe("2026-07-01T23:50:00.000Z");
    expect(parsed.sales[0].receipt_snapshot).toBeUndefined();
    expect(parsed.sales[0].order.receipt_snapshot).toBeUndefined();
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

    await expect(syncOfflineSales("tenant-1", [queueItem()])).rejects.toBeInstanceOf(RateLimitError);
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith(
      "tenant-1",
      "00000000-0000-4000-8000-000000000001",
      "lease-1",
      expect.any(String),
    );
  });

  it("keeps sales pending when session recovery is temporarily unavailable", async () => {
    const refreshOutage = Object.assign(new Error("Refresh temporarily unavailable"), { status: 503 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(refreshOutage));

    await expect(syncOfflineSales("tenant-1", [queueItem()])).rejects.toBe(refreshOutage);
    // A connection problem releases the lease without spending a retry.
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith(
      "tenant-1",
      "00000000-0000-4000-8000-000000000001",
      "lease-1",
      expect.any(String),
    );
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
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

    const err = await syncOfflineSales("tenant-1", [queueItem()]).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(12_000);
  });

  it("refuses to send a batch after the authenticated tenant changes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setActiveOfflineTenant("tenant-2");

    await expect(syncOfflineSales("tenant-1", [queueItem()])).rejects.toThrow(/tenant changed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight request when logout changes the active tenant", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));

    const pending = syncOfflineSales("tenant-1", [queueItem()]);
    await Promise.resolve();
    setActiveOfflineTenant(null);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith(
      "tenant-1",
      expect.any(String),
      "lease-1",
      expect.any(String),
    );
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
  });

  it("times out a hung request and releases its leases without failing the sale", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })));
      const pending = syncOfflineSales("tenant-1", [queueItem()]).catch((e) => e);
      await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS);
      expect(await pending).toBeInstanceOf(SyncTimeoutError);
      expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith("tenant-1", queueItem().client_uuid, "lease-1", expect.any(String));
      expect(markOfflineSaleFailed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([500, 502, 503, 504])("treats HTTP %s as transient: no failed sales, no retry consumed", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status })));
    await expect(syncOfflineSales("tenant-1", [queueItem()])).rejects.toBeInstanceOf(SyncTransientError);
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith("tenant-1", queueItem().client_uuid, "lease-1", expect.any(String));
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
  });

  it("treats an unreadable success body (captive portal) as transient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>login</html>", { status: 200 })));
    await expect(syncOfflineSales("tenant-1", [queueItem()])).rejects.toBeDefined();
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalled();
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409, 415])("does not fail any sale in the batch on a batch-level %s", async (status) => {
    const first = queueItem();
    const second = queueItem({ client_uuid: "00000000-0000-4000-8000-000000000002", lease_id: "lease-2" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status })));
    const err = await syncOfflineSales("tenant-1", [first, second]).catch((e) => e);
    expect(err).toBeInstanceOf(SyncSessionError);
    expect((err as SyncSessionError).kind).toBe(status === 415 ? "unavailable" : "session");
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith("tenant-1", first.client_uuid, "lease-1", expect.any(String));
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith("tenant-1", second.client_uuid, "lease-2", expect.any(String));
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
  });

  it("splits a 413 batch until it isolates the sale that is too large", async () => {
    const items = [1, 2, 3].map((n) => queueItem({ client_uuid: `00000000-0000-4000-8000-00000000000${n}`, lease_id: `lease-${n}` }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sales = JSON.parse(init.body as string).sales as Array<{ client_uuid: string }>;
      if (sales.some((sale) => sale.client_uuid === items[0].client_uuid)) return new Response("too large", { status: 413 });
      return new Response(JSON.stringify({ results: sales.map((sale, index) => ({
        client_uuid: sale.client_uuid, status: "synced", order_id: `10000000-0000-4000-8000-00000000000${index + 1}`,
      })) }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await syncOfflineSales("tenant-1", items);

    expect(results.map((result) => [result.client_uuid, result.status])).toEqual([
      [items[0].client_uuid, "failed"], [items[1].client_uuid, "synced"], [items[2].client_uuid, "synced"],
    ]);
    expect(markOfflineSaleFailed).toHaveBeenCalledTimes(1);
    expect(markOfflineSaleFailed).toHaveBeenCalledWith("tenant-1", items[0].client_uuid, "lease-1", expect.any(String), "SYNC_PAYLOAD_TOO_LARGE");
    expect(markOfflineSaleSynced).toHaveBeenCalledTimes(2);
  });

  it("releases the unsent half when a split request hits a transient error", async () => {
    const items = [1, 2].map((n) => queueItem({ client_uuid: `00000000-0000-4000-8000-00000000000${n}`, lease_id: `lease-${n}` }));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("bad", { status: 422 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch")));
    await expect(syncOfflineSales("tenant-1", items)).rejects.toBeInstanceOf(TypeError);
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith("tenant-1", items[0].client_uuid, "lease-1", expect.any(String));
    expect(rollbackOfflineSaleAttempt).toHaveBeenCalledWith("tenant-1", items[1].client_uuid, "lease-2", expect.any(String));
    expect(markOfflineSaleFailed).not.toHaveBeenCalled();
  });
});
