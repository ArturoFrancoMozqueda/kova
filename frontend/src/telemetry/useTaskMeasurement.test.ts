import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTaskMeasurement } from "./useTaskMeasurement";
import { useTaskMeasurement } from "./useTaskMeasurement";
import { act, renderHook } from "@testing-library/react";
import { trackFunnelEvent } from "./funnel";

vi.mock("./funnel", () => ({ trackFunnelEvent: vi.fn(async () => {}) }));
let now = 0;
beforeEach(() => {
  vi.clearAllMocks();
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => vi.restoreAllMocks());

it("separates visible work, network waits and hidden time with one result per attempt", () => {
  const task = createTaskMeasurement("customer_order", { tenantId: "tenant-a", userId: "user-a" });
  task.start(); task.start();
  now = 200; task.pause();
  now = 1200; task.resume();
  now = 1400;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  now = 11400;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  now = 11600; task.finish("completed"); task.finish("completed");
  expect(trackFunnelEvent).toHaveBeenCalledTimes(2);
  const properties = vi.mocked(trackFunnelEvent).mock.calls[1][1];
  expect(properties).toMatchObject({ task: "customer_order", outcome: "completed", active_ms: 600, elapsed_ms: 11600, offline: false });
  expect(properties?.attempt_id).toBe(vi.mocked(trackFunnelEvent).mock.calls[0][1]?.attempt_id);
});

it("measures queued work separately from completion and uses a fresh attempt after a failure", () => {
  const task = createTaskMeasurement("cash_sale", { tenantId: "tenant-a", userId: "user-a" });
  task.start(); now = 10; task.finish("failed");
  task.start(); window.dispatchEvent(new Event("offline")); now = 30; task.finish("queued");
  const calls = vi.mocked(trackFunnelEvent).mock.calls;
  expect(calls[1][1]?.outcome).toBe("failed");
  expect(calls[3][1]).toMatchObject({ outcome: "queued", offline: true });
  expect(calls[0][1]?.attempt_id).not.toBe(calls[2][1]?.attempt_id);
});

it("discards an unmounted attempt without inventing a completed or cancelled operation", () => {
  const task = createTaskMeasurement("purchase_receipt", { tenantId: "tenant-a", userId: "user-a" });
  task.start(); task.discard(); task.finish("completed");
  expect(trackFunnelEvent).toHaveBeenCalledTimes(1);
});

it("keeps concurrent submitted sales independent when their responses arrive in reverse order", () => {
  const owner = { tenantId: "tenant-a", userId: "user-a" };
  const { result, unmount } = renderHook(() => useTaskMeasurement("cash_sale", "a", owner));
  act(() => result.current.start());
  const first = result.current.detach(); first.pause();
  now = 100;
  act(() => result.current.start());
  now = 300;
  const second = result.current.detach(); second.pause();
  now = 500; second.finish("completed");
  now = 1000; first.finish("completed");
  const calls = vi.mocked(trackFunnelEvent).mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls[2][1]).toMatchObject({ attempt_id: calls[1][1]?.attempt_id, active_ms: 200, elapsed_ms: 400 });
  expect(calls[3][1]).toMatchObject({ attempt_id: calls[0][1]?.attempt_id, active_ms: 0, elapsed_ms: 1000 });
  expect(calls[0][1]?.attempt_id).not.toBe(calls[1][1]?.attempt_id);
  unmount();
});
