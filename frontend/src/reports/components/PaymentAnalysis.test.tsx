import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeStory } from "../__fixtures__/story";
import { PaymentAnalysis } from "./PaymentAnalysis";

describe("PaymentAnalysis", () => {
  it("flags a card-heavy mix using the real backend keys (bank_transfer + manual_card)", () => {
    // Regression: the insight filtered "card" | "transfer", but the backend
    // emits cash | bank_transfer | manual_card, so it never fired. Non-cash
    // rails at >= 80% share must surface the reconciliation note.
    const story = makeStory({
      payment_mix: [
        { method: "cash", amount: "1500", refunded_amount: "0", net_amount: "1500", payment_count: 15, sales_share_pct: 15 },
        { method: "bank_transfer", amount: "4000", refunded_amount: "0", net_amount: "4000", payment_count: 40, sales_share_pct: 40 },
        { method: "manual_card", amount: "4500", refunded_amount: "0", net_amount: "4500", payment_count: 45, sales_share_pct: 45 },
      ],
    });
    render(<PaymentAnalysis story={story} previousStory={null} />);
    expect(screen.getByText(/Tarjeta y transferencia suman 85%/)).toBeInTheDocument();
  });

  it("flags a cash-heavy mix", () => {
    const story = makeStory({
      payment_mix: [
        { method: "cash", amount: "8500", refunded_amount: "0", net_amount: "8500", payment_count: 85, sales_share_pct: 85 },
        { method: "manual_card", amount: "1500", refunded_amount: "0", net_amount: "1500", payment_count: 15, sales_share_pct: 15 },
      ],
    });
    render(<PaymentAnalysis story={story} previousStory={null} />);
    expect(screen.getByText(/El efectivo concentra 85%/)).toBeInTheDocument();
  });

  it("shows the balanced note when no rail dominates", () => {
    const story = makeStory({
      payment_mix: [
        { method: "cash", amount: "5000", refunded_amount: "0", net_amount: "5000", payment_count: 50, sales_share_pct: 50 },
        { method: "manual_card", amount: "5000", refunded_amount: "0", net_amount: "5000", payment_count: 50, sales_share_pct: 50 },
      ],
    });
    render(<PaymentAnalysis story={story} previousStory={null} />);
    expect(screen.getByText(/Pagos balanceados/)).toBeInTheDocument();
  });
});
