import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveActiveCustomer } from "./api";

const id = "11111111-1111-4111-8111-111111111111";
const customer = { id, name: "Ana", email: null, phone: null, is_active: true, created_at: "2026-10-22T00:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
describe("resolveActiveCustomer", () => {
  it("consulta el identificador exacto sin depender de la primera página de clientes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(customer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveActiveCustomer(id)).resolves.toEqual(customer);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/customers/${id}`, undefined);
  });
  it("rechaza identificadores inválidos sin realizar una petición", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveActiveCustomer("../../orders")).rejects.toThrow("cliente válido");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rechaza clientes inactivos o una respuesta de otro identificador", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...customer, is_active: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...customer, id: "22222222-2222-4222-8222-222222222222" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveActiveCustomer(id)).rejects.toThrow("no está disponible");
    await expect(resolveActiveCustomer(id)).rejects.toThrow("no está disponible");
  });
  it("respeta la negativa del servidor para clientes ajenos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Cliente no encontrado" }), { status: 404 })));
    await expect(resolveActiveCustomer(id)).rejects.toThrow("Cliente no encontrado");
  });
});
