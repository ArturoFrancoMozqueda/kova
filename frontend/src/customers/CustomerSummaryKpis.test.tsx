import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerSummaryKpis } from "./CustomerSummaryKpis";
import { customerSummary } from "./api";

vi.mock("./api", () => ({ customerSummary: vi.fn() }));

const id = "11111111-1111-4111-8111-111111111111";

describe("CustomerSummaryKpis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("muestra las cifras que calcula el servidor", async () => {
    vi.mocked(customerSummary).mockResolvedValue({
      customer_id: id, branch_id: "branch-1", purchase_count: 2,
      net_spent_amount: "125.50", average_ticket_amount: "62.75", last_purchase_at: "2026-02-07T18:00:00Z",
    });
    render(<CustomerSummaryKpis customerId={id} />);
    expect(await screen.findByText("$125.50")).toBeInTheDocument();
    expect(screen.getByText("$62.75")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/feb 2026/i)).toBeInTheDocument();
    expect(customerSummary).toHaveBeenCalledWith(id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("un cliente sin compras muestra ceros, no un error", async () => {
    vi.mocked(customerSummary).mockResolvedValue({
      customer_id: id, branch_id: "branch-1", purchase_count: 0,
      net_spent_amount: "0.00", average_ticket_amount: null, last_purchase_at: null,
    });
    render(<CustomerSummaryKpis customerId={id} />);
    expect(await screen.findByText("Sin compras")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("la carga y el error no se presentan como cero", async () => {
    vi.mocked(customerSummary).mockRejectedValueOnce(new Error("SELECT interno"));
    render(<CustomerSummaryKpis customerId={id} />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando resumen");
    expect(await screen.findByRole("alert")).not.toHaveTextContent("SELECT");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    vi.mocked(customerSummary).mockResolvedValueOnce({
      customer_id: id, branch_id: "branch-1", purchase_count: 1,
      net_spent_amount: "10.00", average_ticket_amount: "10.00", last_purchase_at: "2026-02-07T18:00:00Z",
    });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar resumen" }));
    expect(await screen.findByText("Compras")).toBeInTheDocument();
  });
});
