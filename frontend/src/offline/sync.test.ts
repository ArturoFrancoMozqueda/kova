import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the queue module so sync.ts never touches IndexedDB in the test env.
vi.mock("./queue", () => ({
  markOfflineSaleStatus: vi.fn().mockResolvedValue(undefined),
  markOfflineSaleSynced: vi.fn().mockResolvedValue(undefined),
  markOfflineSaleFailed: vi.fn().mockResolvedValue(undefined),
  rollbackOfflineSaleAttempt: vi.fn().mockResolvedValue(undefined),
}));

import { markOfflineSaleFailed, markOfflineSaleStatus, markOfflineSaleSynced, rollbackOfflineSaleAttempt } from "./queue";
import { parseRetryAfterMs, RateLimitError, syncOfflineSales } from "./sync";
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
    expect(markOfflineSaleStatus).toHaveBeenCalledWith(
      "tenant-1",
      "00000000-0000-4000-8000-000000000001",
      "lease-1",
      "pending",
      "Refresh temporarily unavailable",
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
    expect(vi.mocked((await import("./queue")).markOfflineSaleStatus)).toHaveBeenCalledWith(
      "tenant-1",
      expect.any(String),
      "lease-1",
      "pending",
      expect.any(String),
    );
  });
});
