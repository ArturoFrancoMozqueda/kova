import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationContents, IntegrationsPage } from "./IntegrationsPage";
import { createInvoiceRequest, getReadiness, listInvoiceRequests } from "./api";
import { listOrders } from "@/orders/api";
// Keep request-creation tests isolated; CFDI provider lifecycle has its own suite.
vi.mock("./CfdiPanel", () => ({ CfdiPanel: () => null }));
const auth = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/auth/AuthContext", () => ({
  useAuthContext: () => ({
    state: { status: "authenticated", user: { role: auth.role } },
  }),
}));
vi.mock("@/orders/api", () => ({
  listOrders: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("./api", () => ({
  getReadiness: vi.fn(),
  listInvoiceRequests: vi.fn(),
  saveIssuer: vi.fn(),
  createInvoiceRequest: vi.fn(),
}));
describe("IntegrationsPage", () => {
  beforeEach(() => {
    vi.mocked(getReadiness).mockResolvedValue({
      cfdi_status: "not_connected",
      terminal_status: "not_connected",
      can_issue_cfdi: false,
      can_charge_terminal: false,
      issuer: null,
      validation_scope: "format_only",
    });
    vi.mocked(listInvoiceRequests).mockResolvedValue([]);
    vi.clearAllMocks();
    auth.role = "owner";
    vi.mocked(listOrders).mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    });
    vi.mocked(createInvoiceRequest).mockReset();
  });
  it("explains pending provider and keeps requests private for viewers", async () => {
    render(<IntegrationContents />);
    await waitFor(() =>
      expect(
        screen.queryByText("Cargando datos fiscales…"),
      ).not.toBeInTheDocument(),
    );
    expect(listInvoiceRequests).not.toHaveBeenCalled();
    expect(screen.getByText(/No generan un CFDI/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar solicitud pendiente" }),
    ).not.toBeInTheDocument();
  });
  it("shows actual Live readiness to a manager without loading customer requests", async () => {
    auth.role = "manager";
    vi.mocked(getReadiness).mockResolvedValue({
      cfdi_status: "live_ready",
      terminal_status: "not_connected",
      can_issue_cfdi: true,
      can_charge_terminal: false,
      issuer: null,
      validation_scope: "format_only",
    });
    render(<IntegrationsPage />);
    expect(
      await screen.findByRole("heading", {
        name: "Facturación CFDI · Conectada en Live",
      }),
    ).toBeInTheDocument();
    expect(listInvoiceRequests).not.toHaveBeenCalled();
    expect(listOrders).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Guardar conexión" }),
    ).not.toBeInTheDocument();
  });
  it("requires issuer preparation before a manager can submit a request", async () => {
    render(<IntegrationContents canManage />);
    const button = await screen.findByRole("button", {
      name: "Guardar solicitud pendiente",
    });
    expect(button).toBeDisabled();
    expect(screen.getByText(/No se consulta ni valida/)).toBeInTheDocument();
    expect(listInvoiceRequests).toHaveBeenCalledOnce();
  });
});

const identity = {
  rfc: "EKU9003173C9",
  legal_name: "Mi negocio",
  postal_code: "06000",
  tax_regime: "601",
};
const sale = {
  id: "00112233-4455-6677-8899-aabbccddeeff",
  created_at: "2026-10-05T18:30:00Z",
  status: "completed",
  total_amount: "100.00",
  subtotal_amount: "100.00",
};
async function prepareRequest() {
  vi.mocked(getReadiness).mockResolvedValue({
    cfdi_status: "not_connected",
    terminal_status: "not_connected",
    can_issue_cfdi: false,
    can_charge_terminal: false,
    issuer: identity,
    validation_scope: "format_only",
  });
  vi.mocked(listOrders).mockResolvedValue({
    items: [sale],
    total: 1,
    limit: 100,
    offset: 0,
  });
  render(<IntegrationsPage />);
  const selector = await screen.findByRole("combobox", {
    name: "Venta completada",
  });
  expect(
    screen.getByRole("option", { name: /Folio 00112233/ }),
  ).toHaveTextContent("$100.00");
  expect(screen.queryByLabelText(/ID de la venta/)).not.toBeInTheDocument();
  fireEvent.change(selector, { target: { value: sale.id } });
  const section = screen
    .getByRole("heading", { name: "Registrar solicitud de factura" })
    .closest("section")!;
  const fields = within(section);
  for (const [label, value] of [
    ["RFC", identity.rfc],
    ["Nombre o razón social", "Cliente real"],
    ["Código postal fiscal", "06000"],
    ["Clave de régimen fiscal", "601"],
    ["Clave de uso CFDI", "G03"],
    ["Correo del cliente", "cliente@example.com"],
  ]) {
    fireEvent.change(fields.getByLabelText(label), { target: { value } });
  }
  return {
    selector,
    button: fields.getByRole("button", { name: "Guardar solicitud pendiente" }),
  };
}

describe("invoice request user flow", () => {
  it("denies unauthorized roles before reading any fiscal data", () => {
    vi.clearAllMocks();
    auth.role = "cashier";
    render(<IntegrationsPage />);
    expect(screen.getByText(/No tienes permiso/)).toBeInTheDocument();
    expect(getReadiness).not.toHaveBeenCalled();
    expect(listInvoiceRequests).not.toHaveBeenCalled();
    auth.role = "owner";
  });
  it("retries uncertain network outcome with the same operation and shows the confirmed pending request", async () => {
    vi.clearAllMocks();
    auth.role = "owner";
    vi.mocked(listInvoiceRequests).mockResolvedValue([]);
    vi.mocked(createInvoiceRequest)
      .mockRejectedValueOnce(new Error("No se pudo conectar"))
      .mockResolvedValueOnce({
        id: "request-1",
        order_id: sale.id,
        recipient_snapshot: {
          ...identity,
          legal_name: "Cliente real",
          cfdi_use: "G03",
          email: "cliente@example.com",
        },
        total_amount: "100.00",
        status: "pending_provider",
        fiscal_status: "not_issued",
        created_at: sale.created_at,
      });
    const { selector, button } = await prepareRequest();
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar",
    );
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "La factura no se ha emitido",
    );
    const calls = vi.mocked(createInvoiceRequest).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0][0]).toBe(sale.id);
    expect(selector).toHaveValue("");
    expect(screen.getByText("Cliente real")).toBeInTheDocument();
    expect(listInvoiceRequests).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
