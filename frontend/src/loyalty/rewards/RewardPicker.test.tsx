import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RewardPicker } from "./RewardPicker";
import type { RewardOffer } from "./api";

const identity = { tenantId: "tenant-1", userId: "cashier-1", branchId: "branch-1" };
const offer: RewardOffer = { customer_id: "customer-1", balance: 30, adjustments_pending: false, reward: { id: "reward-1", version: 2, enabled: true, title: "Gracias por volver", points_cost: 20, discount_amount: "20.00" } };
const onSelect = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const props = { identity, customerId: "customer-1", subtotal: 10000, online: true, manualDiscount: false, selected: false, onSelect };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(json(offer)); });
afterEach(() => vi.unstubAllGlobals());

it("requires the client's confirmation and returns the real offer for this exact customer and branch", async () => {
  render(<RewardPicker {...props} />);
  const button = await screen.findByRole("button", { name: "Aplicar a esta venta" });
  expect(button).toBeDisabled();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("El cliente confirma usar sus puntos"));
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledWith(offer);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/loyalty/rewards/offer?customer_id=customer-1", expect.objectContaining({ credentials: "include", cache: "no-store", headers: expect.objectContaining({ "X-Kova-Expected-User": "cashier-1", "X-Kova-Branch": "branch-1" }) }));
});

it.each([
  ["insufficient points", { balance: 5 }, {}, "Faltan 15 puntos."],
  ["pending reversals", { adjustments_pending: true }, {}, "Hay movimientos pendientes."],
  ["purchase below the benefit", {}, { subtotal: 1000 }, "El importe de la compra debe cubrir el descuento."],
  ["manual discount", {}, { manualDiscount: true }, "Quita el descuento manual para usar la recompensa."],
])("blocks selection for %s without spending points", async (_name, offerPatch, propPatch, message) => {
  fetchMock.mockResolvedValue(json({ ...offer, ...offerPatch }));
  render(<RewardPicker {...props} {...propPatch} />);
  expect(await screen.findByText(String(message), { exact: false })).toBeVisible();
  expect(screen.getByLabelText("El cliente confirma usar sus puntos")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Aplicar a esta venta" })).toBeDisabled();
  expect(onSelect).not.toHaveBeenCalled();
});

it("omits nonexistent or paused benefits instead of inventing a promotion", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...offer, reward: null }));
  const view = render(<RewardPicker {...props} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(screen.queryByRole("region", { name: "Recompensa de esta venta" })).not.toBeInTheDocument();
  view.unmount(); fetchMock.mockResolvedValueOnce(json({ ...offer, reward: { ...offer.reward, enabled: false } }));
  render(<RewardPicker {...props} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("region", { name: "Recompensa de esta venta" })).not.toBeInTheDocument();
});

it("discards late results from another customer and never preconfirms a new customer", async () => {
  let resolve: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async url => String(url).includes("customer-1") ? new Promise(done => { resolve = done; }) : json({ ...offer, customer_id: "customer-2", balance: 25 }));
  const view = render(<RewardPicker {...props} />);
  await waitFor(() => expect(resolve).toBeDefined());
  view.rerender(<RewardPicker {...props} customerId="customer-2" />);
  expect(await screen.findByText(/Saldo: 25 puntos/)).toBeVisible();
  await act(async () => resolve!(json(offer)));
  expect(screen.queryByText(/Saldo: 30 puntos/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("El cliente confirma usar sus puntos")).not.toBeChecked();
  expect(onSelect).not.toHaveBeenCalled();
});

it("recovers a failed offer read without applying it automatically", async () => {
  fetchMock.mockResolvedValueOnce(json({}, 503));
  render(<RewardPicker {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Consultar recompensas" }));
  expect(await screen.findByRole("button", { name: "Aplicar a esta venta" })).toBeDisabled();
  expect(onSelect).not.toHaveBeenCalled();
});

it("lets a cashier remove a selected benefit without changing points", async () => {
  render(<RewardPicker {...props} selected />);
  fireEvent.click(await screen.findByRole("button", { name: "Quitar recompensa" }));
  expect(onSelect).toHaveBeenCalledWith(null);
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});

it("never fetches or applies a benefit while offline", () => {
  render(<RewardPicker {...props} online={false} />);
  expect(screen.getByText(/Las recompensas se aplican con conexión/)).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
});

it("can remove a previously selected reward offline so a normal sale can continue without spending points", () => {
  render(<RewardPicker {...props} online={false} selected />);
  fireEvent.click(screen.getByRole("button", { name: "Quitar recompensa" }));
  expect(onSelect).toHaveBeenCalledWith(null);
  expect(fetchMock).not.toHaveBeenCalled();
});
