import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { copy } from "@/i18n/messages";
import { RoleAccessPreview } from "./RoleAccessPreview";

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "authenticated", featureFlags: { customer_orders: false, margin_reports: false } } }),
}));

const preview = (role: string, label: string) => {
  const view = render(<RoleAccessPreview role={role} roleLabel={label} />);
  return { node: screen.getByRole("complementary", { name: `Vista previa del menú de ${label}` }), ...view };
};

it("shows a cashier only the daily register sections", () => {
  const { node } = preview("cashier", "Cajero");
  expect(node).toHaveTextContent(`Lo que verá: Cajero`);
  for (const label of [copy.register.title, copy.orderList.title, copy.shiftView.title, copy.nav.customers]) expect(node).toHaveTextContent(label);
  for (const label of [copy.reportsView.title, copy.catalog.title, copy.app.settings, copy.billingView.title]) expect(node).not.toHaveTextContent(label);
  // Flagged-off customer orders are not promised.
  expect(node).not.toHaveTextContent(copy.app.customerOrders);
});

it("uses the same owner-only and plan rules as the sidebar", () => {
  const manager = preview("manager", "Gerente");
  expect(manager.node).toHaveTextContent(copy.catalog.title);
  expect(manager.node).not.toHaveTextContent(copy.nav.loyalty);
  manager.unmount();
  const owner = preview("owner", "Dueño");
  expect(owner.node).toHaveTextContent(copy.nav.loyalty);
  expect(owner.node).toHaveTextContent("Productos y operación");
  expect(owner.node).not.toHaveTextContent(copy.nav.assistant);
});
