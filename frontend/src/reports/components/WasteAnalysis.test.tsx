import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeStory } from "../__fixtures__/story";
import { WasteAnalysis } from "./WasteAnalysis";

describe("WasteAnalysis", () => {
  it("shows exact typed waste and its reason", () => {
    render(
      <WasteAnalysis
        story={makeStory({
          waste: {
            units: 2,
            movement_count: 1,
            value: "16.00",
            known_value: "16.00",
            products_without_cost: 0,
            complete: true,
            by_reason: [
              { reason_code: "caducidad", units: 2, value: "16.00", products_without_cost: 0 },
            ],
          },
        })}
      />,
    );
    expect(screen.getAllByText("$16.00")).toHaveLength(2);
    expect(screen.getByText("Caducidad")).toBeInTheDocument();
  });

  it("does not present the known subtotal as a complete total", () => {
    render(
      <WasteAnalysis
        story={makeStory({
          waste: {
            units: 3,
            movement_count: 2,
            value: null,
            known_value: "16.00",
            products_without_cost: 1,
            complete: false,
            by_reason: [
              { reason_code: "daño", units: 3, value: null, products_without_cost: 1 },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText("No disponible")).toBeInTheDocument();
    expect(screen.getByText(/\$16\.00 con costo conocido/)).toBeInTheDocument();
  });
});

it("ranks waste reasons by valued loss with their units", () => {
  render(<WasteAnalysis story={makeStory({ waste: {
    units: 3, movement_count: 2, value: "36.00", known_value: "36.00", products_without_cost: 0, complete: true,
    by_reason: [
      { reason_code: "daño", units: 1, value: "12.00", products_without_cost: 0 },
      { reason_code: "caducidad", units: 2, value: "24.00", products_without_cost: 0 },
    ],
  } })} />);
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("Caducidad$24.002 unidades");
  expect(items[1]).toHaveTextContent("Daño$12.001 unidad");
});
