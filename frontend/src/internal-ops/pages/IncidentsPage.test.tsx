import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IncidentsPage from "./IncidentsPage";
import type { IncidentList } from "../types";

const useIncidents = vi.fn();
vi.mock("../hooks", () => ({ useIncidents: (f: unknown) => useIncidents(f) }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/internal/ops/incidents"]}>
      <IncidentsPage />
    </MemoryRouter>,
  );
}

describe("IncidentsPage", () => {
  beforeEach(() => useIncidents.mockReset());

  it("shows an empty state when there are no incidents", () => {
    useIncidents.mockReturnValue({
      isPending: false,
      isError: false,
      data: { generated_at: "2026-01-01T00:00:00Z", items: [], total: 0, degraded_sources: [] } as IncidentList,
    });
    renderPage();
    expect(screen.getByText(/Sin incidentes en este filtro/)).toBeInTheDocument();
  });

  it("renders incident rows", () => {
    useIncidents.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        generated_at: "2026-01-01T00:00:00Z",
        total: 1,
        degraded_sources: [],
        items: [
          {
            key: "stripe_webhook:evt_1",
            source: "stripe_webhook",
            external_id: "evt_1",
            severity: "critical",
            title: "Webhook fallido",
            detected_at: "2026-01-01T00:00:00Z",
            last_seen_at: null,
            correlation: { tenant_id: null, user_id: null, request_id: null, stripe_event_id: "evt_1" },
            triage: { status: "new", snoozed_until: null, updated_at: null },
            deep_links: [],
          },
        ],
      } as IncidentList,
    });
    renderPage();
    expect(screen.getByText("Webhook fallido")).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    const refetch = vi.fn();
    useIncidents.mockReturnValue({ isPending: false, isError: true, error: new Error("boom"), refetch });
    renderPage();
    expect(screen.getByText(opsCopyRetry())).toBeInTheDocument();
  });
});

function opsCopyRetry(): string {
  return "Reintentar";
}
