import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import type { InventoryVelocityItem, StockItem } from "@/inventory/types";
import type { RestockHorizon } from "@/inventory/restockPlan";
import { RestockPlan } from "./RestockPlan";

const telemetry = vi.hoisted(() => ({ trackAnalysisActionStarted: vi.fn() }));
vi.mock("@/telemetry/funnel", () => telemetry);
const text = copy.reportsView.restockPlan;
const stock: StockItem = {
  product_id: "p1", product_name: "Leche", sku: null, track_inventory: true,
  stock_on_hand: 10, reserved_quantity: 4, available_quantity: 6,
  low_stock_threshold: 3, is_low_stock: false,
};
const velocity: InventoryVelocityItem = {
  product_id: "p1", product_name: "Leche", stock_on_hand: 10,
  units_per_day_7d: "2.00", days_until_out: "5.0",
};

function renderPlan(props: Partial<Parameters<typeof RestockPlan>[0]> = {}) {
  const onRetry = vi.fn();
  function Harness() {
    const [horizon, setHorizon] = useState<RestockHorizon>(7);
    return <RestockPlan stock={[stock]} velocity={[velocity]}
      stockFailed={false} velocityFailed={false} onRetry={onRetry}
      horizon={horizon} onHorizonChange={setHorizon} {...props} />;
  }
  render(<MemoryRouter><Harness /></MemoryRouter>);
  return { onRetry };
}

beforeEach(() => telemetry.trackAnalysisActionStarted.mockClear());

describe("RestockPlan", () => {
  it("shows quantity and reservations first, with an accessible calculation disclosure", () => {
    renderPlan();
    expect(screen.getByText(text.suggested(8))).toBeInTheDocument();
    expect(screen.getByText(text.stock(10, 4, 6))).toBeInTheDocument();
    expect(screen.getByText(text.horizonLabel)).toBeInTheDocument();
    expect(screen.getByText(text.reminder)).toBeInTheDocument();
    expect(screen.queryByText(text.note)).not.toBeInTheDocument();
    const details = screen.getByRole("button", { name: text.details });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: text.details })).toHaveTextContent(text.basis("2", 7, 14, 6));
    expect(screen.getByText(text.window)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: text.openProduct("Leche") }))
      .toHaveAttribute("href", "/inventory?product=p1");
    expect(screen.getByText(text.note)).toBeInTheDocument();
  });

  it("recalculates with the owner's horizon rather than prescribing a weekly purchase", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "14 días" }));
    expect(screen.getByText(text.suggested(22))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 días" }));
    expect(screen.getByText(text.covered(3))).toBeInTheDocument();
    expect(screen.queryByText(text.suggested(8))).not.toBeInTheDocument();
  });

  it.each(["stockFailed", "velocityFailed"] as const)("shows an actionable failure for %s", (field) => {
    const { onRetry } = renderPlan({ [field]: true });
    expect(screen.getByText(text.unavailable)).toBeInTheDocument();
    expect(screen.queryByText(text.suggested(8))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: text.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not claim stock is covered when every product lacks history", () => {
    renderPlan({ velocity: [] });
    expect(screen.getByText(text.insufficient)).toBeInTheDocument();
    expect(screen.queryByText(text.covered(7))).not.toBeInTheDocument();
  });

  it("reviews low stock without inventing a purchase quantity when history is missing", () => {
    renderPlan({ stock: [{ ...stock, is_low_stock: true }], velocity: [] });
    expect(screen.getByText(text.review)).toBeInTheDocument();
    expect(screen.getByText(text.noEstimate)).toBeInTheDocument();
    expect(screen.queryByText(/Considera reponer/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: text.openProduct("Leche") }));
    expect(telemetry.trackAnalysisActionStarted).not.toHaveBeenCalled();
  });

  it("takes businesses without inventory to existing catalog setup", () => {
    renderPlan({ stock: [] });
    expect(screen.getByRole("link", { name: text.activate })).toHaveAttribute("href", "/catalog");
  });

  it("keeps product identities, quantities and money out of action telemetry", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("link", { name: text.openProduct("Leche") }));
    expect(telemetry.trackAnalysisActionStarted).toHaveBeenLastCalledWith({
      template_id: "R2", decision_area: "inventario", priority: "alta", surface: "plan",
    });
  });
});
