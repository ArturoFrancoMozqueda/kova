import { fireEvent, render, screen } from "@testing-library/react";
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
    fireEvent.click(screen.getByText("Revisar los productos sin costo"));
    expect(screen.getByRole("link", { name: "Revisar costo de Muffin" })).toHaveAttribute("href", "/catalog?edit=p2");
    expect(screen.queryByRole("link", { name: "Revisar costo de Concha" })).not.toBeInTheDocument();
    expect(screen.getByText(/Las ventas anteriores conservan su costo histórico/)).toBeVisible();
  });
});

it("ranks product profit as bars with its margin and leaves products without cost unvalued", () => {
  renderMargin(true);
  const list = screen.getByRole("list", { name: "Utilidad por producto" });
  expect(list).toHaveTextContent("Concha$24.00Margen 60%");
  expect(list).toHaveTextContent("MuffinSin costo");
});

it("draws exact daily gross profit and never charts an incomplete day as zero", () => {
  render(
    <MemoryRouter>
      <MarginAnalysis story={makeStory({
        margin: {
          summary: { net_sales: "300.00", cogs: "120.00", gross_profit: "180.00", gross_margin_pct: "60.00", sold_products: 2, sold_products_without_cost: 0, complete: true },
          by_day: [
            { date: "2026-07-01", net_sales: "100.00", cogs: "40.00", gross_profit: "60.00", gross_margin_pct: "60.00", products_without_cost: 0, complete: true },
            { date: "2026-07-02", net_sales: "50.00", cogs: null, gross_profit: null, gross_margin_pct: null, products_without_cost: 1, complete: false },
            { date: "2026-07-03", net_sales: "200.00", cogs: "80.00", gross_profit: "120.00", gross_margin_pct: "60.00", products_without_cost: 0, complete: true },
          ],
          by_product: [],
        },
        inventory_valuation: { value: "10.00", known_value: "10.00", tracked_products: 1, products_without_cost: 0, units_without_cost: 0, complete: true },
      })} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("img", { name: "Utilidad bruta por día. Mejor día 03/07 con $120.00; 1 día sin costo completo." })).toBeInTheDocument();
  const trend = screen.getByTestId("margin-trend");
  expect(trend.querySelectorAll("rect[stroke-dasharray]")).toHaveLength(1);
  expect(screen.getByText("Las columnas punteadas son días con productos sin costo.")).toBeInTheDocument();
});
