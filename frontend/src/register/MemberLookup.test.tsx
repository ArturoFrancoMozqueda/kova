import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { MemberLookup } from "./MemberLookup";

const identity = { tenantId: "tenant-one", userId: "cashier-one", branchId: "branch-one" };
const customer = { id: "11111111-1111-4111-8111-111111111111", name: "Ana del Patio", is_active: true };
const code = "KV-0123-4567-89AB-CDEF";
const response = (status = 200, body: unknown = { customer }) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

afterEach(() => { vi.unstubAllGlobals(); document.cookie = "csrf_token=; Max-Age=0"; });

function openLookup() {
  fireEvent.click(screen.getByRole("button", { name: "Identificar tarjeta" }));
  const input = screen.getByRole("textbox", { name: "Número de tarjeta" });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: code } });
  return input;
}

it("consulta sólo el código por POST autenticado y exige confirmar al cliente antes de asociarlo", async () => {
  document.cookie = "csrf_token=csrf-test";
  const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetch);
  const onSelect = vi.fn(), onSubmit = vi.fn(event => event.preventDefault());
  const { container } = render(<form onSubmit={onSubmit}><MemberLookup identity={identity} online disabled={false} onSelect={onSelect} /></form>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.keyDown(openLookup(), { key: "Enter" });
  const confirm = await screen.findByRole("button", { name: "Usar cliente" });
  expect(confirm).toHaveFocus();
  expect(fetch).toHaveBeenCalledWith("/api/v1/loyalty/members/resolve", expect.objectContaining({
    method: "POST", credentials: "include", cache: "no-store", body: JSON.stringify({ code }),
    headers: expect.objectContaining({ "X-CSRF-Token": "csrf-test", "X-Kova-Expected-Tenant": identity.tenantId,
      "X-Kova-Expected-User": identity.userId, "X-Kova-Branch": identity.branchId }),
  }));
  expect(onSubmit).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
  expect((await axe(container, { runOnly: ["label", "button-name", "aria-allowed-attr"] })).violations).toEqual([]);
  fireEvent.click(confirm);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(customer);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Identificar tarjeta" })).toHaveFocus();
});

it.each(["tenantId", "userId", "branchId"] as const)("descarta una respuesta tardía si cambia %s y no conserva el código", async field => {
  let resolve: (value: Response) => void = () => undefined;
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetch);
  const onSelect = vi.fn();
  const view = render(<MemberLookup identity={identity} online disabled={false} onSelect={onSelect} />);
  openLookup(); fireEvent.click(screen.getByRole("button", { name: "Buscar tarjeta" }));
  const signal = fetch.mock.calls[0][1].signal as AbortSignal;
  view.rerender(<MemberLookup identity={{ ...identity, [field]: "another-principal" }} online disabled={false} onSelect={onSelect} />);
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(response()); });
  expect(screen.queryByText("Ana del Patio")).not.toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Identificar tarjeta" }));
  expect(screen.getByRole("textbox")).toHaveValue("");
});

it("bloquea identificación y confirmación durante un cobro pendiente y descarta la consulta en vuelo", async () => {
  let resolve: (value: Response) => void = () => undefined;
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetch);
  const onSelect = vi.fn();
  const view = render(<MemberLookup identity={identity} online disabled={false} onSelect={onSelect} />);
  openLookup(); fireEvent.click(screen.getByRole("button", { name: "Buscar tarjeta" }));
  view.rerender(<MemberLookup identity={identity} online disabled onSelect={onSelect} />);
  expect(screen.getByRole("button", { name: "Identificar tarjeta" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Buscar tarjeta" })).toBeDisabled();
  await act(async () => { resolve(response()); });
  expect(screen.queryByRole("button", { name: "Usar cliente" })).not.toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
});

it("sólo permite identificar tarjetas en línea", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<MemberLookup identity={identity} online={false} disabled={false} onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Identificar tarjeta" })).toBeDisabled();
  expect(screen.getByText("Conéctate para identificar una tarjeta de lealtad.")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("elimina el resultado anterior al editar el código y muestra un error sin exponer el detalle del servidor", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(404, { detail: "internal information" })); vi.stubGlobal("fetch", fetch);
  const onSelect = vi.fn();
  render(<MemberLookup identity={identity} online disabled={false} onSelect={onSelect} />);
  const input = openLookup(); fireEvent.click(screen.getByRole("button", { name: "Buscar tarjeta" }));
  await screen.findByRole("button", { name: "Usar cliente" });
  fireEvent.change(input, { target: { value: "another-code" } });
  expect(screen.queryByRole("button", { name: "Usar cliente" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Buscar tarjeta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No encontramos una tarjeta activa");
  expect(screen.queryByText("internal information")).not.toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
});

it("no asocia clientes inactivos o respuestas incompletas", async () => {
  const fetch = vi.fn().mockResolvedValue(response(200, { customer: { ...customer, is_active: false } })); vi.stubGlobal("fetch", fetch);
  const onSelect = vi.fn();
  render(<MemberLookup identity={identity} online disabled={false} onSelect={onSelect} />);
  openLookup(); fireEvent.click(screen.getByRole("button", { name: "Buscar tarjeta" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Esta tarjeta no está disponible"));
  expect(screen.queryByRole("button", { name: "Usar cliente" })).not.toBeInTheDocument(); expect(onSelect).not.toHaveBeenCalled();
});
