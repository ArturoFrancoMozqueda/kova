import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogImportDialog } from "./CatalogImportDialog";
import type { CatalogImportResponse } from "./types";

const authIdentity = vi.hoisted(() => ({ tenantId: "tenant-1", user: { id: "user-1" } }));
vi.mock("../auth/useAuth", () => ({ useOptionalAuth: () => ({ state: { status: "authenticated", ...authIdentity } }) }));

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
    authIdentity.tenantId = "tenant-1";
    authIdentity.user.id = "user-1";
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
    await waitFor(() => expect(commitCatalogImport).toHaveBeenCalledWith(file, expect.any(String)));
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
    await waitFor(() => expect(commitCatalogImport).toHaveBeenCalledWith(currentFile, expect.any(String)));
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
    await waitFor(() => expect(commitCatalogImport).toHaveBeenCalledTimes(1));
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

  it("replays an import whose response was lost after closing and selecting identical bytes under a new filename", async () => {
    previewCatalogImport.mockResolvedValue(validPreview);
    const processed = new Set<string>();
    commitCatalogImport.mockImplementation(async (_file, key: string) => {
      if (!processed.has(key)) {
        processed.add(key);
        throw new TypeError("Response lost after commit");
      }
      return { ...validPreview, dry_run: false, created_products: 1 };
    });
    const props = { onClose: vi.fn(), onImported: vi.fn() };
    const { rerender } = render(<CatalogImportDialog open {...props} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["same bytes"], "original.csv")] } });
    await screen.findByText("Concha");
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await screen.findByRole("alert");
    rerender(<CatalogImportDialog open={false} {...props} />);
    rerender(<CatalogImportDialog open {...props} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["same bytes"], "renombrado.csv")] } });
    await screen.findByText("Concha");
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1));
    expect(processed.size).toBe(1);
    expect(commitCatalogImport.mock.calls[0][1]).toBe(commitCatalogImport.mock.calls[1][1]);

    // A confirmed import is finished; importing the same bytes deliberately is a new operation.
    rerender(<CatalogImportDialog open={false} {...props} />);
    rerender(<CatalogImportDialog open {...props} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["same bytes"], "otra.csv")] } });
    await screen.findByText("Concha");
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await screen.findByRole("alert");
    expect(commitCatalogImport.mock.calls[2][1]).not.toBe(commitCatalogImport.mock.calls[1][1]);
  });

  it.each(["content", "format", "tenant", "user"])("creates a new import key when %s changes", async (change) => {
    previewCatalogImport.mockResolvedValue(validPreview);
    commitCatalogImport.mockRejectedValue(new TypeError("Response lost"));
    const props = { onClose: vi.fn(), onImported: vi.fn() };
    const { rerender } = render(<CatalogImportDialog open {...props} />);
    const choose = async (content: string, name: string) => {
      fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File([content], name)] } });
      await screen.findByText("Concha");
      fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
      await screen.findByRole("alert");
    };
    await choose("data", "catalogo.csv");
    rerender(<CatalogImportDialog open={false} {...props} />);
    if (change === "tenant") authIdentity.tenantId = "tenant-2";
    if (change === "user") authIdentity.user.id = "user-2";
    rerender(<CatalogImportDialog open {...props} />);
    await choose(change === "content" ? "edited data" : "data", change === "format" ? "catalogo.xlsx" : "catalogo.csv");
    expect(commitCatalogImport.mock.calls[0][1]).not.toBe(commitCatalogImport.mock.calls[1][1]);
  });

  it("does not send an old session's file if identity changes during fingerprint calculation", async () => {
    previewCatalogImport.mockResolvedValue(validPreview);
    let finishDigest!: (value: ArrayBuffer) => void;
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise((resolve) => { finishDigest = resolve; }));
    const props = { onClose: vi.fn(), onImported: vi.fn() };
    const { rerender } = render(<CatalogImportDialog open {...props} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["data"], "catalogo.csv")] } });
    await screen.findByText("Concha");
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await waitFor(() => expect(digest).toHaveBeenCalledTimes(1));
    authIdentity.tenantId = "tenant-2";
    rerender(<CatalogImportDialog open {...props} />);
    await act(async () => { finishDigest(new ArrayBuffer(32)); });
    expect(commitCatalogImport).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeDisabled();
    expect(screen.queryByText("Concha")).not.toBeInTheDocument();
    digest.mockRestore();
  });

  it("recovers a committed import without a duplicate-SKU preview blocking its replay", async () => {
    const processed = new Set<string>();
    previewCatalogImport.mockImplementation(async () => processed.size === 0 ? validPreview : {
      ...validPreview,
      valid_rows: 0,
      error_rows: 1,
      rows: [{ ...validPreview.rows[0], status: "error", errors: ["El SKU CON-1 ya existe"] }],
    });
    commitCatalogImport.mockImplementation(async (_file, key: string) => {
      if (!processed.has(key)) {
        processed.add(key);
        throw new TypeError("Response lost after product and stock committed");
      }
      return { ...validPreview, dry_run: false, created_products: 1, initial_stock_movements: 1 };
    });
    const props = { onClose: vi.fn(), onImported: vi.fn() };
    const { rerender } = render(<CatalogImportDialog open {...props} />);
    const selectFile = () => fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), {
      target: { files: [new File(["nombre,sku,precio,stock_inicial\nConcha,CON-1,18,20"], "catalogo.csv")] },
    });
    selectFile();
    await screen.findByText("Concha");
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await screen.findByRole("alert");
    rerender(<CatalogImportDialog open={false} {...props} />);
    rerender(<CatalogImportDialog open {...props} />);
    selectFile();
    await screen.findByText("Concha");
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeEnabled();
    expect(previewCatalogImport).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Este archivo tiene una importación sin confirmar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await waitFor(() => expect(props.onImported).toHaveBeenCalledWith(expect.objectContaining({ created_products: 1, initial_stock_movements: 1 })));
    expect(processed.size).toBe(1);
    expect(commitCatalogImport.mock.calls[1][1]).toBe(commitCatalogImport.mock.calls[0][1]);
  });

  it("still previews and blocks another file with row errors after an ambiguous import", async () => {
    previewCatalogImport.mockResolvedValueOnce(validPreview).mockResolvedValueOnce({
      ...validPreview,
      valid_rows: 0,
      error_rows: 1,
      rows: [{ ...validPreview.rows[0], status: "error", errors: ["El SKU CON-1 ya existe"] }],
    });
    commitCatalogImport.mockRejectedValue(new TypeError("Response lost"));
    const props = { onClose: vi.fn(), onImported: vi.fn() };
    const { rerender } = render(<CatalogImportDialog open {...props} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["original"], "catalogo.csv")] } });
    await screen.findByText("Concha");
    fireEvent.click(screen.getByRole("button", { name: "Importar productos" }));
    await screen.findByRole("alert");
    rerender(<CatalogImportDialog open={false} {...props} />);
    rerender(<CatalogImportDialog open {...props} />);
    fireEvent.change(screen.getByLabelText("Elegir archivo CSV o Excel"), { target: { files: [new File(["edited"], "catalogo.csv")] } });
    await screen.findByText(/El SKU CON-1 ya existe/);
    expect(previewCatalogImport).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Importar productos" })).toBeDisabled();
    expect(screen.queryByText(/Este archivo tiene una importación sin confirmar/)).not.toBeInTheDocument();
    expect(commitCatalogImport).toHaveBeenCalledTimes(1);
  });
});
