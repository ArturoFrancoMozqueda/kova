import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import ReservationNoticesPanel from "./ReservationNoticesPanel";

const mocks = vi.hoisted(() => ({ request: vi.fn(), online: true }));
vi.mock("@/automations/workspace", () => ({
  useOperationsRequest: () => mocks.request,
  useOnline: () => mocks.online,
}));
const identity = { tenantId: "tenant-a", userId: "owner-a", branchId: "branch-a" };
const item = {
  id: "notice-private-id", source: "reservation", source_id: "table-private-id",
  kind: "reminder", recipient_name: "Ana García", body: "Hola Ana. Te recordamos tu reserva para el 30/11/2026 a las 10:00.",
  starts_at: "2026-11-30T16:00:00Z", due_at: "2026-11-29T16:00:00Z", timezone: "America/Mexico_City",
  status: "scheduled", contact_status: "customer_required",
};
const response = { items: [item], has_more: false, send_enabled: false };
const mount = () => render(<MemoryRouter><ReservationNoticesPanel identity={identity} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks(); mocks.online = true; mocks.request.mockResolvedValue(response);
});

it("shows the real preview and exact reservation link without send controls or internal IDs", async () => {
  mount();
  expect(await screen.findByText(item.body)).toBeVisible();
  expect(screen.getByText("Envíos desactivados")).toBeVisible();
  expect(screen.getByText(/no se ha enviado ningún aviso/)).toBeVisible();
  expect(screen.getByText(/Falta vincular al cliente/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Revisar esta reserva" })).toHaveAttribute("href", "/appointments?tableId=table-private-id");
  expect(screen.queryByText(/notice-private-id|table-private-id/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /enviar|activar/i })).not.toBeInTheDocument();
  expect(mocks.request).toHaveBeenCalledWith("?limit=20&offset=0");
});

it("keeps failed loading separate from an empty list and recovers through retry", async () => {
  mocks.request.mockRejectedValueOnce(new Error("private postgres debug"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar los avisos");
  expect(screen.queryByText(/Sin avisos|postgres/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Consultar avisos de nuevo" }));
  expect(await screen.findByText(item.body)).toBeVisible();
});

it("clears stale previews offline and refreshes after reconnecting", async () => {
  const view = mount();
  await screen.findByText(item.body);
  mocks.online = false;
  view.rerender(<MemoryRouter><ReservationNoticesPanel identity={identity} /></MemoryRouter>);
  expect(screen.getByRole("status")).toHaveTextContent("Conéctate a internet");
  expect(screen.queryByText(item.body)).not.toBeInTheDocument();
  mocks.online = true;
  mocks.request.mockResolvedValueOnce({ ...response, items: [] });
  view.rerender(<MemoryRouter><ReservationNoticesPanel identity={identity} /></MemoryRouter>);
  expect(await screen.findByText("Sin avisos en esta página")).toBeVisible();
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

it("paginates without treating a page as all business notices", async () => {
  mocks.request.mockResolvedValueOnce({ ...response, has_more: true });
  mocks.request.mockResolvedValueOnce({ ...response, items: [] });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Más avisos" }));
  expect(await screen.findByText("Sin avisos en esta página")).toBeVisible();
  expect(mocks.request).toHaveBeenLastCalledWith("?limit=20&offset=20");
  fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
  await waitFor(() => expect(mocks.request).toHaveBeenLastCalledWith("?limit=20&offset=0"));
});

it("ignores a response arriving after the panel is closed", async () => {
  let finish!: (value: typeof response) => void;
  mocks.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = mount();
  view.unmount();
  await act(async () => finish(response));
  expect(screen.queryByText(item.body)).not.toBeInTheDocument();
});


it("keeps owner activation disabled while the platform gate is off", async () => {
  mocks.request.mockResolvedValueOnce({ ...response, sending_settings: {
    platform_available: false, enabled: false, version: 0, daily_limit: 10, can_manage: true,
  } });
  mount();
  const button = await screen.findByRole("button", { name: "Activar avisos automáticos" });
  expect(button).toBeDisabled();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByText(/activación está bloqueada/)).toBeVisible();
  fireEvent.click(button);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("requires owner cost consent, saves the scoped policy and refreshes the real status", async () => {
  const sending_settings = { platform_available: true, enabled: false, version: 0, daily_limit: 10, can_manage: true };
  mocks.request.mockResolvedValueOnce({ ...response, sending_settings });
  mocks.request.mockResolvedValueOnce({ ...sending_settings, enabled: true, version: 1 });
  mocks.request.mockResolvedValueOnce({ ...response, send_enabled: true, sending_settings: { ...sending_settings, enabled: true, version: 1 } });
  mount();
  const button = await screen.findByRole("button", { name: "Activar avisos automáticos" });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  expect(await screen.findByText("Avisos automáticos activados")).toBeVisible();
  expect(mocks.request).toHaveBeenCalledWith("/settings", "PUT", {
    expected_version: 0, enabled: true, daily_limit: 10, accept_costs: true,
  });
  expect(screen.getByRole("button", { name: "Desactivar avisos automáticos" })).toBeEnabled();
});
