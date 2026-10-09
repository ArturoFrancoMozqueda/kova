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
  RateLimitError: class RateLimitError extends Error {
    constructor(message: string, public readonly retryAfterMs: number) { super(message); }
  },
  syncOfflineSales: vi.fn().mockResolvedValue([]),
}));

import { setActiveOfflineTenant } from "./activeTenant";
import { scheduleOfflineSyncRetry, stopOfflineSync } from "./syncWorker";
import { RateLimitError } from "./sync";

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

  it.each([new Error("Network error"), new RateLimitError("Rate limited", 60_000)])("schedules foreground failure recovery with the correct cooldown", async (error) => {
    setActiveOfflineTenant("tenant-1");
    stopOfflineSync();
    scheduleOfflineSyncRetry("tenant-1", error);
    const delay = error instanceof RateLimitError ? error.retryAfterMs : 2_000;

    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(queueMocks.recoverExpiredLeases).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(queueMocks.recoverExpiredLeases).toHaveBeenCalledWith("tenant-1");
  });

  it("preserves an existing rate-limit cooldown and cancels it on logout", async () => {
    setActiveOfflineTenant("tenant-1");
    stopOfflineSync();
    scheduleOfflineSyncRetry("tenant-1", new RateLimitError("Rate limited", 60_000));
    scheduleOfflineSyncRetry("tenant-1", new Error("Network error"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(queueMocks.recoverExpiredLeases).not.toHaveBeenCalled();

    setActiveOfflineTenant(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queueMocks.recoverExpiredLeases).not.toHaveBeenCalled();
  });

  it("extends an ordinary retry when another checkout receives Retry-After", async () => {
    setActiveOfflineTenant("tenant-1");
    stopOfflineSync();
    scheduleOfflineSyncRetry("tenant-1", new Error("Network error"));
    scheduleOfflineSyncRetry("tenant-1", new RateLimitError("Rate limited", 60_000));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(queueMocks.recoverExpiredLeases).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(queueMocks.recoverExpiredLeases).toHaveBeenCalledWith("tenant-1");
  });
});
