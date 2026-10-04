import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [file] } });

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
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [file] } });

    expect(await screen.findByText(/precio debe ser un número válido/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeDisabled();
    expect(commitCatalogImport).not.toHaveBeenCalled();
  });

  it("accepts an xlsx workbook for the same preview flow", async () => {
    previewCatalogImport.mockResolvedValue(validPreview);
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    expect(screen.getByText(/acepta CSV UTF-8 o un libro .xlsx/i)).toBeVisible();
    const workbook = new File(["excel"], "catalogo.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), {
      target: { files: [workbook] },
    });

    await screen.findByText("Concha");
    expect(previewCatalogImport).toHaveBeenCalledWith(workbook);
  });

  it("rejects legacy or macro-enabled Excel files before calling the API", async () => {
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
    const workbook = new File(["excel"], "catalogo.xlsm", {
      type: "application/vnd.ms-excel.sheet.macroEnabled.12",
    });

    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), {
      target: { files: [workbook] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/no admite .xls, .xlsm/i);
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
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [file] } });

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
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/problema de nuestro lado/i);
    expect(screen.queryByText(/internal stack/i)).not.toBeInTheDocument();
  });

  it("resets the file input so the same corrected file can be selected again", async () => {
    previewCatalogImport.mockRejectedValueOnce(new Error("network failed"));
    previewCatalogImport.mockResolvedValueOnce(validPreview);
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
    const input = screen.getByLabelText("Elegir archivo CSV o Excel") as HTMLInputElement;
    const file = new File(["nombre,precio\nConcha,18\n"], "catalogo.csv", { type: "text/csv" });
    // Browsers fire change for the same filename only after the input resets.
    Object.defineProperty(input, "value", { configurable: true, writable: true, value: "C:\\fakepath\\catalogo.csv" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole("alert");
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("Concha");
    expect(previewCatalogImport).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"])("ignores a stale preview that %ss after closing and reopening", async (outcome) => {
    let resolveOld!: (value: CatalogImportResponse) => void;
    let rejectOld!: (cause: Error) => void;
    let resolveCurrent!: (value: CatalogImportResponse) => void;
    previewCatalogImport.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = reject;
    }));
    previewCatalogImport.mockImplementationOnce(() => new Promise((resolve) => { resolveCurrent = resolve; }));
    const props = { onClose: vi.fn(), onImported: vi.fn() };
    const { rerender } = render(<CatalogImportDialog open {...props} />);
    const oldFile = new File(["old"], "anterior.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [oldFile] } });
    rerender(<CatalogImportDialog open={false} {...props} />);
    rerender(<CatalogImportDialog open {...props} />);
    const currentFile = new File(["current"], "actual.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [currentFile] } });

    await act(async () => {
      if (outcome === "resolve") resolveOld(validPreview);
      else rejectOld(new Error("stale failure"));
    });
    expect(screen.queryByText("Concha")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Elegir archivo CSV o Excel")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeDisabled();
    await act(async () => { resolveCurrent(validPreview); });
    expect(screen.getByText("Concha")).toBeInTheDocument();
    commitCatalogImport.mockResolvedValue({ ...validPreview, dry_run: false });
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await waitFor(() => expect(commitCatalogImport).toHaveBeenCalledWith(currentFile));
  });

  it("rejects an empty preview instead of confirming a zero-product import", async () => {
    previewCatalogImport.mockResolvedValue({ ...validPreview, total_rows: 0, valid_rows: 0, rows: [] });
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["nombre,precio"], "vacio.csv")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("no contiene productos");
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeDisabled();
    expect(commitCatalogImport).not.toHaveBeenCalled();
  });

  it("commits once when confirmation is clicked twice before the next render", async () => {
    previewCatalogImport.mockResolvedValue(validPreview);
    let finish!: (value: CatalogImportResponse) => void;
    commitCatalogImport.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const onImported = vi.fn();
    const onClose = vi.fn();
    render(<CatalogImportDialog open onClose={onClose} onImported={onImported} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["data"], "catalogo.csv")] } });
    await screen.findByText("Concha");
    const button = screen.getByRole("button", { name: "Importar productos" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(commitCatalogImport).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish({ ...validPreview, dry_run: false }); });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it("does not recommit a successful import when the catalog refresh fails", async () => {
    previewCatalogImport.mockResolvedValue(validPreview);
    commitCatalogImport.mockResolvedValue({ ...validPreview, dry_run: false });
    render(<CatalogImportDialog open onClose={vi.fn()} onImported={vi.fn(async () => { throw new Error("refresh failed"); })} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["data"], "catalogo.csv")] } });
    await screen.findByText("Concha");
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Los productos se importaron");
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeDisabled();
    expect(commitCatalogImport).toHaveBeenCalledTimes(1);
  });
});
