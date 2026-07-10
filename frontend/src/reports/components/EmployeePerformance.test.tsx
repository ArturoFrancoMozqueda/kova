import { render, screen } from "@testing-library/react";
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

  it("shows the sales!=performance caveat when comparing multiple employees", () => {
    const story = makeStory({ sales_by_employee: [emp("Ana", "6000"), emp("Beto", "4000")] });
    render(<EmployeePerformance story={story} />);
    expect(screen.getByText(/no como calificación de desempeño/i)).toBeInTheDocument();
  });
});
