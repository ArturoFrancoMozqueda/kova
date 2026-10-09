import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelCfdi,
  connectCfdi,
  downloadCfdi,
  issueCfdi,
  getManagedCfdiSetup,
  startManagedCfdiSetup,
  refreshManagedCfdiSetup,
  uploadCfdiCertificate,
  ManagedCfdiError,
  type InvoicePreparation,
} from "./cfdiApi";
const preparation: InvoicePreparation = {
  request_id: "request-1",
  environment: "test",
  payment_form: "01",
  lines: [
    {
      order_item_id: "line-1",
      product_key: "50181900",
      unit_key: "H87",
      tax_kind: "iva16",
      tax_included: true,
    },
  ],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = "csrf_token=; max-age=0; path=/";
});
describe("CFDI authenticated API", () => {
  it.each([
    "No se pudo abrir el .key. Revisa el archivo y su contraseña.",
    "El certificado CSD está vencido. Carga uno vigente.",
    "El RFC del certificado debe coincidir con el RFC del negocio.",
  ])("exposes only the exact public CSD validation message: %s", async (message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: message }), { status: 400 })));
    const pending = uploadCfdiCertificate(new File(["synthetic"], "csd.cer"), new File(["synthetic"], "csd.key"), "synthetic-password");
    await expect(pending).rejects.toBeInstanceOf(ManagedCfdiError);
    await expect(pending).rejects.toThrow(message);
  });
  it.each([
    [400, "synthetic-password private upstream payload"],
    [503, "synthetic-password private upstream payload"],
    [503, "El certificado CSD está vencido. Carga uno vigente."],
    [400, "Revisa la contraseña del CSD. synthetic-password"],
  ])("redacts unknown or non-validation managed errors (%s)", async (status, detail) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: status as number })));
    const pending = uploadCfdiCertificate(new File(["synthetic"], "csd.cer"), new File(["synthetic"], "csd.key"), "synthetic-password");
    await expect(pending).rejects.not.toBeInstanceOf(ManagedCfdiError);
    await expect(pending).rejects.toThrow("No pudimos completar la operación fiscal. Revisa el estado antes de reintentar.");
  });
  it("sends fiscal identity for managed activation and consults readiness without provider keys", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    const issuer = { rfc: "EKU9003173C9", legal_name: "Negocio", postal_code: "06000", tax_regime: "601" };
    await getManagedCfdiSetup();
    await startManagedCfdiSetup(issuer);
    await refreshManagedCfdiSetup();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/integrations/cfdi/setup");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ issuer });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/integrations/cfdi/setup/refresh");
    expect(fetchMock.mock.calls[2][1].body).toBeUndefined();
  });
  it("uploads CSD multipart with cookie auth and CSRF without setting a broken JSON boundary", async () => {
    document.cookie = "csrf_token=csrf-example; path=/";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const cer = new File(["synthetic certificate"], "csd.cer");
    const key = new File(["synthetic key"], "csd.key");
    await uploadCfdiCertificate(cer, key, "synthetic-password");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/integrations/cfdi/setup/certificate");
    expect(options.credentials).toBe("same-origin");
    expect(options.cache).toBe("no-store");
    expect(options.headers).toEqual({ "X-CSRF-Token": "csrf-example" });
    expect(options.body).toBeInstanceOf(FormData);
    const body = options.body as FormData;
    expect(body.get("cer")).toBe(cer);
    expect(body.get("key")).toBe(key);
    expect(body.get("password")).toBe("synthetic-password");
    expect(localStorage.length).toBe(0);
  });
  it("uses cookie credentials, CSRF, explicit environment and JSON payload without persisting secrets", async () => {
    document.cookie = "csrf_token=csrf-example; path=/";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ connected: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await connectCfdi("live", "sk_live_example-key");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/integrations/cfdi/connection");
    expect(options.credentials).toBe("same-origin");
    expect(options.cache).toBe("no-store");
    expect(options.method).toBe("PUT");
    expect(options.headers).toMatchObject({ "X-CSRF-Token": "csrf-example" });
    expect(JSON.parse(options.body as string)).toEqual({
      environment: "live",
      api_key: "sk_live_example-key",
    });
    expect(localStorage.getItem("api_key")).toBeNull();
  });
  it("retains supplied idempotency key for fiscal mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await issueCfdi(preparation, "same-operation-key");
    await cancelCfdi("document-1", { motive: "03" }, "cancel-key");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "Idempotency-Key": "same-operation-key",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(preparation);
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      "Idempotency-Key": "cancel-key",
    });
  });
  it.each(["xml", "pdf"] as const)(
    "fetches authenticated %s and preserves Test label in the saved filename",
    async (format) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("<xml />", {
          headers: { "Content-Type": "application/xml" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const create = vi.fn().mockReturnValue("blob:private-document");
      const revoke = vi.fn();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: create,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: revoke,
      });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          expect(this.href).toBe("blob:private-document");
          expect(this.download).toBe(
            `test-sin-validez-fiscal-cfdi-document-1.${format}`,
          );
        });
      await downloadCfdi("document-1", format, "test");
      expect(fetchMock.mock.calls[0][0]).toBe(
        `/api/v1/integrations/cfdi/documents/document-1/${format}`,
      );
      expect(fetchMock.mock.calls[0][1].credentials).toBe("same-origin");
      expect(click).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(expect.any(Blob));
    },
  );
  it("does not start a file download on authorization failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "No tienes permiso" }), {
          status: 403,
        }),
      ),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    await expect(downloadCfdi("document-1", "pdf", "live")).rejects.toThrow(
      "No tienes permiso",
    );
    expect(click).not.toHaveBeenCalled();
  });
});
