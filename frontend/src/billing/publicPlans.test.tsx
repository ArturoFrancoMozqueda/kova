import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePublicPlans } from "./publicPlans";
const standard = { tiered_pricing_enabled: false, available_plans: [{ code: "standard", name: "Plan Standard", amount_minor_units: 29900, currency: "MXN", interval: "month", features: [], limits: { product_image_bytes: null }, tax_inclusive: null }] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("shows no assumed offer while pending and uses only an authoritative public catalog", async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => usePublicPlans());
  expect(result.current.status).toBe("loading");
  await act(async () => resolve(new Response(JSON.stringify(standard))));
  expect(result.current).toMatchObject({ status: "ready", catalog: standard });
  expect(fetch).toHaveBeenCalledWith("/api/v1/billing/plans", expect.objectContaining({ credentials: "omit", cache: "no-store" }));
});
it("reports an unavailable offer and retries without inventing Standard pricing", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify(standard))); vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => usePublicPlans());
  await waitFor(() => expect(result.current.status).toBe("error"));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current).toMatchObject({ status: "ready", catalog: standard }));
});
it("rejects an inconsistent multi-plan response instead of showing a Standard offer", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...standard, tiered_pricing_enabled: true }))));
  const { result } = renderHook(() => usePublicPlans()); await waitFor(() => expect(result.current.status).toBe("error"));
});

it("refreshes once when focus and visibility return, replacing the previously shown offer", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const updated = { ...standard, offer_revision: "new-offer" };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(standard))).mockResolvedValueOnce(new Response(JSON.stringify(updated)));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => usePublicPlans());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  act(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(result.current).toMatchObject({ status: "ready", catalog: updated }));
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("removes an old offer while a fresh confirmation fails and lets the visitor retry", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(standard)))
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...standard, offer_revision: "restored" })));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => usePublicPlans());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(async () => { await expect(result.current.confirm()).rejects.toThrow(); });
  expect(result.current.status).toBe("error");
  expect("catalog" in result.current).toBe(false);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current).toMatchObject({ status: "ready", catalog: { offer_revision: "restored" } }));
});
