import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeFiscalDraft,
  downloadFiscalDraftAccountantReport,
  previewFiscalDraft,
  saveFiscalDraftSettings,
} from "./api";

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

  it("downloads the accountant CSV using the server filename", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("estado_fiscal,aviso,periodo\nNO_EMITIDO,NO_ES_CFDI,2026-07", {
        status: 200,
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''reporte-control-interno-julio.csv",
          "Content-Type": "text/csv; charset=utf-8",
        },
      }),
    );
    const createObjectUrl = vi.fn(() => "blob:kova-accountant-report");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    let downloadedFilename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download;
    });

    const filename = await downloadFiscalDraftAccountantReport("batch/seguro");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/fiscal/global-drafts/batches/batch%2Fseguro/accountant-report.csv",
    );
    expect(filename).toBe("reporte-control-interno-julio.csv");
    expect(downloadedFilename).toBe(filename);
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:kova-accountant-report");
  });

  it("falls back to a safe basename for a hostile Content-Disposition filename", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["estado_fiscal\nNO_EMITIDO\n"]),
      headers: {
        get: () => 'attachment; filename="../..\\reporte.exe\r\n"',
      },
    } as unknown as Response);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:kova-hostile-filename"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    let downloadedFilename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download;
    });

    const filename = await downloadFiscalDraftAccountantReport("batch-1");

    expect(filename).toBe("reporte-control-interno-kova.csv");
    expect(downloadedFilename).toBe("reporte-control-interno-kova.csv");
    expect(downloadedFilename).not.toMatch(/[\\/\r\n]/);
  });
});
