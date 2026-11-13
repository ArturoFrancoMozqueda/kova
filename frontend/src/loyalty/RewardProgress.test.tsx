import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RewardProgress } from "./RewardProgress";
import type { Reward } from "./rewards/api";

const reward: Reward = { id: "reward-1", version: 1, enabled: true, title: "Café gratis", points_cost: 200, discount_amount: "45.00" };

describe("RewardProgress", () => {
  it("shows the balance against the saved reward cost", () => {
    render(<RewardProgress reward={reward} balance={50} />);
    const meter = screen.getByRole("meter", { name: "Avance para Café gratis: 50 de 200 puntos" });
    expect(meter).toHaveAttribute("aria-valuenow", "50");
    expect(meter).toHaveAttribute("aria-valuemax", "200");
    expect(screen.getByText("50 de 200 puntos")).toBeVisible();
  });

  it("says the reward is available once the balance covers it", () => {
    render(<RewardProgress reward={reward} balance={260} />);
    expect(screen.getByText("200 de 200 puntos · disponible")).toBeVisible();
  });

  it("draws nothing without an active reward or with a negative balance floor", () => {
    const { container, rerender } = render(<RewardProgress reward={null} balance={50} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<RewardProgress reward={{ ...reward, enabled: false }} balance={50} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<RewardProgress reward={reward} balance={-20} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });
});
