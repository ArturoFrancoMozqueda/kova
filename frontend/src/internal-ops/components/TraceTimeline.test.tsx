import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TraceTimeline, type TimelineItem } from "./TraceTimeline";

const items: TimelineItem[] = [
  { ts: "2026-01-02T10:00:00Z", source: "order", kind: "completed", summary: "Segundo" },
  {
    ts: "2026-01-01T10:00:00Z",
    source: "stripe_webhook",
    kind: "failed",
    summary: "Primero",
    correlation: { tenant_id: "tenant-abcdef01", user_id: null, request_id: null, stripe_event_id: null },
    deep_link: "https://dashboard.stripe.com/events/evt_1",
  },
];

function renderTimeline(data: TimelineItem[]) {
  return render(
    <MemoryRouter>
      <TraceTimeline items={data} />
    </MemoryRouter>,
  );
}

describe("TraceTimeline", () => {
  it("orders events ascending by timestamp", () => {
    renderTimeline(items);
    const summaries = screen.getAllByText(/Primero|Segundo/).map((el) => el.textContent);
    expect(summaries).toEqual(["Primero", "Segundo"]);
  });

  it("renders a correlation link and an external deep link", () => {
    renderTimeline(items);
    const tenantLink = screen.getByText(/tenant tenant-a/);
    expect(tenantLink.getAttribute("href")).toContain("/internal/ops/tenants?tenant_id=tenant-abcdef01");
    const external = screen.getByRole("link", { name: /stripe_webhook/ });
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
  });
});
