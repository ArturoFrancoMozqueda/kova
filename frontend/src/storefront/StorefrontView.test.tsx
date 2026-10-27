import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StorefrontView from "./StorefrontView";

const authSession = vi.hoisted(() => ({ status: "unauthenticated" }));
vi.mock("@/auth/useAuth", () => ({
  useOptionalAuth: () => ({ state: { status: authSession.status } }),
}));
const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const catalog = {
  title: "Catálogo compartido", description: "Consulta los productos publicados",
  whatsapp_phone: "525550000000", checkout_available: false,
  products: [{ id: "product-1", name: "Pan de nuez", description: "Producto publicado",
    price_amount: "45.00", availability: "available" }],
};
function TrackingDestination() { const location = useLocation(); return <h1>Seguimiento recibido {location.hash}</h1>; }
function NavigateCatalog() {
  const navigate = useNavigate();
  return <><button onClick={() => void navigate("/catalogo/second")}>Cambiar catálogo</button>
    <Routes><Route path="/catalogo/:token" element={<StorefrontView />} /><Route path="/seguimiento" element={<TrackingDestination />} /></Routes></>;
}
const showMenu = () => render(<MemoryRouter initialEntries={["/catalogo/first"]}><NavigateCatalog /></MemoryRouter>);
const menu = () => within(screen.getByRole("region", { name: "Nuestro menú" }));
const summary = () => within(screen.getByRole("region", { name: "Tu pedido" }));
function fillContact() {
  fireEvent.change(screen.getByLabelText("Tu nombre"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Teléfono o correo para responder"), { target: { value: "ana@example.com" } });
}
async function addBread() {
  fireEvent.click(await screen.findByRole("button", { name: "Agregar Pan de nuez al pedido" }));
}
function receiveRequests() {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
    ? json({ receipt_id: "receipt-1", status: "received" }) : json(catalog));
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  vi.clearAllMocks();
  authSession.status = "unauthenticated";
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  fetchMock.mockImplementation(async () => json(catalog));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("loads the menu without private cookies, keeps WhatsApp secondary and does not offer payment", async () => {
  showMenu();
  expect(await screen.findByRole("heading", { name: "Pan de nuez" })).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/public/catalog/first",
    expect.objectContaining({ credentials: "omit", cache: "no-store" }));
  expect(screen.getByRole("link", { name: "Consultar por WhatsApp" })).toHaveAttribute("href", expect.stringContaining("https://wa.me/525550000000?text="));
  expect(screen.queryByRole("button", { name: /Pagar|Comprar/ })).not.toBeInTheDocument();
  expect(screen.getByText(/El negocio revisa y confirma tu pedido/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Enviar solicitud de pedido" })).toBeDisabled();
});

const memberCard = {
  business_name: catalog.title, branch_name: "Sucursal principal", balance: 0,
  adjustments_pending: false, policy: { enabled: true, spend_amount: "25.00", points_per_step: 2, version: 1 },
  expires_at: "2027-01-01T00:00:00Z", catalog_path: "/catalogo/first", reward: null,
  member_code: "KV-ABCD-EFGH-JKLM-NPQR",
};

it("obtains a personal card without navigating away or losing the current menu order", async () => {
  let cardCreated = false;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).includes("/membership/enroll")) { cardCreated = true; return json({ card: memberCard, card_path: "/lealtad?menu=first" }, 201); }
    if (String(url).includes("/membership?")) return json({ available: true, enrolled: cardCreated, business_name: catalog.title,
      branch_name: "Sucursal principal", policy: memberCard.policy, reward: null, csrf_token: "device-grant", card: cardCreated ? memberCard : null, card_path: "/lealtad?menu=first" });
    if (init?.method === "POST") return json({ receipt_id: "receipt-1", status: "received" }, 201);
    return json({ ...catalog, loyalty_available: true });
  });
  showMenu(); await addBread();
  fireEvent.click(await screen.findByRole("button", { name: /Tu tarjeta de lealtad/ }));
  const signup = within(screen.getByRole("dialog", { name: `Tu tarjeta en ${catalog.title}` }));
  fireEvent.change(signup.getByLabelText("¿Cómo te llamamos?"), { target: { value: "Ana" } });
  fireEvent.click(signup.getByRole("checkbox", { name: "Quiero crear mi tarjeta personal en este dispositivo." }));
  fireEvent.click(signup.getByRole("button", { name: "Crear mi tarjeta" }));
  const card = await signup.findByRole("link", { name: /Ver mi tarjeta/ });
  expect(card).toHaveAttribute("href", "/lealtad?menu=first");
  expect(card).toHaveAttribute("target", "_blank");
  fireEvent.click(signup.getByRole("button", { name: "Cerrar" }));
  expect(summary().getByText("Subtotal estimado").parentElement).toHaveTextContent("$45.00");
  fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  await screen.findByText("Solicitud de pedido recibida");
  const request = posts().find(([url]) => String(url).endsWith("/requests"));
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ order_lines: [{ product_id: "product-1", quantity: 1 }] });
});

it("lets an existing member return from the menu when new enrollments are paused", async () => {
  fetchMock.mockImplementation(async url => String(url).includes("/membership?")
    ? json({ available: false, enrolled: true, business_name: catalog.title, branch_name: "Sucursal principal",
      policy: memberCard.policy, reward: null, csrf_token: null, card: memberCard, card_path: "/lealtad?menu=first" })
    : json({ ...catalog, loyalty_available: false }));
  showMenu();
  fireEvent.click(await screen.findByRole("button", { name: /Ver mi tarjeta/ }));
  expect(await screen.findByRole("link", { name: /Ver mi tarjeta/ })).toHaveAttribute("href", "/lealtad?menu=first");
  expect(screen.queryByLabelText("¿Cómo te llamamos?")).not.toBeInTheDocument();
  expect(posts()).toHaveLength(0);
});

it("shows a withdrawn catalog without exposing its previous products", async () => {
  fetchMock.mockImplementation(async () => json({ detail: "Not found" }, 404));
  showMenu();
  expect(await screen.findByRole("alert")).toHaveTextContent("Este catálogo ya no está disponible");
  expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument();
});

it("can retry a failed menu read", async () => {
  fetchMock.mockResolvedValueOnce(json({}, 503)).mockImplementation(async () => json(catalog));
  showMenu();
  fireEvent.click(await screen.findByRole("button", { name: "Volver a intentar" }));
  expect(await screen.findByRole("heading", { name: "Pan de nuez" })).toBeVisible();
});

it.each(["malformed JSON", "technical network error"])("keeps a %s out of the public menu and offers a safe retry", async failure => {
  fetchMock.mockImplementationOnce(async () => {
    if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
    throw new Error("Failed to fetch: backend postgres connection failed");
  });
  showMenu();
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el menú. Revisa tu conexión e intenta de nuevo.");
  expect(screen.queryByText(/Unexpected token|Failed to fetch|postgres|proxy error/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
  expect(await screen.findByRole("heading", { name: "Pan de nuez" })).toBeVisible();
});

it("discards an old response when the public URL changes", async () => {
  let resolveFirst: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async url => String(url).endsWith("/first")
    ? new Promise<Response>(resolve => { resolveFirst = resolve; })
    : json({ ...catalog, title: "Segundo catálogo", products: [] }));
  showMenu();
  await waitFor(() => expect(resolveFirst).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Cambiar catálogo" }));
  expect(await screen.findByRole("heading", { name: "Segundo catálogo" })).toBeVisible();
  await act(async () => { resolveFirst!(json(catalog)); });
  expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("does not build a WhatsApp link from an invalid public phone", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, whatsapp_phone: "javascript:alert(1)" }));
  showMenu();
  await screen.findByRole("heading", { name: "Pan de nuez" });
  expect(screen.queryByRole("link", { name: "Consultar por WhatsApp" })).not.toBeInTheDocument();
});

it("lets a visitor send a general consultation with the unchanged public request contract", async () => {
  receiveRequests(); showMenu();
  fireEvent.click(await screen.findByRole("button", { name: "Solo consultar" }));
  fillContact();
  fireEvent.change(screen.getByLabelText("¿Qué te gustaría consultar?"), { target: { value: "¿Abren mañana?" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud al negocio" }));
  expect(await screen.findByText("Solicitud recibida")).toBeVisible();
  const [url, init] = posts()[0];
  expect(url).toBe("/api/v1/public/catalog/first/requests");
  expect(init).toEqual(expect.objectContaining({ credentials: "omit", cache: "no-store" }));
  expect(JSON.parse(String(init?.body))).toEqual({ name: "Ana", contact: "ana@example.com",
    message: "¿Abren mañana?", product_ids: [], submission_id: expect.any(String) });
});

it("sends quantities, origin and notes to the Kova inbox as a pending request, without creating an order or charging", async () => {
  receiveRequests(); showMenu(); await addBread();
  fireEvent.click(menu().getByRole("button", { name: "Agregar uno de Pan de nuez" }));
  fillContact();
  fireEvent.click(screen.getByLabelText("En el negocio"));
  fireEvent.change(screen.getByLabelText("Notas para el negocio (opcional)"), { target: { value: "Mesa 4" } });
  expect(summary().getByText("Subtotal estimado").parentElement).toHaveTextContent("$90.00");
  expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  expect(await screen.findByText("Solicitud de pedido recibida")).toBeVisible();
  const [url, init] = posts()[0];
  expect(url).toBe("/api/v1/public/catalog/first/requests");
  expect(init?.credentials).toBe("omit");
  const body = JSON.parse(String(init?.body));
  expect(body).toEqual({ name: "Ana", contact: "ana@example.com", product_ids: ["product-1"],
    order_lines: [{ product_id: "product-1", quantity: 2 }], origin: "in_store",
    submission_id: expect.any(String), message: expect.any(String) });
  expect(body.message).toContain("2 × Pan de nuez");
  expect(body.message).toContain("Origen: En el negocio");
  expect(body.message).toContain("Subtotal estimado: $90.00 MXN");
  expect(body.message).toContain("Notas: Mesa 4");
  expect(screen.getByText(/Falta que la revise y acepte/)).toBeVisible();
  expect(screen.queryByText(/Referencia de solicitud:|receipt-1/)).not.toBeInTheDocument();
  expect(screen.getByText("Solicitud de pedido recibida").parentElement).toHaveFocus();
  expect(menu().getByRole("button", { name: "Agregar uno de Pan de nuez" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: /Ver mi pedido/ })).not.toBeInTheDocument();
});

it("automatically opens only the tracking returned for a structured order while keeping the public request anonymous", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
    ? json({ receipt_id: "receipt-track", status: "received", tracking_path: "/seguimiento#signed-capability", tracking_expires_at: "2026-11-26T12:00:00Z" }) : json(catalog));
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  expect(await screen.findByRole("heading", { name: "Seguimiento recibido #signed-capability" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Enviar solicitud de pedido" })).not.toBeInTheDocument();
  const body = JSON.parse(String(posts()[0][1]?.body));
  expect(body.order_lines).toEqual([{ product_id: "product-1", quantity: 1 }]);
  expect(body.origin).toBe("remote");
  expect(posts()[0][1]).toEqual(expect.objectContaining({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }));

});

it("does not invent tracking when an older backend omits it or a response points outside Kova", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
    ? json({ receipt_id: "receipt-legacy", status: "received", tracking_path: "https://example.invalid/seguimiento#token" }) : json(catalog));
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  await screen.findByText("Solicitud de pedido recibida");
  expect(screen.queryByRole("link", { name: "Ver estado de mi solicitud" })).not.toBeInTheDocument();
});

it("reuses the exact request key after an uncertain network outcome and blocks double submission", async () => {
  let submissions = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return json(catalog);
    if (++submissions === 1) throw new TypeError("NetworkError");
    return json({ receipt_id: "receipt-1", status: "received" });
  });
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviando solicitud…" }));
  await screen.findByText("Solicitud de pedido recibida");
  expect(posts()).toHaveLength(2);
  expect(posts()[0][1]?.body).toBe(posts()[1][1]?.body);
});

it.each(["malformed JSON", "technical network error"])("keeps a %s out of request feedback and retries the exact original submission", async failure => {
  let submissions = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return json(catalog);
    if (++submissions === 1) {
      if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
      throw new Error("Failed to fetch: backend postgres connection failed");
    }
    return json({ receipt_id: "receipt-1", status: "received" });
  });
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar si recibimos tu solicitud. Revisa tu conexión y vuelve a intentar con los mismos datos.");
  expect(screen.queryByText(/Unexpected token|Failed to fetch|postgres|proxy error/)).not.toBeInTheDocument();
  expect(screen.queryByText("Solicitud de pedido recibida")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  await screen.findByText("Solicitud de pedido recibida");
  expect(posts()).toHaveLength(2);
  expect(posts()[0][1]?.body).toBe(posts()[1][1]?.body);
});

it.each([
  [404, "Este menú ya no está disponible para solicitudes."],
  [410, "Este menú ya no está disponible para solicitudes."],
  [429, "Recibimos varias solicitudes. Espera un momento antes de volver a intentar."],
] as const)("preserves controlled request feedback for HTTP %i", async (status, message) => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? json({ detail: "internal debug information" }, status) : json(catalog));
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText("internal debug information")).not.toBeInTheDocument();
});

it("uses a new request key when the visitor edits a failed request", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? json({}, 422) : json(catalog));
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  await screen.findByRole("alert");
  fireEvent.click(summary().getByRole("button", { name: "Agregar uno de Pan de nuez" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(JSON.parse(String(posts()[0][1]?.body)).submission_id).not.toBe(JSON.parse(String(posts()[1][1]?.body)).submission_id);
});

it("waits for the initial identity check before accepting public input", async () => {
  authSession.status = "loading";
  const view = showMenu();
  expect(screen.getByText("Preparando menú…")).toBeVisible();
  expect(screen.queryByLabelText("Tu nombre")).not.toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  authSession.status = "authenticated";
  view.rerender(<MemoryRouter initialEntries={["/catalogo/first"]}><NavigateCatalog /></MemoryRouter>);
  expect(await screen.findByLabelText("Tu nombre")).toBeVisible();
});

it("keeps menu and summary quantities synchronized and supports removal from either surface", async () => {
  showMenu(); await addBread();
  fireEvent.click(menu().getByRole("button", { name: "Agregar uno de Pan de nuez" }));
  expect(summary().getByText("Subtotal estimado").parentElement).toHaveTextContent("$90.00");
  fireEvent.click(summary().getByRole("button", { name: "Restar uno de Pan de nuez" }));
  expect(summary().getByRole("group", { name: "Cantidad de Pan de nuez" })).toHaveTextContent("Cantidad: 1");
  fireEvent.click(menu().getByRole("button", { name: "Restar uno de Pan de nuez" }));
  expect(summary().getByText("¿Qué se te antoja pedir?")).toBeVisible();
  await addBread();
  fireEvent.click(summary().getByRole("button", { name: "Quitar Pan de nuez del pedido" }));
  expect(menu().getByRole("button", { name: "Agregar Pan de nuez al pedido" })).toBeEnabled();
});

it("clears the basket, search and personal information when the catalog link changes", async () => {
  showMenu(); await addBread(); fillContact();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Pan" } });
  fireEvent.click(screen.getByRole("button", { name: "Cambiar catálogo" }));
  await screen.findByRole("button", { name: "Agregar Pan de nuez al pedido" });
  expect(screen.getByLabelText("Tu nombre")).toHaveValue("");
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(summary().getByText("¿Qué se te antoja pedir?")).toBeVisible();
});

it("opens mobile review without losing the basket or contact details when returning to the menu", async () => {
  vi.stubGlobal("scrollTo", vi.fn());
  showMenu(); await addBread();
  const trigger = screen.getByRole("button", { name: /Ver mi pedido/ });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole("complementary", { name: "Revisar pedido" })).toHaveFocus();
  fillContact();
  fireEvent.change(screen.getByLabelText("Notas para el negocio (opcional)"), { target: { value: "Mesa 4" } });
  fireEvent.click(screen.getByRole("button", { name: "Volver al menú" }));
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  expect(screen.getByLabelText("Tu nombre")).toHaveValue("Ana");
  expect(screen.getByLabelText("Notas para el negocio (opcional)")).toHaveValue("Mesa 4");
  expect(summary().getByText("Pan de nuez")).toBeInTheDocument();
  expect(posts()).toHaveLength(0);
});

it("opens a general inquiry directly from the mobile menu without requiring products", async () => {
  vi.stubGlobal("scrollTo", vi.fn());
  showMenu();
  fireEvent.click(await screen.findByRole("button", { name: "Hacer una consulta" }));
  expect(screen.getByRole("button", { name: "Solo consultar" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("¿Qué te gustaría consultar?")).toBeInTheDocument();
  expect(screen.queryByText("¿Qué se te antoja pedir?")).not.toBeInTheDocument();
});

it("caps distinct products at twenty while allowing quantity updates and replacing a removed item", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, products: Array.from({ length: 21 }, (_, index) => ({
    ...catalog.products[0], id: `product-${index}`, name: `Producto ${index}`,
  })) }));
  showMenu(); await screen.findByRole("heading", { name: "Producto 0" });
  for (let index = 0; index < 20; index++) fireEvent.click(screen.getByRole("button", { name: `Agregar Producto ${index} al pedido` }));
  expect(screen.getByRole("button", { name: "Agregar Producto 20 al pedido" })).toBeDisabled();
  expect(menu().getByRole("button", { name: "Agregar uno de Producto 0" })).toBeEnabled();
  fireEvent.click(summary().getByRole("button", { name: "Quitar Producto 0 del pedido" }));
  expect(screen.getByRole("button", { name: "Agregar Producto 20 al pedido" })).toBeEnabled();
});

it("caps each product at ninety-nine units", async () => {
  showMenu(); await addBread();
  const increment = menu().getByRole("button", { name: "Agregar uno de Pan de nuez" });
  for (let index = 1; index < 99; index++) fireEvent.click(increment);
  expect(increment).toBeDisabled();
  expect(summary().getByRole("button", { name: "Agregar uno de Pan de nuez" })).toBeDisabled();
  fireEvent.click(summary().getByRole("button", { name: "Restar uno de Pan de nuez" }));
  expect(increment).toBeEnabled();
});

it("searches names and descriptions without accents and preserves the basket while filtering", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, products: [catalog.products[0], {
    ...catalog.products[0], id: "coffee", name: "Café frío", description: "Bebida con canela", availability: "unavailable",
  }] }));
  showMenu(); await addBread();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: " CAFE " } });
  expect(menu().getByRole("heading", { name: "Café frío" })).toBeVisible();
  expect(menu().queryByRole("heading", { name: "Pan de nuez" })).not.toBeInTheDocument();
  expect(summary().getByText("Pan de nuez")).toBeVisible();
  expect(menu().getByRole("button", { name: "Agregar Café frío al pedido" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Disponibles" }));
  expect(screen.getByText("No encontramos productos con estos filtros.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda y filtros" }));
  expect(menu().getByRole("heading", { name: "Pan de nuez" })).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "canela" } });
  expect(menu().getByRole("heading", { name: "Café frío" })).toBeVisible();
});

it("shows an honest empty menu and still permits general questions", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, products: [] }));
  showMenu();
  expect(await screen.findByText("El menú se está preparando")).toBeVisible();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enviar solicitud de pedido" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Solo consultar" }));
  expect(screen.getByLabelText("¿Qué te gustaría consultar?")).toBeVisible();
});

it("searches multiple words, announces real result counts and clears without losing focus or selected products", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, products: [catalog.products[0], {
    ...catalog.products[0], id: "coffee", name: "Café frío", description: "Bebida con canela",
  }] }));
  showMenu(); await addBread();
  const search = screen.getByRole("searchbox", { name: "Buscar en el menú" });
  fireEvent.change(search, { target: { value: "canela CAFE" } });
  expect(menu().getByRole("heading", { name: "Café frío" })).toBeVisible();
  expect(menu().getByRole("status")).toHaveTextContent("1 de 2 productos");
  expect(summary().getByText("Pan de nuez")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
  expect(menu().getAllByRole("article")).toHaveLength(2);
  fireEvent.change(search, { target: { value: "inexistente" } });
  fireEvent.keyDown(search, { key: "Escape" });
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
  expect(posts()).toHaveLength(0);
});

it("orders published products by real prices and restores business order without changing the basket", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, products: [catalog.products[0], {
    ...catalog.products[0], id: "coffee", name: "Café frío", price_amount: "35.50",
  }] }));
  showMenu(); await addBread();
  const sort = screen.getByRole("combobox", { name: "Ordenar menú" });
  fireEvent.change(sort, { target: { value: "price_asc" } });
  expect(menu().getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Café frío", "Pan de nuez"]);
  expect(summary().getByText("Subtotal estimado").parentElement).toHaveTextContent("$45.00");
  fireEvent.change(sort, { target: { value: "published" } });
  expect(menu().getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Pan de nuez", "Café frío"]);
  expect(posts()).toHaveLength(0);
});

it("prioritizes the first menu photo and keeps remaining photographs lazy", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, products: [
    { ...catalog.products[0], image_url: "/showcase/products/concha-vainilla.png" },
    { ...catalog.products[0], id: "coffee", name: "Café frío", image_url: "/showcase/products/cold-brew.png" },
  ] }));
  showMenu();
  const first = await screen.findByRole("img", { name: "Pan de nuez" });
  expect(first).toHaveAttribute("loading", "eager");
  expect(first).toHaveAttribute("fetchpriority", "high");
  expect(screen.getByRole("img", { name: "Café frío" })).toHaveAttribute("loading", "lazy");
  expect(screen.getByRole("img", { name: "Café frío" })).not.toHaveAttribute("fetchpriority");
});

it("preserves the basket offline and requires reconnection before submission", async () => {
  showMenu(); await addBread(); fillContact();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  expect(await screen.findByText(/Sin conexión. Tu selección sigue aquí/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Enviar solicitud de pedido" })).toBeDisabled();
  expect(summary().getByText("Pan de nuez")).toBeVisible();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  fireEvent(window, new Event("online"));
  expect(screen.getByRole("button", { name: "Enviar solicitud de pedido" })).toBeEnabled();
  expect(posts()).toHaveLength(0);
});

it("blocks oversized requests instead of truncating product names or quantities", async () => {
  fetchMock.mockImplementation(async () => json({ ...catalog, products: Array.from({ length: 6 }, (_, index) => ({
    ...catalog.products[0], id: `p-${index}`, name: `${index} ${"Pan con nuez ".repeat(12)}`,
  })) }));
  showMenu(); await screen.findByRole("heading", { name: catalog.title }); fillContact();
  for (const button of menu().getAllByRole("button", { name: /^Agregar .+ al pedido$/ })) fireEvent.click(button);
  expect(screen.getByRole("alert")).toHaveTextContent("La solicitud supera los 1,000 caracteres");
  expect(screen.getByRole("button", { name: "Enviar solicitud de pedido" })).toBeDisabled();
  expect(posts()).toHaveLength(0);
});

it("does not claim receipt if a success response is malformed", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? json({}) : json(catalog));
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar la recepción");
  expect(screen.queryByText("Solicitud de pedido recibida")).not.toBeInTheDocument();
});

it("aborts pending submissions when navigating to a different business", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise(() => {}) : json(catalog));
  showMenu(); await addBread(); fillContact();
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud de pedido" }));
  await waitFor(() => expect(posts()).toHaveLength(1));
  const signal = posts()[0][1]?.signal;
  fireEvent.click(screen.getByRole("button", { name: "Cambiar catálogo" }));
  await screen.findByRole("heading", { name: "Pan de nuez" });
  expect(signal?.aborted).toBe(true);
  expect(screen.getByLabelText("Tu nombre")).toHaveValue("");
});

it("renders real public photos without private product reads", async () => {
  const imageUrl = "/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123";
  fetchMock.mockImplementation(async () => json({ ...catalog, products: [{ ...catalog.products[0], image_url: imageUrl,
    image_position_x: 25, image_position_y: 70, image_zoom: 1.2 }] }));
  showMenu();
  const photo = await screen.findByRole("img", { name: "Pan de nuez" });
  expect(photo).toHaveAttribute("src", `${imageUrl}&w=400`);
  expect(photo).toHaveStyle({ objectPosition: "25% 70%", transform: "scale(1.2)" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/public/catalog/first");
});

it("opens the full product description and photo before adding it, without sending a request", async () => {
  showMenu();
  fireEvent.click(await screen.findByRole("button", { name: "Ver detalles de Pan de nuez" }));
  const details = await screen.findByRole("dialog", { name: "Pan de nuez" });
  expect(within(details).getByText("Producto publicado")).toBeVisible();
  fireEvent.click(within(details).getByRole("button", { name: "Agregar al pedido" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(menu().getByRole("group", { name: "Cantidad de Pan de nuez" })).toHaveTextContent("1");
  expect(posts()).toHaveLength(0);
});
