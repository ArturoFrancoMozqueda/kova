import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { makeStory } from "../__fixtures__/story";
import { MarginAnalysis } from "./MarginAnalysis";

function renderMargin(complete: boolean) {
  return render(
    <MemoryRouter>
      <MarginAnalysis
        story={makeStory({
          margin: {
            summary: {
              net_sales: "100.00",
              cogs: complete ? "40.00" : null,
              gross_profit: complete ? "60.00" : null,
              gross_margin_pct: complete ? "60.00" : null,
              sold_products: 2,
              sold_products_without_cost: complete ? 0 : 1,
              complete,
            },
            by_day: [],
            by_product: [
              {
                product_id: "p1",
                product_name: "Concha",
                quantity_sold: 2,
                net_sales: "40.00",
                cogs: "16.00",
                gross_profit: "24.00",
                gross_margin_pct: "60.00",
                missing_cost: false,
              },
              {
                product_id: "p2",
                product_name: "Muffin",
                quantity_sold: 1,
                net_sales: "20.00",
                cogs: null,
                gross_profit: null,
                gross_margin_pct: null,
                missing_cost: true,
              },
            ],
          },
          inventory_valuation: {
            value: complete ? "320.00" : null,
            known_value: "320.00",
            tracked_products: 2,
            products_without_cost: complete ? 0 : 1,
            units_without_cost: complete ? 0 : 4,
            complete,
          },
        })}
      />
    </MemoryRouter>,
  );
}

describe("MarginAnalysis", () => {
  it("puts exact gross profit first when every sold product has a cost", () => {
    renderMargin(true);
    expect(screen.getByText("$60.00")).toBeInTheDocument();
    expect(screen.getByText("60.00% de margen bruto")).toBeInTheDocument();
    expect(screen.getByText("$320.00")).toBeInTheDocument();
  });

  it("refuses to estimate totals and links to catalog when a cost is missing", () => {
    renderMargin(false);
    expect(screen.getByText("Margen aún no disponible")).toBeInTheDocument();
    expect(screen.getByText(/Kova no estimará la utilidad/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /completar costos/i })).toHaveAttribute(
      "href",
      "/catalog",
    );
    expect(screen.getByText("Valuación incompleta")).toBeInTheDocument();
    expect(screen.getByText("Sin costo")).toBeInTheDocument();
  });
});
