import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeStory } from "../__fixtures__/story";
import { RefundsAndCancellations } from "./RefundsAndCancellations";

describe("RefundsAndCancellations", () => {
  it("shows the clean-ops state when there are no refunds or cancellations", () => {
    const story = makeStory({
      summary: { ...makeStory().summary, refund_count: 0, cancellation_count: 0, refund_total: "0" },
    });
    render(<RefundsAndCancellations story={story} />);
    expect(screen.getByText(/Buena señal operativa/i)).toBeInTheDocument();
  });

  it("collapses a calm operation to a status line with detail one tap away", () => {
    // A single small refund is calm: the section leads with one summary line
    // and only opens tiles + reasons on demand (progressive disclosure).
    const story = makeStory({
      summary: { ...makeStory().summary, refund_count: 1, refund_total: "80", gross_sales: "10000" },
      refunds_by_reason: [{ reason: "customer_return", refund_count: 1, refunded_amount: "80" }],
    });
    render(<RefundsAndCancellations story={story} />);
    expect(screen.getByText(/nivel normal/i)).toBeInTheDocument();
    expect(screen.queryByText(/no es un patrón/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ver detalle/i }));
    expect(screen.getByText(/no es un patrón/i)).toBeInTheDocument();
  });

  it("renders the per-reason breakdown with formatted amounts", () => {
    const story = makeStory({
      summary: { ...makeStory().summary, refund_count: 8, refund_total: "900", gross_sales: "10000" },
      refunds_by_reason: [
        { reason: "damaged_item", refund_count: 5, refunded_amount: "600" },
        { reason: "wrong_order", refund_count: 3, refunded_amount: "300" },
      ],
    });
    render(<RefundsAndCancellations story={story} />);
    // High refund rate → the "revisa los motivos" severity note.
    expect(screen.getByText(/revisa los motivos/i)).toBeInTheDocument();
    expect(screen.getByText(/\$600/)).toBeInTheDocument();
    expect(screen.getByText(/\$300/)).toBeInTheDocument();
  });
});
