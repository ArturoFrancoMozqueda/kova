import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrepCard, PrepQueue } from "./api";

const api = vi.hoisted(() => ({
  queue: vi.fn(), ticket: vi.fn(), order: vi.fn(), role: "cashier", online: true,
}));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: { status: "authenticated", tenantId: "t", user: { id: "u", role: api.role } } }) }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/offline/useSyncQueue", () => ({ useIsOnline: () => api.online }));
vi.mock("./api", () => ({
  getPrepQueue: () => api.queue(),
  changePrepTicketStatus: (...args: unknown[]) => api.ticket(...args),
  listPrepStations: () => Promise.resolve([]),
  createPrepStation: vi.fn(),
  updatePrepStation: vi.fn(),
}));
vi.mock("@/customerOrders/api", () => ({ changeCustomerOrderStatus: (...args: unknown[]) => api.order(...args) }));
import PrepQueueView from "./PrepQueueView";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const card = (overrides: Partial<PrepCard>): PrepCard => ({
  kind: "sale", id: "t1", station_id: "bar", status: "received", version: 1, number: 12, folio: null,
  customer_name: null, sale_order_id: "s1", payment_status: null, promised_at: null,
  received_at: minutesAgo(2), preparing_at: null, ready_at: null, delivered_at: null,
  items: [{ product_name: "Latte", quantity: 2, modifiers: ["Leche de almendra"], note: null }],
  ...overrides,
});
const queue = (cards: PrepCard[]): PrepQueue => ({
  stations: [
    { id: "bar", name: "Barra", alert_minutes: 8, position: 0, is_active: true },
    { id: "kitchen", name: "Cocina", alert_minutes: 12, position: 1, is_active: true },
  ],
  cards, generated_at: new Date().toISOString(),
});

const renderView = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><PrepQueueView /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  api.role = "cashier";
  api.online = true;
  api.queue.mockReset();
  api.ticket.mockReset().mockResolvedValue({});
  api.order.mockReset().mockResolvedValue({});
});

it("shows each order in its column with number, modifiers and lateness", async () => {
  api.queue.mockResolvedValue(queue([
    card({}),
    card({ id: "t2", number: 13, station_id: "kitchen", status: "preparing", received_at: minutesAgo(15),
      items: [{ product_name: "Sándwich", quantity: 1, modifiers: [], note: null }] }),
  ]));
  renderView();
  const received = await screen.findByRole("region", { name: "Recibido" });
  expect(within(received).getByText("#12")).toBeVisible();
  expect(within(received).getByText("Leche de almendra")).toBeVisible();
  const preparing = screen.getByRole("region", { name: "En preparación" });
  expect(within(preparing).getByText(/15 min · tarde/)).toBeVisible();
  expect(within(preparing).getByText(/Cocina/)).toBeVisible();
});

it("moves a counter ticket forward and filters by station", async () => {
  api.queue.mockResolvedValue(queue([card({}), card({ id: "t2", number: 13, station_id: "kitchen" })]));
  renderView();
  await screen.findByText("#12");
  fireEvent.click(screen.getByRole("radio", { name: "Cocina" }));
  expect(screen.queryByText("#12")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Barra" }));
  fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
  await waitFor(() => expect(api.ticket).toHaveBeenCalledWith("t1", 1, "preparing"));
  expect(screen.queryByRole("button", { name: /Regresar/ })).not.toBeInTheDocument();
});

it("lets a manager send an order back a step", async () => {
  api.role = "manager";
  api.queue.mockResolvedValue(queue([card({ status: "ready", ready_at: minutesAgo(1) })]));
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Regresar #12 a En preparación" }));
  await waitFor(() => expect(api.ticket).toHaveBeenCalledWith("t1", 1, "preparing"));
});

it("moves pedidos through Pedidos and asks to charge before handing over", async () => {
  api.queue.mockResolvedValue(queue([
    card({ kind: "customer_order", id: "o1", number: null, folio: "PED-AB12", customer_name: "Lucía", payment_status: "unpaid" }),
    card({ kind: "customer_order", id: "o2", number: null, folio: "PED-CD34", status: "ready", payment_status: "unpaid" }),
  ]));
  renderView();
  const received = await screen.findByRole("region", { name: "Recibido" });
  fireEvent.click(within(received).getByRole("button", { name: "Empezar" }));
  await waitFor(() => expect(api.order).toHaveBeenCalledWith("o1", 1, "in_progress"));
  const ready = screen.getByRole("region", { name: "Listo" });
  expect(within(ready).queryByRole("button", { name: "Entregar" })).not.toBeInTheDocument();
  expect(within(ready).getByRole("link", { name: "Cobrar en Caja" })).toHaveAttribute("href", "/register?customerOrderId=o2");
});

it("guides a manager to create stations when there are none", async () => {
  api.role = "owner";
  api.queue.mockResolvedValue({ stations: [], cards: [], generated_at: new Date().toISOString() });
  renderView();
  expect(await screen.findByText("Aún no hay estaciones de preparación")).toBeVisible();
  expect(screen.getByRole("button", { name: "Estaciones" })).toBeVisible();
});

it("does not move orders while offline", async () => {
  api.online = false;
  api.queue.mockResolvedValue(queue([card({})]));
  renderView();
  expect(await screen.findByText(/Sin conexión: la cola no se actualiza/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Empezar" })).toBeDisabled();
});
