import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DigitalCardShare } from "./DigitalCardShare";

const identity = { tenantId: "tenant-a", userId: "owner-a", branchId: "branch-a" };
const fetchMock = vi.fn<typeof fetch>();
const result = { share_path: "/lealtad#customer-card", expires_at: "2026-11-26T12:00:00Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const mount = (online = true) => render(<DigitalCardShare identity={identity} customerId="customer-a" online={online} disabled={false} />);
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(json(result));
});
afterEach(() => vi.unstubAllGlobals());

it("generates only on owner action for the selected customer and branch, then offers the exact fragment link", async () => {
  mount();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Crear enlace de tarjeta digital" }));
  expect(await screen.findByLabelText("Enlace de la tarjeta")).toHaveValue(`${window.location.origin}/lealtad#customer-card`);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/loyalty/customers/customer-a/digital-card", expect.objectContaining({ method: "POST", credentials: "include", cache: "no-store", body: undefined, headers: expect.objectContaining({ "X-Kova-Expected-Tenant": "tenant-a", "X-Kova-Expected-User": "owner-a", "X-Kova-Branch": "branch-a" }) }));
  expect(screen.getByRole("link", { name: "Ver tarjeta" })).toHaveAttribute("rel", "noreferrer");
  expect(screen.getByText(/Entrégalo sólo al cliente/)).toBeVisible();
});

it("selects the share link for manual copying when clipboard access fails", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Crear enlace de tarjeta digital" }));
  fireEvent.click(await screen.findByRole("button", { name: "Copiar tarjeta" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Enlace seleccionado");
  expect(screen.getByLabelText("Enlace de la tarjeta")).toHaveFocus();
});

it("blocks double clicks and discards the first customer's pending link after selection changes", async () => {
  let finish: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = mount();
  const button = screen.getByRole("button", { name: "Crear enlace de tarjeta digital" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  view.rerender(<DigitalCardShare key="customer-b" identity={identity} customerId="customer-b" online disabled={false} />);
  await act(async () => finish!(json(result)));
  expect(screen.queryByLabelText("Enlace de la tarjeta")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("keeps offline generation unavailable and does not write any requests", () => {
  mount(false);
  expect(screen.getByRole("button", { name: "Crear enlace de tarjeta digital" })).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps a rejected issuance recoverable and never displays a fabricated link", async () => {
  fetchMock.mockResolvedValueOnce(json({ detail: "Cliente desactivado" }, 404));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Crear enlace de tarjeta digital" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Cliente desactivado");
  expect(screen.queryByLabelText("Enlace de la tarjeta")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Crear enlace de tarjeta digital" }));
  expect(await screen.findByLabelText("Enlace de la tarjeta")).toBeVisible();
});

it("does not turn a malformed external share path into a customer link", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...result, share_path: "https://example.invalid/lealtad#token" }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Crear enlace de tarjeta digital" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos preparar el enlace");
  expect(screen.queryByRole("link", { name: "Ver tarjeta" })).not.toBeInTheDocument();
});

it.each(["malformed JSON", "technical network error"])("keeps a %s out of the card issuance feedback", async failure => {
  fetchMock.mockImplementationOnce(async () => {
    if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
    throw new Error("Failed to fetch: backend postgres connection failed");
  });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Crear enlace de tarjeta digital" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos preparar la tarjeta digital");
  expect(screen.queryByText(/Unexpected token|Failed to fetch|postgres|proxy error/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Ver tarjeta" })).not.toBeInTheDocument();
});
