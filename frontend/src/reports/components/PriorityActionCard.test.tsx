import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import type { Recommendation } from "../utils/recommendations";
import { PriorityActionCard } from "./PriorityActionCard";

const baseRec: Recommendation = {
  id: "R4",
  subjectId: "p1",
  priority: "media",
  tone: "risk",
  finding: "Dona necesita reabasto pronto",
  evidence: "Quedan 6 unidades y vendes 2 al día: alcanzan ≈ 3 días.",
  action: "Reabastece Dona esta semana.",
  impact: "$1,200 por semana en riesgo",
};

function renderCard(
  recommendation: Recommendation | null,
  { done = false, feedback = undefined, onToggleDone = vi.fn(), onFeedback = vi.fn() } = {},
) {
  render(
    <MemoryRouter>
      <PriorityActionCard
        recommendation={recommendation}
        done={done}
        feedback={feedback}
        onToggleDone={onToggleDone}
        onFeedback={onFeedback}
      />
    </MemoryRouter>,
  );
  return { onToggleDone, onFeedback };
}

describe("PriorityActionCard", () => {
  it("keeps the kicker, finding and action visible without interaction", () => {
    renderCard(baseRec);
    const hero = screen.getByTestId("priority-recommendation");
    expect(hero).toHaveTextContent(copy.reportsView.priorityRecommendationKicker);
    expect(hero).toHaveTextContent("Dona necesita reabasto pronto");
    expect(hero).toHaveTextContent("Reabastece Dona esta semana.");
  });

  it("discloses the exact evidence and impact on demand", () => {
    renderCard(baseRec);
    expect(screen.queryByText(/Quedan 6 unidades/)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: copy.reportsView.priorityWhyShow });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(screen.getByText(/Quedan 6 unidades y vendes 2 al día/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,200 por semana en riesgo/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.reportsView.priorityWhyHide }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("links inventory templates to /inventory and hides the link once done", () => {
    renderCard(baseRec);
    expect(
      screen.getByRole("link", { name: new RegExp(copy.reportsView.actionGoInventory) }),
    ).toHaveAttribute("href", "/inventory");
  });

  it("reports the done toggle to the owner state", () => {
    const { onToggleDone } = renderCard(baseRec);
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.planMarkDone }));
    expect(onToggleDone).toHaveBeenCalledTimes(1);
  });

  it("shows the done state with the link removed", () => {
    renderCard(baseRec, { done: true });
    expect(screen.getByTestId("priority-recommendation")).toHaveTextContent(copy.reportsView.planDone);
    expect(
      screen.queryByRole("link", { name: new RegExp(copy.reportsView.actionGoInventory) }),
    ).not.toBeInTheDocument();
  });

  it("asks whether a completed action was useful", () => {
    const { onFeedback } = renderCard(baseRec, { done: true });
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.actionFeedbackHelpful }));
    expect(onFeedback).toHaveBeenCalledWith("helpful");
  });

  it("does not treat a positive signal as a completable action", () => {
    renderCard({ ...baseRec, id: "R13", tone: "good_signal" });
    expect(
      screen.queryByRole("button", { name: copy.reportsView.planMarkDone }),
    ).not.toBeInTheDocument();
  });

  it("shows the positive empty state when there is nothing to recommend", () => {
    renderCard(null);
    expect(screen.getByText(copy.reportsView.recommendationsEmpty)).toBeInTheDocument();
    expect(screen.queryByTestId("priority-recommendation")).not.toBeInTheDocument();
  });
});
