import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeFiscalDraft, previewFiscalDraft, saveFiscalDraftSettings } from "./api";

describe("fiscal draft api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.cookie = "csrf_token=fiscal-csrf";
  });

  it("encodes the preview date as a query value", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await previewFiscalDraft("2024-02-29");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/fiscal/global-drafts/preview?period_end=2024-02-29",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
    );
  });

  it("sends CSRF and the stable idempotency identity on close", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await closeFiscalDraft("2026-07-31", "close-key-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/fiscal/global-drafts/close",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": "close-key-1",
          "X-CSRF-Token": "fiscal-csrf",
        }),
        body: JSON.stringify({ period_end: "2026-07-31" }),
      }),
    );
  });

  it("sends only editable settings fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await saveFiscalDraftSettings({
      frequency: "weekly",
      weekly_close_day: 7,
      monthly_close_day: 31,
      auto_close_enabled: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/fiscal/global-drafts/settings",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
