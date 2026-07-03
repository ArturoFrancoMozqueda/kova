import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createNote, getTrace, updateTriage } from "./api";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe("internal-ops api", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getTrace builds a querystring with only present params", async () => {
    const fetchMock = mockFetch(200, { timeline: [] });
    vi.stubGlobal("fetch", fetchMock);
    await getTrace({ request_id: "abc", tenant_id: "" });
    const url = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(url).toContain("request_id=abc");
    expect(url).not.toContain("tenant_id=");
  });

  it("createNote sends POST with a CSRF header", async () => {
    document.cookie = "csrf_token=tok123";
    const fetchMock = mockFetch(201, { id: "n1" });
    vi.stubGlobal("fetch", fetchMock);
    await createNote({ entity_type: "general", body: "hola" });
    const [, init] = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const request = init as RequestInit;
    expect(request.method).toBe("POST");
    expect((request.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok123");
  });

  it("updateTriage sends PATCH", async () => {
    document.cookie = "csrf_token=tok123";
    const fetchMock = mockFetch(200, { incident: {} });
    vi.stubGlobal("fetch", fetchMock);
    await updateTriage("stripe_webhook:evt_1", { triage_status: "investigating" });
    const [url, init] = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(url).toContain("/incidents/stripe_webhook%3Aevt_1/triage");
    expect((init as RequestInit).method).toBe("PATCH");
  });

  it("throws ApiError with status on failure", async () => {
    vi.stubGlobal("fetch", mockFetch(403, { detail: "no" }));
    await expect(getTrace({ request_id: "x" })).rejects.toBeInstanceOf(ApiError);
  });
});
