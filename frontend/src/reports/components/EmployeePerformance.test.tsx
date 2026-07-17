import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeStory } from "../__fixtures__/story";
import type { SalesByEmployeeRow } from "../types";
import { EmployeePerformance } from "./EmployeePerformance";

const emp = (name: string, net: string): SalesByEmployeeRow => ({
  user_id: name,
  display_name: name,
  order_count: 10,
  net_sales: net,
  refund_count: 0,
});

describe("EmployeePerformance", () => {
  it("shows an empty state with no employees", () => {
    render(<EmployeePerformance story={makeStory({ sales_by_employee: [] })} />);
    expect(screen.getByText(/Sin ventas por empleado/i)).toBeInTheDocument();
  });

  it("shows a compact informative card for a single employee", () => {
    render(<EmployeePerformance story={makeStory({ sales_by_employee: [emp("Ana", "5000")] })} />);
    expect(screen.getByText(/Solo Ana cobró/i)).toBeInTheDocument();
  });

  it("answers who leads with exact share and keeps the caveat one tap away", () => {
    const story = makeStory({ sales_by_employee: [emp("Ana", "6000"), emp("Beto", "4000")] });
    render(<EmployeePerformance story={story} />);

    // "Respuesta primero": the leader with their exact share.
    expect(screen.getByText("Ana lidera con 60% de la venta")).toBeInTheDocument();

    // The sales!=performance caveat is disclosure-gated but never lost.
    expect(screen.queryByText(/no como calificación de desempeño/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nota metodológica/ }));
    expect(screen.getByText(/no como calificación de desempeño/i)).toBeInTheDocument();
  });
});
