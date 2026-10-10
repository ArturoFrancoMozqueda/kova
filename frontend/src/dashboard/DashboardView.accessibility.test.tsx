import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { makeStory } from "@/reports/__fixtures__/story";
import DashboardView from "./DashboardView";

vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: {
  status: "authenticated", tenantId: "tenant-1", tenantName: "Mi negocio", user: { id: "user-1" },
} }) }));
vi.mock("@/reports/api", () => ({
  getBusinessStory: vi.fn(async () => {
    const story = makeStory();
    return makeStory({ summary: { ...story.summary, completed_orders: 5, refund_count: 7 } });
  }),
  getSalesByHour: vi.fn(async () => []),
  getSalesSummary: vi.fn(async () => null),
}));
vi.mock("@/catalog/api", () => ({ listProducts: vi.fn(async () => []) }));
vi.mock("@/inventory/api", () => ({ listStock: vi.fn(async () => []), listLowStock: vi.fn(async () => []) }));
vi.mock("@/billing/api", () => ({ getBillingSubscription: vi.fn(async () => null) }));
vi.mock("@/onboarding/api", () => ({ getOnboardingState: vi.fn(async () => null) }));
vi.mock("@/settings/api", () => ({
  getBusinessProfile: vi.fn(async () => ({ timezone: "America/Mexico_City" })),
  listEmployees: vi.fn(async () => []),
}));
vi.mock("@/shifts/api", () => ({ listClosedShifts: vi.fn(async () => []) }));
vi.mock("@/components/brand/RealTime", () => ({ CountUp: ({ value }: { value: number }) => <span>{value}</span> }));

it("uses level-two section headings in the loaded dashboard with its real health and action cards", async () => {
  const { container } = render(<MemoryRouter><DashboardView /></MemoryRouter>);
  await screen.findByText("Cobros antes de devoluciones");
  for (const section of ["Qué hacer ahora", "Tus mejores horas Top 3", "Cómo te pagaron", "Productos top", "Acciones rápidas"]) {
    expect(screen.getByRole("heading", { name: section, level: 2 })).toBeInTheDocument();
  }
  expect((await axe(container, { runOnly: ["heading-order"] })).violations).toEqual([]);
});
