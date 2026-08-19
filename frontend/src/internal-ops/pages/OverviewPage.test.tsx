import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Overview } from "../types";
import OverviewPage from "./OverviewPage";

const useOverview = vi.fn();
vi.mock("../hooks", () => ({ useOverview: () => useOverview() }));

const overview: Overview = {
  generated_at: "2026-08-19T12:00:00Z",
  environment: "local",
  version: { git_sha: "abc123" },
  health: { overall: "ok", sources: {} },
  growth: {
    users_created: 12,
    users_verified: 9,
    tenants_with_completed_sale: 5,
    paying_tenants: 3,
  },
  money: {
    currency: "MXN",
    mrr_minor_units: 89700,
    trialing_mrr_minor_units: 0,
    active: 4,
    trialing: 1,
    past_due: 0,
    canceling: 0,
  },
  risk: {
    failed_webhooks_24h: 0,
    past_due_tenants: 0,
    trials_expiring_7d: 0,
    grace_period_expired: 0,
  },
  operations: {
    orders_24h: 7,
    sales_24h_amount: "910.00",
    signups_7d: 2,
    tenants_active_7d: 4,
  },
};

describe("OverviewPage", () => {
  beforeEach(() => {
    useOverview.mockReset();
    useOverview.mockReturnValue({ isPending: false, isError: false, data: overview });
  });

  it("leads with the four canonical growth truths", () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Las cuatro verdades" })).toBeInTheDocument();
    expect(screen.getByText("Usuarios creados")).toBeInTheDocument();
    expect(screen.getByText("Usuarios verificados")).toBeInTheDocument();
    expect(screen.getByText("Negocios activados")).toBeInTheDocument();
    expect(screen.getByText("Negocios pagando")).toBeInTheDocument();
    expect(screen.getByText("Pago live procesado y suscripción activa")).toBeInTheDocument();
  });
});
