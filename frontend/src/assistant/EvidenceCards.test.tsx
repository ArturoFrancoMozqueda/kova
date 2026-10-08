import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceCards } from "./EvidenceCards";

describe("inventory evidence", () => {
  it("shows the historical scope and registered ranking without labeling it today", () => {
    render(<EvidenceCards cards={[{ kind: "get_top_products", data: {
      all_history: true,
      products: [{ product_id: "p1", product_name: "Pan histórico", quantity_sold: 2,
        gross_sales: "24.00" }],
    } }]} />);
    expect(screen.getByText("Pan histórico")).toBeVisible();
    expect(screen.getByText("2 unidades")).toBeVisible();
    expect(screen.getByText("Unidades netas · Venta neta")).toBeVisible();
    expect(screen.getByText("Todo el histórico · Sucursal activa · Devoluciones descontadas")).toBeVisible();
    expect(screen.queryByText(/Sin fecha|No hay ventas/)).not.toBeInTheDocument();
  });

  it("labels the bounded product ranking using its refund-adjusted backend definition", () => {
    render(<EvidenceCards cards={[{ kind: "get_top_products", data: {
      start_date: "2026-10-01", end_date: "2026-10-08",
      products: [{ product_id: "p1", product_name: "Pan", quantity_sold: 2,
        gross_sales: "24.00" }],
    } }]} />);
    expect(screen.getByText("Unidades netas · Venta neta")).toBeVisible();
    expect(screen.queryByText(/Venta bruta/)).not.toBeInTheDocument();
    expect(screen.getByText("2 unidades")).toBeVisible();
  });

  it("shows real zero stock, an unknown forecast, missing costs and the sample size", () => {
    render(<EvidenceCards cards={[{ kind: "get_inventory", data: {
      restock_alerts: [{ product_id: "p1", product_name: "Concha", stock_on_hand: 0,
        low_stock_threshold: 5, days_until_out: null, severity: "warning" }],
      available_alert_count: 6,
      inventory_valuation: { complete: false, tracked_products: 6, products_without_cost: 2 },
    } }]} />);
    expect(screen.getByText("Concha")).toBeVisible();
    expect(screen.getByText(/Existencias:/)).toHaveTextContent("Existencias: 0 · Umbral: 5");
    expect(screen.getByText("Sin historial suficiente para estimar la duración.")).toBeVisible();
    expect(screen.getByText(/Faltan costos de 2 productos/)).toBeVisible();
    expect(screen.getByText("Mostrando 1 de 6 alertas disponibles en Análisis.")).toBeVisible();
  });

  it("labels a real forecast as an estimate", () => {
    render(<EvidenceCards cards={[{ kind: "get_inventory", data: {
      restock_alerts: [{ product_id: "p1", product_name: "Pan", stock_on_hand: 3,
        low_stock_threshold: 5, days_until_out: "1.5", severity: "critical" }],
    } }]} />);
    expect(screen.getByText("Pan")).toBeVisible();
    expect(screen.getByText("Atención prioritaria")).toBeVisible();
    expect(screen.getByText(/Duración estimada al ritmo registrado: 1.5 días/)).toBeVisible();
  });

  it.each([0, 4])("distinguishes missing inventory from no alerts for %i tracked products", tracked => {
    render(<EvidenceCards cards={[{ kind: "get_inventory", data: {
      restock_alerts: [],
      inventory_valuation: { complete: true, tracked_products: tracked, products_without_cost: 0 },
    } }]} />);
    expect(screen.getByText(tracked === 0
      ? "No hay productos con control de inventario. Actívalo en Catálogo para revisar existencias."
      : "No hay alertas de reposición con los datos registrados.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Revisar inventario/ })).toHaveAttribute("href", "/reports");
  });
});
