import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import StorefrontView from "./StorefrontView";

const authSession = vi.hoisted(() => ({ status: "unauthenticated" }));
vi.mock("@/auth/useAuth", () => ({
  useOptionalAuth: () => ({ state: { status: authSession.status } }),
}));
const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const catalog = {
  title: "Catálogo compartido",
  description: "Consulta los productos publicados",
  whatsapp_phone: "525550000000",
  checkout_available: false,
  products: [
    {
      id: "product-1",
      name: "Pan de nuez",
      description: "Producto publicado",
      price_amount: "45.00",
      availability: "available",
    },
  ],
};

function NavigateCatalog() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => void navigate("/catalogo/second")}>
        Cambiar catálogo
      </button>
      <Routes>
        <Route path="/catalogo/:token" element={<StorefrontView />} />
      </Routes>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authSession.status = "unauthenticated";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(json(catalog));
});

it("loads the public catalog without private cookies and links only to a public consultation", async () => {
  render(
    <MemoryRouter initialEntries={["/catalogo/first"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("heading", { name: "Pan de nuez" }),
  ).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/public/catalog/first",
    expect.objectContaining({ credentials: "omit", cache: "no-store" }),
  );
  expect(
    screen.getByRole("link", { name: "Consultar por WhatsApp" }),
  ).toHaveAttribute(
    "href",
    expect.stringContaining("https://wa.me/525550000000?text="),
  );
  expect(
    screen.queryByRole("button", { name: /Pagar|Comprar/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Consulta sin reserva ni cobro automático/),
  ).toBeVisible();
});

it("shows a withdrawn catalog without exposing its previous products", async () => {
  fetchMock.mockResolvedValue(json({ detail: "Not found" }, 404));
  render(
    <MemoryRouter initialEntries={["/catalogo/withdrawn"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Este catálogo ya no está disponible",
  );
  expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument();
});

it("discards an old response when the public URL changes", async () => {
  let resolveFirst: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith("/first")
      ? new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        })
      : json({ ...catalog, title: "Segundo catálogo", products: [] }),
  );
  render(
    <MemoryRouter initialEntries={["/catalogo/first"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  await waitFor(() => expect(resolveFirst).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Cambiar catálogo" }));
  expect(
    await screen.findByRole("heading", { name: "Segundo catálogo" }),
  ).toBeVisible();
  resolveFirst!(json(catalog));
  await waitFor(() =>
    expect(screen.queryByText("Pan de nuez")).not.toBeInTheDocument(),
  );
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("does not build a WhatsApp link from an invalid public phone", async () => {
  fetchMock.mockResolvedValue(
    json({ ...catalog, whatsapp_phone: "javascript:alert(1)" }),
  );
  render(
    <MemoryRouter initialEntries={["/catalogo/first"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Pan de nuez" });
  expect(
    screen.queryByRole("link", { name: "Consultar por WhatsApp" }),
  ).not.toBeInTheDocument();
});

it("captures a public request without cookies, orders or inferred campaign consent", async () => {
  fetchMock.mockImplementation(async (_url, init) =>
    init?.method === "POST"
      ? json({ receipt_id: "receipt-1", status: "received" })
      : json(catalog),
  );
  render(
    <MemoryRouter initialEntries={["/catalogo/first"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Pan de nuez" });
  fireEvent.change(screen.getByLabelText("Tu nombre"), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByLabelText("Teléfono o correo para responder"), {
    target: { value: "ana@example.com" },
  });
  fireEvent.change(screen.getByLabelText("¿Qué te gustaría consultar?"), {
    target: { value: "¿Tienen diez piezas para mañana?" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pan de nuez" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Enviar solicitud al negocio" }),
  );
  expect(await screen.findByText(/Solicitud recibida/)).toBeVisible();
  const [url, init] = fetchMock.mock.calls.find(
    ([, request]) => request?.method === "POST",
  )!;
  expect(url).toBe("/api/v1/public/catalog/first/requests");
  expect(init?.credentials).toBe("omit");
  expect(JSON.parse(String(init?.body))).toEqual({
    name: "Ana",
    contact: "ana@example.com",
    message: "¿Tienen diez piezas para mañana?",
    product_ids: ["product-1"],
    submission_id: expect.any(String),
  });
  expect(screen.getByText(/ni te suscribe a campañas/)).toBeVisible();
});

it("reuses a public request key after an uncertain network outcome", async () => {
  let submissions = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return json(catalog);
    submissions++;
    if (submissions === 1) throw new TypeError("NetworkError");
    return json({ receipt_id: "receipt-1", status: "received" });
  });
  render(
    <MemoryRouter initialEntries={["/catalogo/first"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Pan de nuez" });
  fireEvent.change(screen.getByLabelText("Tu nombre"), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByLabelText("Teléfono o correo para responder"), {
    target: { value: "ana@example.com" },
  });
  fireEvent.change(screen.getByLabelText("¿Qué te gustaría consultar?"), {
    target: { value: "Consulta" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Enviar solicitud al negocio" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Enviar solicitud al negocio" }),
  );
  await screen.findByText(/Solicitud recibida/);
  const posts = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
});

it("waits for the initial identity check before accepting public form input", async () => {
  authSession.status = "loading";
  const view = render(
    <MemoryRouter initialEntries={["/catalogo/first"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  expect(screen.getByText("Preparando catálogo…")).toBeVisible();
  expect(screen.queryByLabelText("Tu nombre")).not.toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  authSession.status = "authenticated";
  view.rerender(
    <MemoryRouter initialEntries={["/catalogo/first"]}>
      <NavigateCatalog />
    </MemoryRouter>,
  );
  expect(await screen.findByLabelText("Tu nombre")).toBeVisible();
});

it("lets customers select from product cards and sends only the existing public request contract", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
    ? json({ receipt_id: "receipt-1", status: "received" }) : json(catalog));
  render(<MemoryRouter initialEntries={["/catalogo/first"]}><NavigateCatalog /></MemoryRouter>);
  const select = await screen.findByRole("button", { name: "Seleccionar Pan de nuez para consultar" });
  fireEvent.click(select);
  expect(screen.getByRole("button", { name: "Quitar Pan de nuez para consultar" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("checkbox", { name: "Pan de nuez" })).toBeChecked();
  expect(screen.getByRole("link", { name: "Continuar con mi consulta" })).toHaveAttribute("href", "#solicitud-catalogo");
  expect(screen.getByText("Tu selección: Pan de nuez.")).toBeVisible();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Tu nombre"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Teléfono o correo para responder"), { target: { value: "ana@example.com" } });
  fireEvent.change(screen.getByLabelText("¿Qué te gustaría consultar?"), { target: { value: "¿Tienen diez piezas?" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud al negocio" }));
  await screen.findByText(/Solicitud recibida/);
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ name: "Ana", contact: "ana@example.com",
    message: "¿Tienen diez piezas?", product_ids: ["product-1"], submission_id: expect.any(String) });
  expect(posts[0][1]?.credentials).toBe("omit");
  expect(screen.getByRole("button", { name: "Quitar Pan de nuez para consultar" })).toBeDisabled();
});

it("keeps card/form selection synchronized and clears it when the catalog link changes", async () => {
  fetchMock.mockImplementation(async () => json(catalog));
  render(<MemoryRouter initialEntries={["/catalogo/first"]}><NavigateCatalog /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Pan de nuez" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pan de nuez" }));
  expect(screen.getByRole("button", { name: "Quitar Pan de nuez para consultar" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Quitar Pan de nuez para consultar" }));
  expect(screen.getByRole("checkbox", { name: "Pan de nuez" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar Pan de nuez para consultar" }));
  fireEvent.click(screen.getByRole("button", { name: "Cambiar catálogo" }));
  expect(await screen.findByRole("button", { name: "Seleccionar Pan de nuez para consultar" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("checkbox", { name: "Pan de nuez" })).not.toBeChecked();
});

it("enforces the existing twenty-product consultation limit from either selection surface", async () => {
  fetchMock.mockResolvedValue(json({ ...catalog, products: Array.from({ length: 21 }, (_, index) => ({
    ...catalog.products[0], id: `product-${index}`, name: `Producto ${index}`,
  })) }));
  render(<MemoryRouter initialEntries={["/catalogo/first"]}><NavigateCatalog /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Producto 0" });
  for (let index = 0; index < 20; index++) {
    fireEvent.click(screen.getByRole("button", { name: `Seleccionar Producto ${index} para consultar` }));
  }
  expect(screen.getByRole("button", { name: "Seleccionar Producto 20 para consultar" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Producto 20" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Producto 0" }));
  expect(screen.getByRole("button", { name: "Seleccionar Producto 20 para consultar" })).toBeEnabled();
});

it("renders the real photo fields returned by the public catalog without requiring a private product read", async () => {
  const imageUrl = "/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123";
  fetchMock.mockImplementation(async () => json({ ...catalog, products: [{ ...catalog.products[0],
    image_url: imageUrl, image_position_x: 25, image_position_y: 70, image_zoom: 1.2,
  }] }));
  render(<MemoryRouter initialEntries={["/catalogo/first"]}><NavigateCatalog /></MemoryRouter>);
  const photo = await screen.findByRole("img", { name: "Pan de nuez" });
  expect(photo).toHaveAttribute("src", `${imageUrl}&w=400`);
  expect(photo).toHaveStyle({ objectPosition: "25% 70%", transform: "scale(1.2)" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/public/catalog/first");
});
