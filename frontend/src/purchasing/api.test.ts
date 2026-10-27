import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listPurchases } from "./api";
vi.mock("@/reports/api", () => ({ invalidateReportsCache: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => vi.unstubAllGlobals());
it("retains a useful purchasing conflict without returning raw server diagnostics", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "Esta compra ya está recibida o cancelada" }), { status: 409 }));
  await expect(listPurchases()).rejects.toMatchObject({ message: "Esta compra ya está recibida o cancelada", status: 409 });
});
it.each(["<html>Internal server error</html>", "SELECT tenant_id FROM purchase_order WHERE id=123", '{"debug":"traceback"}'])("keeps server diagnostics out of purchasing errors", async detail => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 500 }));
  await expect(listPurchases()).rejects.toMatchObject({ message: "No pudimos completar el cambio en Compras. Revisa los datos e intenta de nuevo.", status: 500 });
});
