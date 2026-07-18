import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { makeStory } from "../__fixtures__/story";
import { OperatingExpenseAnalysis } from "./OperatingExpenseAnalysis";

describe("OperatingExpenseAnalysis", () => {
  it("subtracts only registered expenses from an exact gross profit", () => {
    render(
      <MemoryRouter>
        <OperatingExpenseAnalysis
          story={makeStory({
            operating_expenses: {
              total: "1250.00",
              expense_count: 2,
              approximate_operating_profit: "4750.00",
              margin_complete: true,
              by_category: [
                { category: "renta", amount: "1000.00", expense_count: 1 },
                { category: "servicios", amount: "250.00", expense_count: 1 },
              ],
            },
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("$4,750.00")).toBeInTheDocument();
    expect(screen.getByText("$1,250.00")).toBeInTheDocument();
    expect(screen.getByText("Renta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /administrar gastos/i })).toHaveAttribute(
      "href",
      "/expenses",
    );
  });

  it("does not estimate operating profit when product costs are incomplete", () => {
    render(
      <MemoryRouter>
        <OperatingExpenseAnalysis
          story={makeStory({
            operating_expenses: {
              total: "250.00",
              expense_count: 1,
              approximate_operating_profit: null,
              margin_complete: false,
              by_category: [
                { category: "servicios", amount: "250.00", expense_count: 1 },
              ],
            },
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("$4,750.00")).not.toBeInTheDocument();
    expect(screen.getByText(/Completa los costos/)).toBeInTheDocument();
    expect(screen.getAllByText("$250.00")).toHaveLength(2);
  });
});
