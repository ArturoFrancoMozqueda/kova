import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogImportDialog } from "./CatalogImportDialog";
import type { CatalogImportResponse } from "./types";

const previewCatalogImport = vi.fn();
const commitCatalogImport = vi.fn();

vi.mock("./api", () => ({
  previewCatalogImport: (...args: unknown[]) => previewCatalogImport(...args),
  commitCatalogImport: (...args: unknown[]) => commitCatalogImport(...args),
  catalogImportTemplateUrl: "/api/v1/catalog/import/template",
}));

const validPreview: CatalogImportResponse = {
  dry_run: true,
  total_rows: 1,
  valid_rows: 1,
  error_rows: 0,
  rows: [{
    row_number: 2,
    status: "valid",
    normalized: {
      name: "Concha",
      sku: "CON-1",
      price_amount: "18.00",
      cost_price: "8.00",
      category_name: "Pan dulce",
      track_inventory: true,
      initial_stock: 20,
      low_stock_threshold: 5,
    },
    errors: [],
  }],
  created_products: 0,
  created_categories: 0,
  initial_stock_movements: 0,
};

describe("CatalogImportDialog", () => {
  beforeEach(() => {
    previewCatalogImport.mockReset();
    commitCatalogImport.mockReset();
  });

  it("previews the CSV and commits only after explicit confirmation", async () => {
    previewCatalogImport.mockResolvedValue(validPreview);
    commitCatalogImport.mockResolvedValue({
      ...validPreview,
      dry_run: false,
      created_products: 1,
      created_categories: 1,
      initial_stock_movements: 1,
    });
    const onImported = vi.fn();
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={onImported} />);

    const file = new File(["nombre,precio\nConcha,18\n"], "catalogo.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV"), { target: { files: [file] } });

    await screen.findByText("Concha");
    expect(previewCatalogImport).toHaveBeenCalledWith(file);
    expect(commitCatalogImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await waitFor(() => expect(commitCatalogImport).toHaveBeenCalledWith(file));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ created_products: 1 }));
  });

  it("shows row errors and blocks confirmation", async () => {
    previewCatalogImport.mockResolvedValue({
      ...validPreview,
      valid_rows: 0,
      error_rows: 1,
      rows: [{ ...validPreview.rows[0], status: "error", errors: ["precio debe ser un número válido"] }],
    });
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    const file = new File(["nombre,precio\nConcha,error\n"], "errores.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV"), { target: { files: [file] } });

    expect(await screen.findByText(/precio debe ser un número válido/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeDisabled();
    expect(commitCatalogImport).not.toHaveBeenCalled();
  });

  it("explains how to convert Excel and rejects an xlsx before calling the API", async () => {
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    expect(screen.getByText(/elige CSV UTF-8/i)).toBeVisible();
    const workbook = new File(["excel"], "catalogo.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV"), {
      target: { files: [workbook] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/CSV UTF-8/i);
    expect(previewCatalogImport).not.toHaveBeenCalled();
  });

  it("shows the backend validation detail so the owner can fix the file", async () => {
    previewCatalogImport.mockRejectedValue(
      Object.assign(new Error(JSON.stringify({ detail: "Encabezados inválidos; falta precio" })), {
        status: 400,
      }),
    );
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    const file = new File(["nombre\nConcha\n"], "catalogo.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Encabezados inválidos; falta precio",
    );
  });

  it("does not expose a server error body", async () => {
    previewCatalogImport.mockRejectedValue(
      Object.assign(new Error(JSON.stringify({ detail: "internal stack and database name" })), {
        status: 503,
      }),
    );
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    const file = new File(["nombre,precio\nConcha,18\n"], "catalogo.csv", {
      type: "text/csv",
    });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/problema de nuestro lado/i);
    expect(screen.queryByText(/internal stack/i)).not.toBeInTheDocument();
  });
});
