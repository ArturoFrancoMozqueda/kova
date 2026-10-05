import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BranchComparison } from "./BranchComparison";
import { compareBranches, type BranchComparison as Report } from "./api";

const identity = vi.hoisted(() => ({ tenantId: "tenant-a", userId: "user-a" }));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      tenantId: identity.tenantId,
      user: { id: identity.userId },
    },
  }),
}));
vi.mock("./api", () => ({ compareBranches: vi.fn() }));

function report(): Report {
  return {
    start_date: "2026-10-01",
    end_date: "2026-10-04",
    timezone: "America/Mexico_City",
    total_net_sales: "900.00",
    leader_branch_ids: ["centro"],
    branches: [
      {
        branch_id: "centro",
        branch_name: "Centro",
        completed_orders: 10,
        gross_sales: "800.00",
        refunded_amount: "100.00",
        net_sales: "700.00",
        average_ticket: "70.00",
        share_pct: "77.78",
        products: [
          {
            product_id: "pan",
            product_name: "Pan dulce",
            net_quantity: 35,
            net_sales: "700.00",
          },
        ],
      },
      {
        branch_id: "norte",
        branch_name: "Norte",
        completed_orders: 4,
        gross_sales: "200.00",
        refunded_amount: "0.00",
        net_sales: "200.00",
        average_ticket: "50.00",
        share_pct: "22.22",
        products: [],
      },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  identity.tenantId = "tenant-a";
});

it("answers which branch sells more and shows its net products for the selected dates", async () => {
  vi.mocked(compareBranches).mockResolvedValue(report());
  render(<BranchComparison startDate="2026-10-01" endDate="2026-10-04" />);
  expect(
    await screen.findByText("Centro tiene las mayores ventas netas."),
  ).toBeVisible();
  expect(screen.getByText("35 unidades netas")).toBeVisible();
  expect(screen.getByText("Pan dulce")).toBeVisible();
  expect(compareBranches).toHaveBeenCalledWith("2026-10-01", "2026-10-04");
});

it("shows ties explicitly and never invents a winner without sales", async () => {
  const equal = report();
  equal.leader_branch_ids = ["centro", "norte"];
  vi.mocked(compareBranches).mockResolvedValue(equal);
  const view = render(
    <BranchComparison startDate="2026-10-01" endDate="2026-10-04" />,
  );
  expect(
    await screen.findByText("Hay un empate entre Centro, Norte."),
  ).toBeVisible();
  const empty = report();
  empty.leader_branch_ids = [];
  empty.branches = empty.branches.map((branch) => ({
    ...branch,
    completed_orders: 0,
    products: [],
    net_sales: "0.00",
  }));
  vi.mocked(compareBranches).mockResolvedValue(empty);
  view.rerender(
    <BranchComparison startDate="2026-09-01" endDate="2026-09-04" />,
  );
  expect(
    await screen.findByText(/Aún no hay ventas en estas fechas/),
  ).toBeVisible();
  expect(screen.queryByText(/tiene las mayores/)).not.toBeInTheDocument();
});

it("clears old tenant data immediately and ignores responses from an obsolete request", async () => {
  vi.mocked(compareBranches).mockResolvedValueOnce(report());
  const view = render(
    <BranchComparison startDate="2026-10-01" endDate="2026-10-04" />,
  );
  await screen.findByText("Centro tiene las mayores ventas netas.");
  let complete!: (value: Report) => void;
  vi.mocked(compareBranches).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  identity.tenantId = "tenant-b";
  view.rerender(
    <BranchComparison startDate="2026-10-01" endDate="2026-10-04" />,
  );
  expect(
    screen.queryByText("Centro tiene las mayores ventas netas."),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(compareBranches).toHaveBeenCalledTimes(2));
  const current = report();
  current.branches[0].branch_name = "Sur";
  await act(async () => complete(current));
  expect(
    await screen.findByText("Sur tiene las mayores ventas netas."),
  ).toBeVisible();
});

it("recovers from a comparison failure without displaying zero as real sales", async () => {
  vi.mocked(compareBranches).mockRejectedValueOnce(new Error("network"));
  vi.mocked(compareBranches).mockResolvedValueOnce(report());
  render(<BranchComparison startDate="2026-10-01" endDate="2026-10-04" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No pudimos comparar",
  );
  expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Volver a comparar" }));
  expect(
    await screen.findByText("Centro tiene las mayores ventas netas."),
  ).toBeVisible();
});
