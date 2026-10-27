import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listLots, saveLot } from "./lots";
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => vi.unstubAllGlobals());
it("preserves actionable duplicate-lot feedback and its conflict status", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "Ya existe ese lote para el producto; selecciónalo para recibir más unidades" }), { status: 409 }));
  await expect(saveLot("product", { code: "Harina-29", manufactured_on: null, rotation_on: null, expires_on: null }, "same-key")).rejects.toMatchObject({ message: "Ya existe ese lote para el producto; selecciónalo para recibir más unidades", status: 409 });
});
it("does not expose technical details even from an unexpected validation response", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: { message: "SELECT credential_hash FROM loyalty_members" } }), { status: 422 }));
  await expect(listLots("product")).rejects.toMatchObject({ message: "No pudimos completar el cambio en los lotes. Revisa los datos e intenta de nuevo.", status: 422 });
});
