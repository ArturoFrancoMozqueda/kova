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
    screen.getByText(/los pasos de abajo son una guía general y no guardan avances/),
  ).toBeVisible();
  expect(screen.getByText(/El equipo de Kova te ayuda a verificar tu número/)).toBeVisible();
  expect(screen.queryByText(/Cloud API|dominio/)).not.toBeInTheDocument();
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
    json({ detail: "backend postgres connection failed" }, 503),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No pudimos consultar WhatsApp. Revisa tu conexión e intenta de nuevo.",
  );
  expect(screen.queryByText(/backend|postgres/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Consultar de nuevo" }));
  expect(await screen.findByText("Sin conectar")).toBeVisible();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});

it.each(["malformed JSON", "technical network error"])("shows human feedback for a %s without changing channel capabilities", async failure => {
  fetchMock.mockImplementationOnce(async () => {
    if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
    throw new Error("Failed to fetch: backend postgres connection failed");
  });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar WhatsApp. Revisa tu conexión e intenta de nuevo.");
  expect(screen.queryByText(/Unexpected token|Failed to fetch|postgres|proxy error/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Consultar de nuevo" }));
  expect(await screen.findByText("Sin conectar")).toBeVisible();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});

it.each([
  [401, "No tienes acceso a la configuración de WhatsApp. Consulta al dueño del negocio."],
  [403, "No tienes acceso a la configuración de WhatsApp. Consulta al dueño del negocio."],
  [429, "Espera un momento antes de volver a consultar WhatsApp."],
] as const)("keeps actionable HTTP %i guidance without showing server details", async (status, message) => {
  fetchMock.mockResolvedValueOnce(json({ detail: "internal debug information" }, status));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText("internal debug information")).not.toBeInTheDocument();
});

it("does not request channel preparation for a cashier", () => {
  session.role = "cashier";
  mount();
  expect(screen.getByText("Acceso de administración")).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows the branch connection and distinguishes enabled replies from delivery evidence", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...readiness, status: "connected", send_enabled: true, webhook_enabled: true, tenant_mapping_verified: true }));
  mount();
  expect(await screen.findByText("Conexión configurada")).toBeVisible();
  expect(screen.getByText(/La entrega de cada mensaje se confirma por separado/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Abrir bandeja de atención" })).toHaveAttribute("href", "/inbox");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("shows paused sends even when inbound connection is configured", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...readiness, status: "connected", webhook_enabled: true, tenant_mapping_verified: true }));
  mount();
  expect(await screen.findByText(/Los envíos están pausados/)).toBeVisible();
});

it("clears a formerly connected status when rechecking fails", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...readiness, status: "connected", send_enabled: true }));
  fetchMock.mockResolvedValueOnce(json({ detail: "No disponible" }, 503));
  mount();
  expect(await screen.findByText("Conexión configurada")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Volver a consultar requisitos" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Conexión configurada")).not.toBeInTheDocument();
});
