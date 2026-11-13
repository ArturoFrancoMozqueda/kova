import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrmStageFunnel } from "./CrmStageFunnel";
import type { Opportunity } from "./types";

const opportunity = (id: string, stage: Opportunity["stage"], amount: string): Opportunity => ({
  id,
  customer_id: "customer-1",
  customer_name: "Ana López",
  title: `Pedido ${id}`,
  stage,
  estimated_amount: amount,
  assigned_user_id: null,
  next_action: null,
  due_at: null,
  note: null,
  version: 1,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
});

describe("CrmStageFunnel", () => {
  it("counts and sums the loaded opportunities per stage in pipeline order", () => {
    render(
      <CrmStageFunnel
        hasMore={false}
        opportunities={[
          opportunity("1", "new", "100.10"),
          opportunity("2", "new", "200.20"),
          opportunity("3", "won", "1500.00"),
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Oportunidades por etapa" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Nueva2 · $300.30",
      "En contacto0 · $0.00",
      "Propuesta0 · $0.00",
      "Ganada1 · $1,500.00",
      "Perdida0 · $0.00",
    ]);
    expect(screen.queryByText(/en esta página/)).not.toBeInTheDocument();
  });

  it("labels the totals as this page when the API has more opportunities", () => {
    render(<CrmStageFunnel hasMore opportunities={[opportunity("1", "proposal", "50")]} />);
    expect(screen.getByRole("list", { name: "Oportunidades por etapa en esta página" })).toBeVisible();
    expect(screen.getByText("Cantidad y monto estimado en esta página")).toBeVisible();
  });
});
