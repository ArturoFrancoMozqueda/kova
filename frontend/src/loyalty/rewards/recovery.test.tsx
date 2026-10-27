import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { rememberReward, readPendingReward, forgetReward } from "./pending";
import { useRewardCheckout } from "./useRewardCheckout";
const identity = () => ({ tenantId: crypto.randomUUID(), userId: "cashier", branchId: "branch" });
const body = { order: { customer_id: "customer", discount_amount: "0.00", items: [{ product_id: "product", quantity: 1 }], payments: [{ method: "manual_card" as const, amount: "80.00" }] }, reward_id: "reward", reward_version: 1, expected_balance: 20, confirmed: true as const };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());
it("claims one durable command across simultaneous tabs, scoped to its cashier and branch", async () => {
  const owner = identity();
  const results = await Promise.allSettled([rememberReward(owner, body), rememberReward(owner, body)]);
  expect(results.filter(value => value.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(value => value.status === "rejected")).toHaveLength(1);
  expect(await readPendingReward({ ...owner, branchId: "other-branch" })).toBeUndefined();
  expect(await readPendingReward({ ...owner, userId: "other-cashier" })).toBeUndefined();
  const record = (await readPendingReward(owner))!;
  await forgetReward({ ...record, key: "older-key" });
  expect(await readPendingReward(owner)).toEqual(record);
  await forgetReward(record);
});
it("recovers an uncertain outcome after remount using the exact same body and idempotency key", async () => {
  const owner = identity(); const completed = vi.fn(); const rejected = vi.fn();
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Conexión interrumpida")).mockResolvedValueOnce(json({ id: "sale-confirmed", tenant_id: owner.tenantId, customer_id: body.order.customer_id, status: "completed", items: [], payments: [] }));
  vi.stubGlobal("fetch", fetchMock);
  const first = renderHook(() => useRewardCheckout(owner, completed, rejected));
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  await act(() => first.result.current.submit(body));
  expect(completed).not.toHaveBeenCalled(); expect(first.result.current.pending).not.toBeNull();
  first.unmount();
  const second = renderHook(() => useRewardCheckout(owner, completed, rejected));
  await waitFor(() => expect(second.result.current.pending).not.toBeNull());
  await act(() => second.result.current.retry());
  expect(completed).toHaveBeenCalledOnce(); expect(rejected).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
  expect(await readPendingReward(owner)).toBeUndefined();
});
it("releases a definitively rejected checkout without treating it as a sale", async () => {
  const owner = identity(); const completed = vi.fn(); const rejected = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "El saldo cambió" }, 409)));
  const view = renderHook(() => useRewardCheckout(owner, completed, rejected));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(() => view.result.current.submit(body));
  expect(completed).not.toHaveBeenCalled(); expect(rejected).toHaveBeenCalledOnce();
  expect(view.result.current.error).toBe("El saldo cambió"); expect(await readPendingReward(owner)).toBeUndefined();
});
it("retains the original command if permission or billing prevents its recovery", async () => {
  const owner = identity(); const completed = vi.fn(); const rejected = vi.fn();
  const record = await rememberReward(owner, body);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "Acceso bloqueado" }, 403)));
  const view = renderHook(() => useRewardCheckout(owner, completed, rejected));
  await waitFor(() => expect(view.result.current.pending).not.toBeNull());
  await act(() => view.result.current.retry());
  expect(await readPendingReward(owner)).toEqual(record);
  expect(completed).not.toHaveBeenCalled(); expect(rejected).not.toHaveBeenCalled();
  await forgetReward(record);
});

it("never clears a durable command after a malformed or mismatched success response", async () => {
  const owner = identity(); const completed = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ id: "another-sale", tenant_id: "another-tenant", status: "completed", items: [], payments: [] })));
  const view = renderHook(() => useRewardCheckout(owner, completed, vi.fn()));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(() => view.result.current.submit(body));
  expect(completed).not.toHaveBeenCalled();
  const record = (await readPendingReward(owner))!;
  expect(record.body).toEqual(body); expect(view.result.current.pending).toEqual(record);
  expect(view.result.current.error).toContain("no confirma esta venta");
  await forgetReward(record);
});

it.each(["malformed JSON", "technical network error"])("keeps a %s out of checkout feedback while retaining the durable recovery command", async failure => {
  const owner = identity(); const completed = vi.fn(); const rejected = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
    if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
    throw new Error("Failed to fetch: backend postgres connection failed");
  }));
  const view = renderHook(() => useRewardCheckout(owner, completed, rejected));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(() => view.result.current.submit(body));
  expect(view.result.current.error).toContain("Consulta el resultado sin volver a cobrar.");
  expect(view.result.current.error).not.toMatch(/Unexpected token|Failed to fetch|postgres|proxy error/);
  const record = (await readPendingReward(owner))!;
  expect(record.body).toEqual(body); expect(view.result.current.pending).toEqual(record);
  expect(completed).not.toHaveBeenCalled(); expect(rejected).not.toHaveBeenCalled();
  await forgetReward(record);
});
