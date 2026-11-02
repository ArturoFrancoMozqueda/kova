import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePublicPlans } from "./publicPlans";
const standard = { tiered_pricing_enabled: false, available_plans: [{ code: "standard", name: "Plan Standard", amount_minor_units: 29900, currency: "MXN", interval: "month", features: [], limits: { product_image_bytes: null }, tax_inclusive: null }] };
afterEach(() => vi.unstubAllGlobals());
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
