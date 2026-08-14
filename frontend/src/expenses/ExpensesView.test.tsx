import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";

const access = vi.hoisted(() => ({ featureEnabled: true }));

vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/auth/useFeature", () => ({ useFeature: () => access.featureEnabled }));
vi.mock("@/auth/permissions", () => ({
  EXPENSES_MANAGE_PERMISSION: "expenses.manage",
  usePermission: () => true,
}));
vi.mock("./api", () => ({
  listExpenses: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
}));

import { createExpense, listExpenses } from "./api";
import ExpensesView from "./ExpensesView";

function renderView() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ExpensesView />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  access.featureEnabled = true;
});

describe("ExpensesView", () => {
  it("explains the real feature gate instead of redirecting silently", () => {
    access.featureEnabled = false;
    renderView();

    expect(screen.getByRole("heading", { name: copy.expenses.unavailableTitle })).toBeVisible();
    expect(screen.getByText(copy.expenses.unavailableBody)).toBeVisible();
    expect(screen.getByRole("link", { name: copy.expenses.backToReports })).toHaveAttribute(
      "href",
      "/reports",
    );
    expect(listExpenses).not.toHaveBeenCalled();
  });
  it("shows exact period totals and real expense rows", async () => {
    (listExpenses as Mock).mockResolvedValue([
      {
        id: "expense-1",
        category: "servicios",
        amount: "425.50",
        expense_date: "2026-07-10",
        note: "Recibo de luz",
        created_by_user_id: "user-1",
        created_at: "2026-07-10T12:00:00Z",
        updated_at: "2026-07-10T12:00:00Z",
      },
    ]);
    renderView();
    expect(await screen.findAllByText("$425.50")).toHaveLength(2);
    expect(screen.getByText("Servicios")).toBeInTheDocument();
    expect(screen.getByText(/Recibo de luz/)).toBeInTheDocument();
  });

  it("creates an expense from the accessible mobile dialog", async () => {
    (listExpenses as Mock).mockResolvedValue([]);
    (createExpense as Mock).mockResolvedValue({});
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /registrar gasto/i }));
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "renta" } });
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "1000.00" } });
    fireEvent.change(screen.getByLabelText("Fecha del gasto"), { target: { value: "2026-07-10" } });
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Local" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar gasto/i }));
    await waitFor(() => expect(createExpense).toHaveBeenCalledWith({
      category: "renta",
      amount: "1000.00",
      expense_date: "2026-07-10",
      note: "Local",
    }));
  });
});
