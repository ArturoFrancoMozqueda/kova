import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { copy } from "@/i18n/messages";
import { makeStory } from "@/reports/__fixtures__/story";
import type { OnboardingState } from "@/onboarding/api";

const auth = vi.hoisted(() => ({ state: {
  status: "authenticated", tenantId: "tenant-owner", tenantName: "Negocio propietario",
  sessionMode: "online", user: { id: "user-owner", role: "owner" },
} }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("./api", () => ({ getDashboardOverview: vi.fn() }));
vi.mock("@/reports/api", () => ({ getBusinessStory: vi.fn(), getSalesByHour: vi.fn(), getSalesSummary: vi.fn() }));
vi.mock("@/catalog/api", () => ({ listProducts: vi.fn(async () => []) }));
vi.mock("@/inventory/api", () => ({ listStock: vi.fn(async () => []), listLowStock: vi.fn(async () => []) }));
vi.mock("@/billing/api", () => ({ getBillingSubscription: vi.fn(async () => null) }));
vi.mock("@/onboarding/api", () => ({ getOnboardingState: vi.fn(async () => null) }));
vi.mock("@/settings/api", () => ({
  getBusinessProfile: vi.fn(async () => ({ timezone: "America/Mexico_City" })),
  listEmployees: vi.fn(async () => []),
}));
vi.mock("@/shifts/api", () => ({ listClosedShifts: vi.fn(async () => []) }));
vi.mock("@/components/brand/RealTime", () => ({
  CountUp: ({ value }: { value: number }) => <span data-testid="net-sales">{value}</span>,
}));

import DashboardView from "./DashboardView";
import { getDashboardOverview, type DashboardOverview } from "./api";
import { summaryFromStory } from "./storyAdapters";
import { getBusinessStory, getSalesByHour, getSalesSummary } from "@/reports/api";

function emptyStory() {
  const story = makeStory();
  return makeStory({
    summary: { ...story.summary, completed_orders: 0, net_sales: "0.00", gross_sales: "0.00",
      refund_total: "0.00", average_ticket: "0.00", refund_count: 0, cancellation_count: 0 },
    sales_by_day: [], sales_by_daypart: [], peak_hour: null,
    top_product_by_sales: null, top_product_by_units: null, product_drivers: [],
    dominant_payment: null, payment_mix: [],
  });
}

function overview(overrides: Partial<DashboardOverview> = {}): DashboardOverview {
  const story = emptyStory();
  return {
    story, hourly: [], previous_summary: summaryFromStory(story), timezone: "America/Mexico_City",
    active_catalog_count: 0, tracked_inventory_count: 0, low_stock_items: [],
    active_employee_count: 0, closed_shift_count: 0, billing: null,
    onboarding: {
      tenant_id: "tenant-owner", completed_count: 1, total_count: 4,
      steps: [
        { key: "receipt_settings", label: "Recibo", completed: true, action_path: "/settings/receipt" },
        { key: "inventory", label: "Inventario", completed: false, action_path: "/inventory?from=onboarding" },
        { key: "first_product", label: "Producto", completed: false, action_path: "/catalog?new=product" },
        { key: "business_profile", label: "Negocio", completed: false, action_path: "/settings/business-profile" },
      ],
    },
    ...overrides,
  };
}

function host() {
  return render(<MemoryRouter><DashboardView /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  auth.state = { status: "authenticated", tenantId: "tenant-owner", tenantName: "Negocio propietario",
    sessionMode: "online", user: { id: "user-owner", role: "owner" } };
  vi.mocked(getDashboardOverview).mockReset().mockResolvedValue(overview());
  vi.mocked(getBusinessStory).mockResolvedValue(emptyStory());
  vi.mocked(getSalesByHour).mockResolvedValue([]);
  vi.mocked(getSalesSummary).mockResolvedValue(summaryFromStory(emptyStory()));
});

describe("owner dashboard journey", () => {
  it("keeps one set of task actions available while sales data is loading", async () => {
    vi.mocked(getDashboardOverview).mockReturnValue(new Promise(() => {}));
    host();
    const actions = screen.getByRole("navigation", { name: copy.dashboard.quickActions });
    expect(within(actions).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
      "/operations-queue", "/settings/public-catalog", "/shifts", "/reports",
    ]);
    expect(within(actions).getByRole("link", { name: /Ver análisis/ })).toBeVisible();
    expect(screen.getAllByRole("navigation", { name: copy.dashboard.quickActions })).toHaveLength(1);
    expect(screen.queryByTestId("net-sales")).not.toBeInTheDocument();
    await waitFor(() => expect(getDashboardOverview).toHaveBeenCalledExactlyOnceWith("day"));
  });

  it("keeps task actions reachable when sales data fails without extra API calls", async () => {
    vi.mocked(getDashboardOverview).mockRejectedValue(new Error("report unavailable"));
    host();
    await screen.findByText(copy.dashboard.loadError);
    const actions = screen.getByRole("navigation", { name: copy.dashboard.quickActions });
    expect(within(actions).getByRole("link", { name: /Ver pendientes/ })).toHaveAttribute("href", "/operations-queue");
    expect(screen.getAllByRole("navigation", { name: copy.dashboard.quickActions })).toHaveLength(1);
    expect(getDashboardOverview).toHaveBeenCalledOnce();
    for (const legacy of [getBusinessStory, getSalesByHour, getSalesSummary]) expect(legacy).not.toHaveBeenCalled();
  });

  it("keeps onboarding first, then one task block before the sales metrics", async () => {
    host();
    const next = await screen.findByRole("group", { name: "Siguiente paso" });
    const actions = screen.getByRole("navigation", { name: copy.dashboard.quickActions });
    const metrics = screen.getByTestId("net-sales");
    expect(next.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: copy.dashboard.quickActions })).toHaveLength(1);
  });

  it("does not expose task actions unavailable in an offline session", async () => {
    auth.state.sessionMode = "offline";
    host();
    await screen.findByTestId("net-sales");
    expect(screen.queryByRole("navigation", { name: copy.dashboard.quickActions })).not.toBeInTheDocument();
  });

  it("highlights the first incomplete backend step and keeps the other steps reversibly available", async () => {
    const { container } = host();
    const next = await screen.findByRole("group", { name: "Siguiente paso" });
    expect(within(next).getByText(copy.dashboard.onboardingStepLabel("inventory")!)).toBeVisible();
    expect(within(next).getByRole("link", { name: /Activar stock/ }))
      .toHaveAttribute("href", "/inventory?from=onboarding");
    expect(screen.getByText("1/4")).toBeVisible();
    const summary = screen.getByText("Ver los demás pasos");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    const product = within(details).getByRole("link", { name: /Crear producto/, hidden: true });
    expect(product).not.toBeVisible();
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(product).toBeVisible();
    expect(product).toHaveAttribute("href", "/catalog?new=product");
    expect(within(details).getByText(copy.dashboard.onboardingStepLabel("receipt_settings")!)).toBeVisible();
    fireEvent.click(summary);
    expect(details).not.toHaveAttribute("open");
    expect(getDashboardOverview).toHaveBeenCalledOnce();
    expect((await axe(container, { runOnly: ["heading-order", "link-name", "aria-allowed-attr"] })).violations).toEqual([]);
  });

  it("places the next onboarding step before the sales story banner", async () => {
    host();
    const next = await screen.findByRole("group", { name: "Siguiente paso" });
    const banner = screen.getByText(copy.dashboard.storyBannerEmpty);
    expect(next.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["owner", "manager"])("offers the billing onboarding action only with billing permission for a %s", async role => {
    auth.state.user.role = role;
    vi.mocked(getDashboardOverview).mockResolvedValue(overview({ onboarding: {
      tenant_id: "tenant-owner", completed_count: 0, total_count: 2,
      steps: [
        { key: "billing", label: "Plan", completed: false, action_path: "/settings/billing?from=onboarding" },
        { key: "first_product", label: "Producto", completed: false, action_path: "/catalog" },
      ],
    } }));
    host();
    const next = await screen.findByRole("group", { name: "Siguiente paso" });
    expect(screen.getByText("0/2")).toBeVisible();
    if (role === "owner") {
      expect(within(next).getByRole("link")).toHaveAttribute("href", "/settings/billing?from=onboarding");
      expect(within(next).queryByText("Este paso lo completa el dueño del negocio.")).not.toBeInTheDocument();
    } else {
      expect(within(next).queryByRole("link")).not.toBeInTheDocument();
      expect(within(next).getByText("Este paso lo completa el dueño del negocio.")).toBeVisible();
    }
  });

  it("keeps fallback billing completion visible to managers without a restricted action", async () => {
    auth.state.user.role = "manager";
    vi.mocked(getDashboardOverview).mockResolvedValue(null);
    host();
    const next = await screen.findByRole("group", { name: "Siguiente paso" });
    expect(within(next).getByText("Este paso lo completa el dueño del negocio.")).toBeVisible();
    expect(within(next).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("0/4")).toBeVisible();
    fireEvent.click(screen.getByText("Ver los demás pasos"));
    expect(screen.getByRole("link", { name: `${copy.dashboard.onboardingStep2Action} →` })).toHaveAttribute("href", "/catalog");
  });

  it("advances only when updated backend completion or existing real signals complete the current step", async () => {
    host();
    await screen.findByRole("group", { name: "Siguiente paso" });
    const current = overview();
    vi.mocked(getDashboardOverview).mockResolvedValue({ ...current,
      onboarding: { ...current.onboarding, completed_count: 2,
        steps: current.onboarding.steps.map(step => step.key === "inventory" ? { ...step, completed: true } : step) },
    });
    fireEvent.click(screen.getByRole("radio", { name: copy.dashboard.periodWeek }));
    const next = await screen.findByRole("group", { name: "Siguiente paso" });
    expect(within(next).getByRole("link", { name: /Crear producto/ })).toHaveAttribute("href", "/catalog?new=product");
    expect(screen.getByText("2/4")).toBeVisible();
  });

  it.each(["owner", "manager"])("makes four distinct quick actions available to a %s before the first sale", async role => {
    auth.state.user.role = role;
    host();
    const quick = await screen.findByRole("navigation", { name: copy.dashboard.quickActions });
    const links = within(quick).getAllByRole("link");
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      "/operations-queue", "/settings/public-catalog", "/shifts", "/reports",
    ]);
    expect(within(quick).getByRole("link", { name: /Revisar turnos/ })).toBeVisible();
    expect(within(quick).queryByText("Cerrar turno")).not.toBeInTheDocument();
    expect(within(quick).getByRole("link", { name: /Compartir catálogo/ })).toBeVisible();
    expect(within(quick).getByRole("link", { name: /Ver pendientes/ })).toBeVisible();
    expect(screen.getByTestId("net-sales")).toHaveTextContent(/^0$/);
    expect(screen.getByText(copy.dashboard.noActivityTitle)).toBeVisible();
    expect(getDashboardOverview).toHaveBeenCalledExactlyOnceWith("day");
    for (const legacy of [getBusinessStory, getSalesByHour, getSalesSummary]) expect(legacy).not.toHaveBeenCalled();
  });

  it.each(["cashier", "staff"])("does not offer administrative destinations to a %s", async role => {
    auth.state.user.role = role;
    host();
    const quick = await screen.findByRole("navigation", { name: copy.dashboard.quickActions });
    expect(within(quick).queryByRole("link", { name: /Compartir catálogo/ })).not.toBeInTheDocument();
    expect(within(quick).queryByRole("link", { name: /Ver pendientes/ })).not.toBeInTheDocument();
    expect(within(quick).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/shifts"]);
  });

  it("places one actionable section between the executive summary and business health", async () => {
    host();
    await screen.findByTestId("net-sales");
    const summary = screen.getByText(copy.dashboard.netSales, { exact: true });
    const actions = screen.getByRole("heading", { name: copy.dashboard.nextActionsTitle });
    const health = screen.getByText(copy.dashboard.healthTitle, { exact: true });
    expect(summary.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.compareDocumentPosition(health) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: copy.dashboard.nextActionsTitle })).toHaveLength(1);
  });

  it("retains fallback onboarding, billing navigation and quick discovery when no overview endpoint exists", async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue(null);
    host();
    const next = await screen.findByRole("group", { name: "Siguiente paso" });
    expect(within(next).getByRole("link", { name: /Abrir suscripción/ })).toHaveAttribute("href", "/settings/billing");
    expect(screen.getByText("0/4")).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: copy.dashboard.quickActions })).getAllByRole("link")).toHaveLength(4);
    expect(screen.getByTestId("net-sales")).toHaveTextContent(/^0$/);
  });

  it("keeps completion celebration and dismissal instead of showing a fabricated next step", async () => {
    const complete: OnboardingState = { tenant_id: "tenant-owner", completed_count: 1, total_count: 1,
      steps: [{ key: "business_profile", label: "Negocio", completed: true, action_path: "/settings/business-profile" }] };
    vi.mocked(getDashboardOverview).mockResolvedValue(overview({ onboarding: complete }));
    host();
    expect(await screen.findByText(copy.dashboard.onboardingDoneTitle)).toBeVisible();
    expect(screen.queryByRole("group", { name: "Siguiente paso" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.dashboard.onboardingDoneDismiss }));
    expect(screen.queryByText(copy.dashboard.onboardingDoneTitle)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("kova-onboarding-celebrated:Negocio propietario")).toBe("1");
  });

  it("does not revive the previous business's data or next step after an identity change", async () => {
    let resolveOld!: (data: DashboardOverview) => void;
    vi.mocked(getDashboardOverview).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const rendered = host();
    await waitFor(() => expect(getDashboardOverview).toHaveBeenCalledOnce());
    const newer = overview({ story: makeStory({ summary: { ...makeStory().summary, net_sales: "222.00" } }),
      onboarding: { tenant_id: "tenant-new", completed_count: 0, total_count: 1,
        steps: [{ key: "new_business_step", label: "Paso del negocio nuevo", completed: false, action_path: "/settings/business-profile?business=new" }] } });
    vi.mocked(getDashboardOverview).mockResolvedValue(newer);
    auth.state = { ...auth.state, tenantId: "tenant-new", tenantName: "Negocio nuevo",
      user: { ...auth.state.user, id: "user-new" } };
    rendered.rerender(<MemoryRouter><DashboardView /></MemoryRouter>);
    expect(await screen.findByTestId("net-sales")).toHaveTextContent("222");
    await act(async () => resolveOld(overview()));
    const next = screen.getByRole("group", { name: "Siguiente paso" });
    expect(within(next).getByText("Paso del negocio nuevo")).toBeVisible();
    expect(within(next).getByRole("link")).toHaveAttribute("href", "/settings/business-profile?business=new");
    expect(screen.getByTestId("net-sales")).toHaveTextContent("222");
    expect(screen.queryByText("1/4")).not.toBeInTheDocument();
  });
});
