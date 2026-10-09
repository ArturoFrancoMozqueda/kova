import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LotForm, LotsPanel } from "./LotControls";
import { listLots, saveLot, suggestDates, type Lot, type LotWrite } from "./lots";

vi.mock("./lots", async original => ({
  ...await original<object>(),
  listLots: vi.fn(), saveLot: vi.fn(), suggestDates: vi.fn(),
}));

const first: Lot = {
  id: "lot-a", product_id: "product", code: "A", is_unknown: false,
  manufactured_on: "2026-10-01", rotation_on: "2026-10-05", expires_on: "2026-10-10",
  rotation_label: "consumo_preferente", stock_on_hand: 2, reserved_quantity: 0,
  available_quantity: 2, stock_conflict: false, date_status: "vigente",
};
const second: Lot = { ...first, id: "lot-b", code: "B", manufactured_on: "2026-10-02", expires_on: "2026-10-20" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listLots).mockResolvedValue([first, second]);
  vi.mocked(saveLot).mockResolvedValue(second);
});

describe("lot date editing", () => {
  it("loads the selected lot's own values when switching the correction form", async () => {
    render(<LotsPanel productId="product" canAdjust />);
    const details = screen.getByText("Lotes y fechas").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const buttons = await screen.findAllByRole("button", { name: "Corregir fechas" });
    fireEvent.click(buttons[0]);
    fireEvent.change(screen.getByLabelText("Identificador del lote"), { target: { value: "A corregido" } });
    fireEvent.click(buttons[1]);

    expect(screen.getByLabelText("Identificador del lote")).toHaveValue("B");
    expect(screen.getByLabelText("Caducidad")).toHaveValue("2026-10-20");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar fechas y guardar" }));
    expect(saveLot).toHaveBeenCalledWith("product", {
      code: "B", manufactured_on: second.manufactured_on,
      rotation_on: second.rotation_on, expires_on: second.expires_on,
    }, expect.any(String), second.id);
    await waitFor(() => expect(screen.queryByLabelText("Identificador del lote")).not.toBeInTheDocument());
  });

  it("preserves manually captured dates when a delayed suggestion arrives", async () => {
    let resolve!: (value: LotWrite) => void;
    vi.mocked(suggestDates).mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<LotForm productId="product" onCancel={vi.fn()} onSaved={vi.fn()} />);
    const form = screen.getByRole("group");
    fireEvent.change(within(form).getByLabelText("Elaboración"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(form).getByLabelText("Caducidad"), { target: { value: "2026-10-30" } });
    await act(async () => { resolve({ code: "", manufactured_on: "2026-10-01", rotation_on: "2026-10-05", expires_on: "2026-10-10" }); });
    expect(within(form).getByLabelText("Caducidad")).toHaveValue("2026-10-30");
  });
});
