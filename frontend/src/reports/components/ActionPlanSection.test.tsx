import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import type { ActionPlanItem } from "../utils/actionPlan";
import { ActionPlanSection } from "./ActionPlanSection";

function makeActions(count: number): ActionPlanItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `R${index + 2}|subject-${index + 2}`,
    templateId: "R2",
    decisionArea: "inventario",
    tone: "action" as const,
    priority: "media" as const,
    action: `Acción ${index + 2}`,
    evidence: `Hallazgo ${index + 2}. Evidencia ${index + 2}`,
  }));
}

const opsNormalSignal: ActionPlanItem = {
  id: "signal|ops-normal",
  templateId: "signal",
  decisionArea: "caja",
  tone: "ok",
  action: copy.reportsView.actionOpsNormalAction,
};

function renderSection({
  actions = makeActions(3),
  signals = [opsNormalSignal],
  doneIds = new Set<string>(),
  feedbackById = {},
  onToggleDone = vi.fn(),
  onFeedback = vi.fn(),
} = {}) {
  render(
    <MemoryRouter>
      <ActionPlanSection
        actions={actions}
        signals={signals}
        doneIds={doneIds}
        feedbackById={feedbackById}
        onToggleDone={onToggleDone}
        onFeedback={onFeedback}
      />
    </MemoryRouter>,
  );
  return { onToggleDone, onFeedback };
}

describe("ActionPlanSection", () => {
  it("collapses by default and announces the row count", () => {
    renderSection();
    expect(screen.queryByText("Acción 2")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.reportsView.planSectionShow(4) }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to the checklist with exact evidence per row, signals last", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.planSectionShow(4) }));

    expect(screen.getByText("Acción 2")).toBeInTheDocument();
    expect(screen.getByText(/Hallazgo 2\. Evidencia 2/)).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.actionOpsNormalAction)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.planSectionHide }));
    expect(screen.getByRole("region", { hidden: true })).toHaveAttribute("inert");
    await waitFor(() => expect(screen.queryByText("Acción 2")).not.toBeInTheDocument());
  });

  it("caps action rows at eight even when expanded", () => {
    renderSection({ actions: makeActions(10), signals: [] });
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.planSectionShow(8) }));
    expect(screen.getByText("Acción 9")).toBeInTheDocument();
    expect(screen.queryByText("Acción 10")).not.toBeInTheDocument();
  });

  it("links inventory actions and reports done toggles", () => {
    const actions = makeActions(1);
    actions[0] = { ...actions[0], linkTo: "/inventory" };
    const { onToggleDone } = renderSection({ actions, signals: [] });
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.planSectionShow(1) }));

    expect(
      screen.getByRole("link", { name: new RegExp(copy.reportsView.actionGoInventory) }),
    ).toHaveAttribute("href", "/inventory");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleDone).toHaveBeenCalledWith(actions[0]);
  });

  it("renders nothing when there are no rows at all", () => {
    const { container } = render(
      <MemoryRouter>
        <ActionPlanSection
          actions={[]}
          signals={[]}
          doneIds={new Set()}
          feedbackById={{}}
          onToggleDone={vi.fn()}
          onFeedback={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("records usefulness feedback only for a completed action", () => {
    const actions = makeActions(1);
    const { onFeedback } = renderSection({
      actions,
      signals: [],
      doneIds: new Set([actions[0].id]),
    });
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.planSectionShow(1) }));
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.actionFeedbackNotYet }));
    expect(onFeedback).toHaveBeenCalledWith(actions[0], "not_yet");
  });
});
