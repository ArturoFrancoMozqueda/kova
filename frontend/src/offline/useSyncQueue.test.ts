import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineSaleQueueItem } from "./types";

const session = vi.hoisted(() => ({ status: "authenticated", tenantId: "tenant-a" }));
const listeners = vi.hoisted(() => [] as Array<(value: unknown) => void>);

vi.mock("dexie", () => ({
  liveQuery: () => ({
    subscribe: (listener: (value: unknown) => void) => {
      listeners.push(listener);
      return { unsubscribe: vi.fn() };
    },
  }),
}));
vi.mock("./db", () => ({ offlineDb: {} }));
vi.mock("./queue", () => ({ discardQuarantinedSales: vi.fn(), retryDeadLetter: vi.fn() }));
vi.mock("./syncWorker", () => ({ triggerSync: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: session }) }));

import { useSyncQueue } from "./useSyncQueue";

const failedSale: OfflineSaleQueueItem = {
  client_uuid: "sale-a", tenant_id: "tenant-a", status: "failed",
  sale: { items: [{ product_id: "private-product-a", quantity: 1 }], payments: [{ method: "cash", amount: "18.50" }] },
  attempt_count: 1, created_at: "2026-10-04T12:00:00Z", updated_at: "2026-10-04T12:00:00Z",
};

describe("offline queue visibility when the session changes", () => {
  beforeEach(() => {
    session.status = "authenticated";
    session.tenantId = "tenant-a";
    listeners.length = 0;
  });

  it.each(["tenant-b", null])("hides the previous tenant from the first render for session %s", (tenantId) => {
    const renders: Array<ReturnType<typeof useSyncQueue>> = [];
    const { result, rerender } = renderHook(() => {
      const queue = useSyncQueue();
      renders.push(queue);
      return queue;
    });
    act(() => {
      listeners[0](3);
      listeners[1]([failedSale]);
      listeners[2](2);
    });
    expect(result.current.failedEntries).toEqual([failedSale]);
    expect(result.current.pendingCount).toBe(3);

    const firstNewRender = renders.length;
    session.status = tenantId ? "authenticated" : "anonymous";
    session.tenantId = tenantId ?? "";
    rerender();

    expect(renders[firstNewRender]).toMatchObject({ pendingCount: 0, failedEntries: [], quarantinedCount: 0 });
    expect(result.current.failedEntries).toEqual([]);

    // Even an already queued callback from a disposed subscription cannot
    // republish the previous tenant after the session changed.
    act(() => listeners[1]([failedSale]));
    expect(result.current.failedEntries).toEqual([]);

    if (tenantId) {
      const tenantBSale = { ...failedSale, client_uuid: "sale-b", tenant_id: tenantId };
      act(() => {
        listeners[3](1);
        listeners[4]([tenantBSale]);
      });
      expect(result.current.pendingCount).toBe(1);
      expect(result.current.failedEntries).toEqual([tenantBSale]);
    }
  });
});
