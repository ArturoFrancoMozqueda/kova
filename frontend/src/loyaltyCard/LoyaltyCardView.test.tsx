import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import LoyaltyCardView from "./LoyaltyCardView";

const fetchMock = vi.fn<typeof fetch>();
const card = {
  business_name: "Café del barrio", branch_name: "Centro", balance: 35,
  adjustments_pending: false,
  policy: { enabled: true, spend_amount: "100.00", points_per_step: 5 },
  expires_at: "2026-11-26T12:00:00Z", catalog_path: "/catalogo/cafe-del-barrio",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function Navigation() {
  const navigate = useNavigate();
  return <><button onClick={() => void navigate("/lealtad#second-card")}>Otra tarjeta</button><Routes><Route path="/lealtad" element={<LoyaltyCardView />} /></Routes></>;
}
const mount = (path = "/lealtad#first-card") => render(<MemoryRouter initialEntries={[path]}><Navigation /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => json(card));
});
afterEach(() => vi.unstubAllGlobals());

it("reads only the fragment capability without cookies, referrers or a customer lookup", async () => {
  const { container } = mount();
  expect(await screen.findByRole("heading", { name: card.business_name })).toBeVisible();
  expect(screen.getByLabelText("Tus puntos")).toHaveTextContent("35");
  expect(screen.getByText(/En cada compra elegible/)).not.toBeVisible();
  fireEvent.click(screen.getByText("Cómo funciona tu tarjeta"));
  expect(screen.getByText(/En cada compra elegible, sumas 5 puntos por cada tramo completo de \$100.00 MXN/)).toBeVisible();
  expect(screen.getByText("Los importes sobrantes no se suman entre compras.")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/public/loyalty/cards", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "first-card" }), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Ver menú del negocio" })).toHaveAttribute("href", card.catalog_path);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /canjear|pagar|descuento/i })).not.toBeInTheDocument();
  expect((await axe(container, { runOnly: ["region", "link-name", "button-name", "heading-order"] })).violations).toEqual([]);
});

it("does not invent a card or ask for personal information without a capability", () => {
  mount("/lealtad");
  expect(screen.getByRole("heading", { name: "Tu tarjeta comienza en el negocio" })).toBeVisible();
  expect(screen.queryByLabelText("Tus puntos")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([0, -12])("preserves a real %s balance with a paused, undefined policy", async balance => {
  fetchMock.mockResolvedValueOnce(json({ ...card, balance, catalog_path: null, policy: { enabled: false, spend_amount: null, points_per_step: null } }));
  mount();
  expect(await screen.findByLabelText("Tus puntos")).toHaveTextContent(String(balance));
  expect(screen.getByText("Acumulación pausada por el negocio")).toBeVisible();
  fireEvent.click(screen.getByText("Cómo funciona tu tarjeta"));
  expect(screen.getByText(/Consulta con el equipo cómo sumar puntos/)).toBeVisible();
  expect(screen.queryByRole("link", { name: "Ver menú del negocio" })).not.toBeInTheDocument();
  if (balance < 0) expect(screen.getByText(/devoluciones o anulaciones redujeron tus puntos/)).toBeVisible();
});

it("shows pending reversals without treating the balance as redeemable credit", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...card, adjustments_pending: true }));
  mount();
  expect(await screen.findByText("Saldo en revisión")).toBeVisible();
  expect(screen.getByText(/El saldo puede cambiar/)).toHaveAttribute("role", "status");
  fireEvent.click(screen.getByText("Cómo funciona tu tarjeta"));
  expect(screen.getByText(/Las compras recientes pueden tardar/)).toBeVisible();
  expect(screen.getByText(/esta tarjeta no aplica descuentos/)).toBeVisible();
});

it("shows an expired or revoked capability as unavailable without the former balance", async () => {
  fetchMock.mockResolvedValueOnce(json({}, 404));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Pide al negocio un enlace nuevo");
  expect(screen.queryByLabelText("Tus puntos")).not.toBeInTheDocument();
});

it("recovers from a network failure with an explicit refresh", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Sin conexión"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
  fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
  expect(await screen.findByLabelText("Tus puntos")).toHaveTextContent("35");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("discards a previous card and its response when the fragment changes", async () => {
  let finishFirst: ((response: Response) => void) | undefined;
  fetchMock.mockImplementation(async (_url, init) => JSON.parse(String(init?.body)).token === "first-card"
    ? new Promise<Response>(resolve => { finishFirst = resolve; })
    : json({ ...card, business_name: "Segundo negocio", balance: 2 }));
  mount();
  await waitFor(() => expect(finishFirst).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Otra tarjeta" }));
  expect(await screen.findByRole("heading", { name: "Segundo negocio" })).toBeVisible();
  await act(async () => finishFirst!(json(card)));
  expect(screen.queryByText(card.business_name)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Tus puntos")).toHaveTextContent("2");
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("does not navigate to an untrusted menu address from a malformed response", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...card, catalog_path: "https://example.invalid/collect" }));
  mount();
  await screen.findByLabelText("Tus puntos");
  expect(screen.queryByRole("link", { name: "Ver menú del negocio" })).not.toBeInTheDocument();
});

it("reads the device membership with its protected cookie and keeps an existing card visible when enrollment is paused", async () => {
  fetchMock.mockResolvedValue(json({ available: false, enrolled: true, business_name: card.business_name, branch_name: card.branch_name, policy: card.policy, reward: null, csrf_token: null, card: { ...card, member_code: "KV-ABCD-EFGH-JKMP-QRST" }, card_path: "/lealtad?menu=patio" }));
  mount("/lealtad?menu=patio");
  fireEvent.click(await screen.findByText("Usar número de tarjeta"));
  expect(screen.getByRole("textbox", { name: "Número de tarjeta" })).toHaveValue("KV-ABCD-EFGH-JKMP-QRST");
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/public/loyalty/membership?menu=patio", expect.objectContaining({ credentials: "include", cache: "no-store", referrerPolicy: "no-referrer" }));
  expect(screen.getByLabelText("Tus puntos")).toHaveTextContent("35");
  expect(screen.queryByRole("button", { name: "Crear mi tarjeta" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Cómo funciona tu tarjeta"));
  expect(screen.getByText(/Puedes volver a consultar esta tarjeta desde este navegador hasta/)).toBeVisible();
});

it.each(["Unexpected token '<' in JSON", "SQLAlchemy query failed"]) ("does not display technical failures when reading a card: %s", async message => {
  fetchMock.mockRejectedValueOnce(new Error(message));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar tus puntos");
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Tus puntos")).not.toBeInTheDocument();
});

it("does not infer an old card by name when the device cookie is missing", async () => {
  fetchMock.mockResolvedValue(json({ available: false, enrolled: false, business_name: card.business_name, branch_name: card.branch_name, policy: card.policy, reward: null, csrf_token: null, card: null, card_path: "/lealtad?menu=patio" }));
  mount("/lealtad?menu=patio");
  expect(await screen.findByText(/No encontramos una tarjeta en este navegador/)).toBeVisible();
  expect(screen.queryByLabelText("Tus puntos")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
