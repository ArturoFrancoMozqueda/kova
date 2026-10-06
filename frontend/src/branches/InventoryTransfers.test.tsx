import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InventoryTransfers } from "./InventoryTransfers";
import { listBranches } from "./api";
vi.mock("./api", () => ({ listBranches: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it("keeps a retry's idempotency key after a lost connection", async () => {
  vi.mocked(listBranches).mockResolvedValue(
    ["source", "destination"].map((id) => ({
      id,
      name: id,
      address: null,
      created_at: "2026-10-05",
    })),
  );
  const submissions: RequestInit[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("inventory/stock"))
      return new Response(
        JSON.stringify([
          { product_id: "pan", product_name: "Pan", available_quantity: 10 },
        ]),
      );
    if (init?.method === "POST") {
      submissions.push(init);
      if (submissions.length === 1) throw new Error("Conexión interrumpida");
      return new Response(JSON.stringify({ id: "transfer" }));
    }
    return new Response("[]");
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<InventoryTransfers />);
  await screen.findByLabelText("Sucursal de origen");
  fireEvent.change(screen.getByLabelText("Sucursal de origen"), {
    target: { value: "source" },
  });
  fireEvent.change(screen.getByLabelText("Sucursal de destino"), {
    target: { value: "destination" },
  });
  await screen.findByText("Pan · 10 disponibles");
  fireEvent.change(screen.getByLabelText("Producto"), {
    target: { value: "pan" },
  });
  fireEvent.change(screen.getByLabelText("Motivo"), {
    target: { value: "Reposición" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Registrar traspaso" }));
  await screen.findByText("Conexión interrumpida");
  fireEvent.click(screen.getByRole("button", { name: "Registrar traspaso" }));
  await waitFor(() => expect(submissions).toHaveLength(2));
  expect(
    (submissions[0].headers as Record<string, string>)["Idempotency-Key"],
  ).toBe((submissions[1].headers as Record<string, string>)["Idempotency-Key"]);
  await screen.findByText(/Traspaso registrado/);
});
