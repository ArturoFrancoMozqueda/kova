import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import ChannelsView from "./ChannelsView";

const session = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", role: session.role },
      tenantId: "tenant-1",
      sessionMode: "online",
    },
  }),
}));
vi.mock("@/branches/activeBranch", () => ({
  getActiveBranchId: () => "branch-1",
}));
const fetchMock = vi.fn<typeof fetch>();
const readiness = {
  status: "not_connected",
  send_enabled: false,
  webhook_enabled: false,
  tenant_mapping_verified: false,
  checklist: [
    {
      key: "number",
      title: "Verifica el número empresarial",
      description: "Revisa el alta del número en Meta.",
      status: "required",
    },
  ],
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const mount = () =>
  render(
    <MemoryRouter>
      <ChannelsView />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  session.role = "owner";
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => json(readiness));
});

it("shows provider setup from the backend without claiming an active connection", async () => {
  mount();
  expect(await screen.findByText("Sin conectar")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Verifica el número empresarial" }),
  ).toBeVisible();
  expect(
    screen.getByText(/No se envían ni reciben mensajes automáticos/),
  ).toBeVisible();
  expect(
    screen.getByText(/todavía no comprueba la configuración de tu cuenta ni guarda avances/),
  ).toBeVisible();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/messaging/readiness");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method !== "GET")).toBe(
    false,
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("consults the preparation requirements again without activating or changing a channel", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Volver a consultar requisitos" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toBe("/api/v1/messaging/readiness");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  }
  expect(screen.getByText("Sin conectar")).toBeVisible();
  expect(screen.queryByRole("button", { name: /activar|conectar/i })).not.toBeInTheDocument();
});

it("recovers a failed readiness check through an explicit retry", async () => {
  fetchMock.mockResolvedValueOnce(
    json({ detail: "No disponible por el momento" }, 503),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No disponible por el momento",
  );
  fireEvent.click(screen.getByRole("button", { name: "Consultar de nuevo" }));
  expect(await screen.findByText("Sin conectar")).toBeVisible();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});

it("does not request channel preparation for a cashier", () => {
  session.role = "cashier";
  mount();
  expect(screen.getByText("Acceso de administración")).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
