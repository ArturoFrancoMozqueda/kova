import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { copy } from "@/i18n/messages";

vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("./api", () => ({ listOrders: vi.fn() }));

import { listOrders } from "./api";
import OrderListView from "./OrderListView";

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrderListView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OrderListView", () => {
  beforeEach(() => {
    vi.mocked(listOrders).mockReset();
    vi.mocked(listOrders).mockResolvedValue({
      items: [
        {
          id: "order-1",
          status: "completed",
          subtotal_amount: "100.00",
          total_amount: "100.00",
          created_at: "2026-08-13T18:00:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });

  it("uses es-MX singular and plural for 0, 1 and multiple sales", () => {
    expect(copy.orderList.total(0)).toBe("0 ventas");
    expect(copy.orderList.total(1)).toBe("1 venta");
    expect(copy.orderList.total(2)).toBe("2 ventas");
  });

  it("labels and constrains the date range and pluralizes the result count", async () => {
    const { container } = renderView();

    expect(await screen.findByText(copy.orderList.total(1))).toBeVisible();
    const from = screen.getByLabelText(copy.orderList.filterStartDate);
    const to = screen.getByLabelText(copy.orderList.filterEndDate);
    expect(from).toHaveAttribute("id", "orders-start-date");
    expect(to).toHaveAttribute("id", "orders-end-date");
    expect(from).toHaveAttribute("max", (to as HTMLInputElement).value);
    expect(to).toHaveAttribute("min", (from as HTMLInputElement).value);
    expect((await axe(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });

  it("names the rolling presets by their actual seven and thirty day spans", async () => {
    renderView();
    await screen.findByText(copy.orderList.total(1));
    for (const [label, days] of [["7 días", 7], ["30 días", 30]] as const) {
      fireEvent.click(await screen.findByRole("button", { name: label }));
      await waitFor(() => {
        const filters = vi.mocked(listOrders).mock.calls.at(-1)?.[0];
        const start = new Date(`${filters!.startDate}T12:00:00Z`);
        const end = new Date(`${filters!.endDate}T12:00:00Z`);
        expect((end.getTime() - start.getTime()) / 86_400_000 + 1).toBe(days);
      });
    }
    expect(screen.queryByRole("button", { name: "Mes" })).not.toBeInTheDocument();
  });

  it("pages through all sales and resets pagination for server-side sorting and filters", async () => {
    const orders = Array.from({ length: 60 }, (_, index) => ({
      id: `order-${index}`, status: "completed", subtotal_amount: `${60 - index}.00`,
      total_amount: `${60 - index}.00`, created_at: new Date(2026, 0, index + 1).toISOString(),
    }));
    vi.mocked(listOrders).mockImplementation(async filters => {
      const ordered = [...orders].sort((a, b) => filters?.sort === "amount_desc"
        ? Number(b.total_amount) - Number(a.total_amount)
        : Date.parse(b.created_at) - Date.parse(a.created_at));
      const offset = filters?.offset ?? 0;
      return { items: ordered.slice(offset, offset + 50), total: 60, limit: 50, offset };
    });
    renderView();
    await screen.findByText("1–50 de 60 ventas");
    expect(screen.getByRole("button", { name: "Anteriores" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Siguientes" }));
    await screen.findByText("51–60 de 60 ventas");
    expect(screen.getByRole("navigation", { name: "Páginas de ventas" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Siguientes" })).toBeDisabled();
    expect(vi.mocked(listOrders).mock.calls.at(-1)?.[0]).toMatchObject({ offset: 50, limit: 50 });

    fireEvent.change(screen.getByLabelText(copy.orderList.sortLabel), { target: { value: "amount_desc" } });
    await screen.findByText("1–50 de 60 ventas");
    expect(vi.mocked(listOrders).mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0, sort: "amount_desc" });
    expect(screen.getAllByRole("row")[1].querySelector("a")).toHaveAttribute("href", "/orders/order-0");

    fireEvent.click(screen.getByRole("button", { name: "Siguientes" }));
    await screen.findByText("51–60 de 60 ventas");
    fireEvent.click(screen.getByRole("button", { name: "Canceladas" }));
    await screen.findByText("1–50 de 60 ventas");
    expect(vi.mocked(listOrders).mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0, status: "voided" });
  });
});
