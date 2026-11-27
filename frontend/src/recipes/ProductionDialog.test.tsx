import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import { ProductionDialog } from "./ProductionDialog";

const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const recipe = {
  product_id: "concha", version: 2, effective_from: "2026-11-26T00:00:00Z", batch_yield: 24,
  cost: "36.00", known_cost: "36.00", ingredients_without_cost: 0, cost_per_piece: "1.50",
  lines: [
    { ingredient_product_id: "flour", ingredient_name: "Harina", stock_unit: "g", quantity: 1000, cost: "30.00" },
    { ingredient_product_id: "sugar", ingredient_name: "Azúcar", stock_unit: "g", quantity: 250, cost: "6.00" },
  ],
};

function mount(onRecorded = vi.fn()) {
  render(<MemoryRouter><ProductionDialog productId="concha" productName="Concha" onClose={vi.fn()} onRecorded={onRecorded} /></MemoryRouter>);
  return onRecorded;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ProductionDialog", () => {
  it("previews consumption, asks for a reason when pieces are missing and records the batch", async () => {
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? json({ id: "b1", actual_quantity: 45, unit_cost: "1.60" }, 201)
      : json(recipe));
    const onRecorded = mount();

    fireEvent.change(await screen.findByLabelText(copy.production.batches), { target: { value: "2" } });
    expect(screen.getByText("Harina: 2 kg")).toBeInTheDocument();
    expect(screen.getByLabelText(copy.production.actual)).toHaveValue(48);

    fireEvent.change(screen.getByLabelText(copy.production.actual), { target: { value: "45" } });
    const submit = screen.getByRole("button", { name: copy.production.submit });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(copy.production.reason(3)), { target: { value: "daño" } });
    fireEvent.click(submit);

    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      product_id: "concha", batches: 2, actual_quantity: 45, waste_reason_code: "daño", update_catalog_cost: true,
    });
    expect(new Headers(post[1]!.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("explains that a production recipe is needed first", async () => {
    fetchMock.mockResolvedValue(json({ ...recipe, batch_yield: null, lines: [], cost_per_piece: null, cost: null }));
    mount();
    expect(await screen.findByText(copy.production.noRecipe, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.production.submit })).toBeDisabled();
  });
});
