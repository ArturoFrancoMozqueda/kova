import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import OrderTrackingView, { type OrderTracking, type TrackingStatus } from "./OrderTrackingView";

const fetchMock = vi.fn<typeof fetch>();
const tracking: OrderTracking = { business_name: "Café del Patio", branch_name: "Centro", status: "pending_review", folio: null, total_amount: null, items: [{ product_name: "Pan de nuez", quantity: 2 }], catalog_path: "/catalogo/cafe-del-patio", updated_at: "2026-10-26T12:00:00Z", expires_at: "2026-11-26T12:00:00Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function Navigation() { const navigate = useNavigate(); return <><button onClick={() => void navigate("/seguimiento#other-order")}>Otra solicitud</button><Routes><Route path="/seguimiento" element={<OrderTrackingView />} /></Routes></>; }
const mount = (path = "/seguimiento#first-order") => render(<MemoryRouter initialEntries={[path]}><Navigation /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockImplementation(async () => json(tracking)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reads the exact request capability from a POST body without cookies, referrers, payment claims or guessed prices", async () => {
  const { container } = mount();
  expect(await screen.findByText("Solicitud recibida")).toHaveAttribute("role", "status");
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/public/order-tracking", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "first-order" }), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }));
  expect(screen.getByText("Pan de nuez")).toBeVisible();
  expect(screen.getByText("2 ×")).toBeVisible();
  expect(screen.getByText(/El equipo revisará la disponibilidad/)).toBeVisible();
  expect(screen.queryByText("Total registrado")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Volver al menú" })).toHaveAttribute("href", tracking.catalog_path);
  expect((await axe(container, { runOnly: ["region", "link-name", "button-name", "heading-order"] })).violations).toEqual([]);
});

it.each([
  ["accepted", "Pedido registrado"], ["confirmed", "Pedido confirmado"], ["in_progress", "En preparación"],
  ["ready", "Tu pedido está listo"], ["fulfilled", "Pedido entregado"], ["cancelled", "Pedido cancelado"], ["dismissed", "Solicitud no aceptada"],
] as [TrackingStatus, string][])("presents the real %s state without inferring a payment", async (status, title) => {
  fetchMock.mockResolvedValueOnce(json({ ...tracking, status, folio: status === "dismissed" ? null : "PED-001", total_amount: status === "dismissed" ? null : "90.00" }));
  mount();
  expect(await screen.findByText(title)).toHaveAttribute("role", "status");
  if (status !== "dismissed") expect(screen.getByText(/Acuerda el pago directamente con el negocio/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /pagar|cancelar|confirmar pedido/i })).not.toBeInTheDocument();
  if (status === "accepted") expect(screen.getByText(/Aquí verás cuando confirme tu pedido/)).toBeVisible();
  if (status === "cancelled" || status === "dismissed") expect(screen.queryByRole("list", { name: "Progreso del pedido" })).not.toBeInTheDocument();
});

it("does not make a request or offer identity lookup without a capability", () => {
  mount("/seguimiento");
  expect(screen.getByRole("heading", { name: "Abre el enlace de tu solicitud" })).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refreshes a genuine state transition and discards the previous state on a failed recheck", async () => {
  fetchMock.mockResolvedValueOnce(json(tracking)).mockResolvedValueOnce(json({ ...tracking, status: "ready", total_amount: "90.00", folio: "PED-001" })).mockResolvedValueOnce(json({}, 503));
  mount(); await screen.findByText("Solicitud recibida");
  fireEvent.click(screen.getByRole("button", { name: "Actualizar estado" }));
  expect(await screen.findByText("Tu pedido está listo")).toHaveAttribute("role", "status");
  fireEvent.click(screen.getByRole("button", { name: "Actualizar estado" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar el estado");
  expect(screen.queryByText("Tu pedido está listo")).not.toBeInTheDocument();
});

it.each([404, 410])("shows HTTP %i access expiry without former order data and permits an explicit retry", async status => {
  fetchMock.mockResolvedValueOnce(json({}, status));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Este enlace ya no está disponible");
  expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
  expect(await screen.findByText("Pan de nuez")).toBeVisible();
});

it.each(["malformed JSON", "technical network error"])("keeps a %s out of tracking feedback and allows an explicit recheck", async failure => {
  fetchMock.mockImplementationOnce(async () => {
    if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
    throw new Error("Failed to fetch: backend postgres connection failed");
  });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar el estado. Revisa tu conexión e intenta de nuevo.");
  expect(screen.queryByText(/Unexpected token|Failed to fetch|postgres|proxy error/)).not.toBeInTheDocument();
  expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
  expect(await screen.findByText("Pan de nuez")).toBeVisible();
});

it("aborts an old capability and never lets its late response replace a different request", async () => {
  let resolve: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async (_url, init) => JSON.parse(String(init?.body)).token === "first-order"
    ? new Promise(done => { resolve = done; }) : json({ ...tracking, business_name: "Otro negocio", items: [] }));
  mount(); await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Otra solicitud" }));
  expect(await screen.findByRole("heading", { name: "Otro negocio" })).toBeVisible();
  await act(async () => resolve!(json(tracking)));
  expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("does not present an unknown backend state or external address as a valid operation", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...tracking, status: "paid", catalog_path: "https://example.invalid" }));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("El estado todavía no está disponible");
  expect(screen.queryByRole("link", { name: "Volver al menú" })).not.toBeInTheDocument();
});

it("refreshes an active order automatically and stops when it is delivered", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(json(tracking))
    .mockResolvedValueOnce(json({ ...tracking, status: "ready" }))
    .mockResolvedValueOnce(json({ ...tracking, status: "fulfilled" }));
  mount();
  await act(async () => {});
  expect(screen.getByText("Solicitud recibida")).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByText("Tu pedido está listo")).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByText("Pedido entregado")).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("pauses background updates when hidden and rechecks upon returning without overlapping requests", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  mount(); await act(async () => {});
  hidden.mockReturnValue(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  fireEvent(document, new Event("visibilitychange"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => { finish(json({ ...tracking, status: "ready" })); });
  expect(screen.getByText("Tu pedido está listo")).toBeVisible();
});

it("removes expired order data on an automatic recheck and stops polling", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(json(tracking)).mockResolvedValueOnce(json({}, 410));
  mount(); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("Este enlace ya no está disponible");
  expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("copies the private tracking link only on request and offers a fallback when the clipboard fails", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { onLine: true, clipboard: { writeText } });
  mount(); await screen.findByText("Solicitud recibida");
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Copiar enlace de seguimiento" }));
  expect(await screen.findByText(/Enlace copiado/)).toBeVisible();
  expect(writeText).toHaveBeenCalledWith(window.location.href);
  writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Copiar enlace de seguimiento" }));
  expect(await screen.findByText(/Copia la dirección de esta página/)).toBeVisible();
});
