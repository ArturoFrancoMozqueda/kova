import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Coupon } from "./api";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), manage: true, access: undefined as unknown }));
vi.mock("./api", () => ({
  listCoupons: () => api.list(),
  createCoupon: (body: unknown) => api.create(body),
  updateCoupon: (id: string, body: unknown) => api.update(id, body),
}));
vi.mock("@/auth/permissions", async (original) => ({ ...(await original<object>()), usePermission: () => api.manage }));
vi.mock("@/auth/useAuth", () => ({ useOptionalAuth: () => ({ state: { status: "authenticated", commercialAccess: api.access } }) }));
vi.mock("@/billing/PlanFeatureNotice", () => ({ PlanFeatureNotice: () => <p>Requiere el plan Gestión</p> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
import CouponsView from "./CouponsView";

const coupon: Coupon = {
  id: "c1", code: "VERANO10", description: "Promo de verano", kind: "percent", value: "10.00", min_purchase: "100.00",
  starts_at: null, ends_at: null, max_uses: 50, max_uses_per_customer: 1, is_active: true, version: 1, uses: 3,
  created_at: "2026-11-27T12:00:00Z",
};
const renderView = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CouponsView /></QueryClientProvider>);

beforeEach(() => {
  api.manage = true; api.access = undefined;
  api.list.mockReset().mockResolvedValue([coupon]);
  api.create.mockReset().mockResolvedValue(coupon);
  api.update.mockReset().mockResolvedValue({ ...coupon, is_active: false, version: 2 });
});

it("lists coupons with their rules and use, and pauses one", async () => {
  renderView();
  expect(await screen.findByText("VERANO10")).toBeVisible();
  expect(screen.getByText("10% de descuento en compras desde $100.00 · Promo de verano")).toBeVisible();
  expect(screen.getByText("3 de 50 usos · 1 por cliente")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith("c1", { version: 1, is_active: false }));
});

it("creates a coupon with optional limits", async () => {
  renderView();
  await screen.findByText("VERANO10");
  fireEvent.change(screen.getByLabelText("Código"), { target: { value: "pan2x1" } });
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "amount" } });
  fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("Usos en total (opcional)"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear cupón" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
    code: "pan2x1", kind: "amount", value: "25", max_uses: 100, max_uses_per_customer: null, starts_at: null })));
});

it("lets cashiers see coupons without managing them, and shows the plan notice on Esencial", async () => {
  api.manage = false;
  api.access = { allowed: true, plan_code: "esencial", features: ["pos"] };
  renderView();
  expect(await screen.findByText("VERANO10")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Crear cupón" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();
  expect(screen.getByText("Requiere el plan Gestión")).toBeVisible();
});
