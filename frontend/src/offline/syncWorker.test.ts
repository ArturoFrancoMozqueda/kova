import { beforeEach, describe, expect, it, vi } from "vitest";

const queueMocks = vi.hoisted(() => ({
  recoverExpiredLeases: vi.fn().mockResolvedValue(0),
  claimPendingOfflineSales: vi.fn().mockResolvedValue([]),
  markOfflineSaleFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db", () => ({
  offlineDb: {
    offline_sales: {
      where: () => ({
        equals: () => ({
          limit: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
  },
}));
vi.mock("./queue", () => queueMocks);
vi.mock("./sync", () => ({
  RateLimitError: class RateLimitError extends Error {},
  syncOfflineSales: vi.fn().mockResolvedValue([]),
}));

import { setActiveOfflineTenant } from "./activeTenant";
import "./syncWorker";

describe("offline sync worker session activation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setActiveOfflineTenant(null);
  });

  it("retries sync when AuthProvider publishes the tenant after child mount effects", async () => {
    setActiveOfflineTenant("tenant-1");
    await vi.runAllTimersAsync();

    expect(queueMocks.recoverExpiredLeases).toHaveBeenCalledWith("tenant-1");
  });
});
