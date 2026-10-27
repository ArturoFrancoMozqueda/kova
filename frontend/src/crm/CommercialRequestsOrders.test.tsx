import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CommercialRequestsView from "./CommercialRequestsView";

const session = vi.hoisted(() => ({ role: "owner", ordersEnabled: true, mode: "online" }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: { status: "authenticated", user: { id: "owner-1", role: session.role }, tenantId: "tenant-1", sessionMode: session.mode, featureFlags: { customer_orders: session.ordersEnabled } } }) }));
vi.mock("@/branches/activeBranch", () => ({ getActiveBranchId: () => "branch-1" }));
const row = { id: "request-1", name: "Visitante", contact: "contact@example.invalid", message: "Solicitud de pedido", product_ids: ["product-1"], order_lines: [{ product_id: "product-1", product_name: "Café", quantity: 2, unit_price_amount: "45.00", line_total_amount: "90.00" }], origin: "remote", customer_id: null, opportunity_id: null, customer_order_id: null, status: "new", version: 1, created_at: "2026-10-26T12:00:00Z" };
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const mount = () => render(<MemoryRouter><CommercialRequestsView /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks(); session.role = "owner"; session.ordersEnabled = true; session.mode = "online";
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async url => String(url).includes("/customers?") ? json([]) : json({ requests: [row], has_more: false }));
});
afterEach(() => vi.unstubAllGlobals());

it("offers direct order review only for structured requests with the order feature available", async () => {
  mount();
  expect(await screen.findByRole("button", { name: "Revisar pedido de Visitante" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Revisar solicitud de Visitante" })).toBeEnabled();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});

it("keeps legacy CRM review while the order feature is disabled", async () => {
  session.ordersEnabled = false;
  mount();
  expect(await screen.findByRole("button", { name: "Revisar solicitud de Visitante" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Revisar pedido de Visitante" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revisar solicitud de Visitante" }));
  expect(screen.getByRole("button", { name: "Crear oportunidad con este cliente" })).toBeDisabled();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("order-preview"))).toBe(false);
});

it("opens the exact accepted order after reload without recreating it or using an opportunity", async () => {
  fetchMock.mockImplementation(async url => String(url).includes("/customers?") ? json([]) : json({ requests: [{ ...row, status: "accepted", customer_order_id: "exact-order" }], has_more: false }));
  mount();
  expect(await screen.findByRole("link", { name: "Ver pedido" })).toHaveAttribute("href", "/pedidos/exact-order");
  expect(screen.queryByRole("link", { name: "Ver oportunidad" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Revisar pedido/ })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});
