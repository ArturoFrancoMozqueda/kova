import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import StorefrontView from "./StorefrontView";

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
