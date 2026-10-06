import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationContents } from "./IntegrationsPage";
import { getReadiness, listInvoiceRequests } from "./api";
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
