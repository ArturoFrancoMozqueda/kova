import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeStory } from "../__fixtures__/story";
import type { BusinessStoryReport, SalesByHourRow } from "../types";
import type { StockItem, InventoryVelocityItem } from "../../inventory/types";

const auth = vi.hoisted(() => ({ tenantId: "tenant-a" }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: {
  status: "authenticated", tenantId: auth.tenantId, user: { id: "owner", role: "owner" }, sessionMode: "online",
} }) }));
vi.mock("../api", () => ({ getBusinessStory: vi.fn(), getSalesByHour: vi.fn(), invalidateReportsCache: vi.fn() }));
vi.mock("../../inventory/api", () => ({ listStock: vi.fn(), listVelocity: vi.fn() }));
import { getBusinessStory, getSalesByHour } from "../api";
import { listStock, listVelocity } from "../../inventory/api";
import { useReportData } from "./useReportData";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.tenantId = "tenant-a";
});

describe("progressive report reads", () => {
  it("reveals the accepted primary story while independent reads are still pending", async () => {
    const primary = deferred<BusinessStoryReport>();
    const previous = deferred<BusinessStoryReport>();
    const hourly = deferred<SalesByHourRow[]>();
    const stock = deferred<StockItem[]>();
    const velocity = deferred<InventoryVelocityItem[]>();
    vi.mocked(getBusinessStory).mockImplementation(start => start === "2026-10-01" ? primary.promise : previous.promise);
    vi.mocked(getSalesByHour).mockReturnValue(hourly.promise);
    vi.mocked(listStock).mockReturnValue(stock.promise);
    vi.mocked(listVelocity).mockReturnValue(velocity.promise);
    const { result } = renderHook(() => useReportData("2026-10-01", "2026-10-02", true));
    await act(async () => primary.resolve(makeStory()));
    expect(result.current.status).toBe("loaded");
    expect(result.current.story?.summary.net_sales).toBe("10000");
    expect(result.current.pending).toEqual({ previous: true, hourly: true, stock: true, velocity: true, trend: false });
    expect(result.current.stockFailed).toBe(false);
    await act(async () => hourly.resolve([]));
    expect(result.current.pending.hourly).toBe(false);
    expect(result.current.pending.stock).toBe(true);
    await act(async () => stock.reject(new Error("Unavailable")));
    expect(result.current.stockFailed).toBe(true);
    expect(result.current.pending.stock).toBe(false);
    expect(result.current.status).toBe("loaded");
  });

  it("keeps the subscription gate closed even when supporting datasets finish first", async () => {
    const primary = deferred<BusinessStoryReport>();
    vi.mocked(getBusinessStory).mockImplementation(start => start === "2026-10-01" ? primary.promise : Promise.resolve(makeStory()));
    vi.mocked(getSalesByHour).mockResolvedValue([]);
    vi.mocked(listStock).mockResolvedValue([]);
    vi.mocked(listVelocity).mockResolvedValue([]);
    const { result } = renderHook(() => useReportData("2026-10-01", "2026-10-02", true));
    await waitFor(() => expect(result.current.pending.stock).toBe(false));
    expect(result.current.status).toBe("loading");
    expect(result.current.story).toBeNull();
    await act(async () => primary.reject({ status: 402 }));
    expect(result.current.status).toBe("subscription-inactive");
    expect(result.current.story).toBeNull();
  });

  it("discards every old dataset and late response when the business or range changes", async () => {
    const oldHourly = deferred<SalesByHourRow[]>();
    vi.mocked(getBusinessStory).mockResolvedValue(makeStory());
    vi.mocked(getSalesByHour).mockReturnValue(oldHourly.promise);
    vi.mocked(listStock).mockResolvedValue([]);
    vi.mocked(listVelocity).mockResolvedValue([]);
    const { result, rerender } = renderHook(({ start }) => useReportData(start, "2026-10-03", true), { initialProps: { start: "2026-10-01" } });
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    const next = deferred<BusinessStoryReport>();
    vi.mocked(getBusinessStory).mockReturnValue(next.promise);
    vi.mocked(getSalesByHour).mockReturnValue(new Promise(() => {}));
    auth.tenantId = "tenant-b";
    rerender({ start: "2026-10-02" });
    expect(result.current.status).toBe("loading");
    expect(result.current.story).toBeNull();
    await act(async () => oldHourly.resolve([{ hour: 9, order_count: 1, net_sales: "999", average_ticket: "999" } as SalesByHourRow]));
    expect(result.current.hourly).toEqual([]);
    expect(result.current.pending.hourly).toBe(true);
  });
});
