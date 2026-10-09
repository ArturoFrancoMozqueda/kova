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
});
