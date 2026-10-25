import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import CatalogPublishView from "./CatalogPublishView";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/automations/workspace", () => ({
  OperationsSession: ({ children }: { children: (identity: object) => ReactNode }) => children({
    tenantId: "tenant-1", userId: "owner-1", branchId: "branch-1",
  }),
  useOnline: () => true,
  useOperationsRequest: () => request,
}));

const photo = "/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123";
const settings = { enabled: true, title: "Nuestro pan", description: null,
  whatsapp_phone: null, product_ids: [], version: 1, share_path: null };

beforeEach(() => {
  vi.clearAllMocks();
  request.mockImplementation(async (path, method, body) => {
    if (method === "PUT") return { ...settings, ...body, version: 2 };
    if (path === "/storefront/settings") return { ...settings, product_ids: [] };
    return [{ id: "product-1", name: "Pan de nuez", price_amount: "45.00", is_active: true,
      image_url: photo, image_position_x: 25, image_position_y: 60, image_zoom: 1.2 }];
  });
});

it("helps the owner identify products by their real photos without changing the publication contract", async () => {
  const { container } = render(<MemoryRouter><CatalogPublishView /></MemoryRouter>);
  const select = await screen.findByRole("checkbox", { name: /Pan de nuez/ });
  const image = container.querySelector("img");
  expect(image).toHaveAttribute("src", `${photo}&w=160`);
  expect(image).toHaveAttribute("alt", "");
  expect(image).toHaveStyle({ objectPosition: "25% 60%", transform: "scale(1.2)" });
  expect(screen.getByRole("link", { name: "Productos" })).toHaveAttribute("href", "/catalog");
  expect(screen.getByText(/elegir productos y cantidades, enviar una solicitud de pedido/)).toBeVisible();
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("button", { name: "Guardar publicación" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/storefront/settings", "PUT", {
    expected_version: 1, enabled: true, title: "Nuestro pan", description: null,
    whatsapp_phone: null, product_ids: ["product-1"], rotate_link: false,
  }, expect.any(String)));
  expect(await screen.findByText(/Catálogo publicado/)).toBeVisible();
});

it("updates an existing publication repeatedly without rotating its link or QR", async () => {
  const sharePath = "/catalogo/sweet-home-2";
  let current = { ...settings, product_ids: ["product-1"], share_path: sharePath };
  request.mockImplementation(async (path, method, body) => {
    if (method === "PUT") {
      current = { ...current, ...body, version: current.version + 1 };
      return current;
    }
    if (path === "/storefront/settings") return current;
    return [{ id: "product-1", name: "Pan de nuez", price_amount: "45.00", is_active: true }];
  });
  const fetchQr = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetchQr);
  try {
    render(<MemoryRouter><CatalogPublishView /></MemoryRouter>);
    const title = await screen.findByLabelText("Nombre del menú o negocio");
    const link = screen.getByRole("textbox", { name: "Enlace público" });
    expect(link).toHaveValue(`${window.location.origin}${sharePath}`);
    expect(screen.queryByRole("checkbox", { name: /Reemplazar el enlace/ })).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Sweet Home actualizado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar publicación" }));
    await screen.findByText(/Los cambios ya están disponibles en el mismo enlace y código QR/);
    expect(request).toHaveBeenCalledWith("/storefront/settings", "PUT", expect.objectContaining({
      title: "Sweet Home actualizado", expected_version: 1, rotate_link: false,
    }), expect.any(String));

    fireEvent.change(screen.getByLabelText("Descripción (opcional)"), { target: { value: "Nuestro nuevo menú" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar publicación" }));
    await screen.findByText(/Los cambios ya están disponibles en el mismo enlace y código QR/);
    expect(request).toHaveBeenLastCalledWith("/storefront/settings", "PUT", expect.objectContaining({
      description: "Nuestro nuevo menú", expected_version: 2, rotate_link: false,
    }), expect.any(String));
    expect(screen.getByRole("link", { name: "Abrir catálogo público" })).toHaveAttribute("href", sharePath);
    expect(link).toHaveValue(`${window.location.origin}${sharePath}`);
    expect(fetchQr).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});

it("copies the public link with accessible confirmation and links to the existing request inbox", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  try {
    request.mockResolvedValueOnce({ ...settings, share_path: "/catalogo/public-token" });
    render(<MemoryRouter><CatalogPublishView /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Copiar enlace" }));
    await screen.findByText("Enlace copiado. Ya puedes compartirlo con tus clientes.");
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/catalogo/public-token`);
    expect(screen.getByRole("link", { name: "Ver solicitudes del catálogo" })).toHaveAttribute("href", "/commercial-requests");
  } finally { vi.unstubAllGlobals(); }
});

it("selects the shareable link for manual copying when clipboard access is denied", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  try {
    request.mockResolvedValueOnce({ ...settings, share_path: "/catalogo/public-token" });
    render(<MemoryRouter><CatalogPublishView /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Copiar enlace" }));
    expect(await screen.findByText(/El enlace está seleccionado/)).toBeVisible();
    expect(screen.queryByText(/Enlace copiado/)).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Enlace público" }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  } finally { vi.unstubAllGlobals(); }
});
