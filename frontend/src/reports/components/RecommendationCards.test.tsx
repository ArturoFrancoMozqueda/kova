import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { copy } from "@/i18n/messages";
import { makeStory } from "../__fixtures__/story";
import type { Recommendation } from "../utils/recommendations";
import { RecommendationCards } from "./RecommendationCards";

/** Recommendations arrive pre-sorted (priority → MXN impact), so the first
 * item is by contract the priority action the hero card must show. */
function makeRecommendations(count: number): Recommendation[] {
  const priorities = ["alta", "media", "baja"] as const;
  return Array.from({ length: count }, (_, index) => ({
    id: `R${index + 1}`,
    subjectId: `subject-${index + 1}`,
    priority: priorities[Math.min(index, 2)],
    tone: "risk" as const,
    finding: `Hallazgo ${index + 1}`,
    evidence: `Evidencia ${index + 1}`,
    action: `Acción ${index + 1}`,
  }));
}

// Fixture summary has 0 refunds / 0 cancellations → the plan appends the
// "pagos y devoluciones en nivel normal" confirmation row (1 signal).
function renderCards(recommendations: Recommendation[]) {
  return render(
    <RecommendationCards recommendations={recommendations} story={makeStory()} previousStory={null} />,
  );
}

describe("RecommendationCards (Qué hacer ahora)", () => {
  it("renders the first recommendation as the hero with the kicker", () => {
    renderCards(makeRecommendations(4));

    const hero = screen.getByTestId("priority-recommendation");
    expect(hero).toHaveTextContent(copy.reportsView.priorityRecommendationKicker);
    expect(hero).toHaveTextContent("Hallazgo 1");
    expect(screen.getAllByTestId("priority-recommendation")).toHaveLength(1);
  });

  it("renders checklist rows action-first with the finding as evidence", () => {
    renderCards(makeRecommendations(3));

    expect(screen.getByText("Acción 2")).toBeInTheDocument();
    expect(screen.getByText(/Hallazgo 2\. Evidencia 2/)).toBeInTheDocument();
  });

  it("always keeps the ops-normal confirmation visible in the collapsed view", () => {
    renderCards(makeRecommendations(6));

    expect(screen.getByText(copy.reportsView.actionOpsNormalAction)).toBeInTheDocument();
  });

  it("collapses to the top actions and expands to all with the toggle", () => {
    renderCards(makeRecommendations(6));

    // Collapsed: hero + 3 actions (4 slots − 1 signal) + the signal.
    expect(screen.getByText("Acción 4")).toBeInTheDocument();
    expect(screen.queryByText("Acción 5")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.recShowAll(6) }));
    expect(screen.getByText("Acción 6")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.recShowLess }));
    expect(screen.queryByText("Acción 5")).not.toBeInTheDocument();
  });

  it("caps expanded action rows at eight", () => {
    renderCards(makeRecommendations(12));

    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.recShowAll(9) }));
    expect(screen.getByText("Acción 9")).toBeInTheDocument();
    expect(screen.queryByText("Acción 10")).not.toBeInTheDocument();
  });

  it("renders a lone recommendation as hero without a toggle", () => {
    renderCards(makeRecommendations(1));

    expect(screen.getByTestId("priority-recommendation")).toHaveTextContent("Hallazgo 1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the empty state when there is nothing to recommend", () => {
    renderCards([]);

    expect(screen.getByText(copy.reportsView.recommendationsEmpty)).toBeInTheDocument();
    expect(screen.queryByTestId("priority-recommendation")).not.toBeInTheDocument();
  });
});
