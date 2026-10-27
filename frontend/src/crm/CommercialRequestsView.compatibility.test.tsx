import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import CommercialRequestsView from "./CommercialRequestsView";
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: { status: "authenticated", tenantId: "tenant-1", sessionMode: "online", user: { id: "owner-1", role: "owner" } } }) }));
vi.mock("@/branches/activeBranch", () => ({ getActiveBranchId: () => "branch-1" }));
it("keeps accepted requests readable without offering old conversion or dismissal actions", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async url => new Response(JSON.stringify(String(url).includes("/customers") ? [] : { requests: [{ id: "request-1", name: "Ana", contact: "Contacto registrado", message: "Pedido revisado", product_ids: [], status: "accepted", customer_id: "customer-1", opportunity_id: null, version: 2, created_at: "2026-10-26T12:00:00Z" }], has_more: false }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter><CommercialRequestsView /></MemoryRouter>);
  expect(await screen.findByText("Pedido creado")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Convertir|Descartar|Vincular/ })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  vi.unstubAllGlobals();
});
