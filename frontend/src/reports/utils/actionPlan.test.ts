import { describe, expect, it } from "vitest";

import { makeStory } from "../__fixtures__/story";
import { buildActionPlan } from "./actionPlan";
import type { Recommendation } from "./recommendations";

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

describe("buildActionPlan", () => {
  it("keeps the first recommendation as hero and turns the rest into action-first rows", () => {
    const plan = buildActionPlan({
      recommendations: makeRecommendations(3),
      story: makeStory(),
      previousStory: null,
    });
    expect(plan.hero?.finding).toBe("Hallazgo 1");
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0].action).toBe("Acción 2");
    expect(plan.actions[0].evidence).toContain("Hallazgo 2");
    expect(plan.actions[0].priority).toBe("media");
  });

  it("adds a watch signal when the average ticket drops >=10% vs a comparable period", () => {
    const story = makeStory({ summary: { ...makeStory().summary, average_ticket: "85" } });
    const previous = makeStory({ summary: { ...makeStory().summary, average_ticket: "100" } });
    const plan = buildActionPlan({ recommendations: [], story, previousStory: previous });
    const watch = plan.signals.find((item) => item.id === "signal|ticket-watch");
    expect(watch?.tone).toBe("watch");
    expect(watch?.evidence).toContain("15%");
  });

  it("does not add the ticket signal without a comparable previous period", () => {
    const story = makeStory({ summary: { ...makeStory().summary, average_ticket: "50" } });
    const previous = makeStory({
      summary: { ...makeStory().summary, average_ticket: "100", completed_orders: 2 },
    });
    expect(
      buildActionPlan({ recommendations: [], story, previousStory: previous }).signals.some(
        (item) => item.id === "signal|ticket-watch",
      ),
    ).toBe(false);
    expect(
      buildActionPlan({ recommendations: [], story, previousStory: null }).signals.some(
        (item) => item.id === "signal|ticket-watch",
      ),
    ).toBe(false);
  });

  it("confirms normal operations only when refunds and cancellations are calm", () => {
    // Fixture: 0 refunds / 0 cancellations → normal.
    const calm = buildActionPlan({ recommendations: [], story: makeStory(), previousStory: null });
    expect(calm.signals.some((item) => item.id === "signal|ops-normal")).toBe(true);

    const noisy = makeStory({
      summary: { ...makeStory().summary, refund_count: 8, refund_total: "900", gross_sales: "10000" },
    });
    const alert = buildActionPlan({ recommendations: [], story: noisy, previousStory: null });
    expect(alert.signals.some((item) => item.id === "signal|ops-normal")).toBe(false);
  });

  it("skips the ops confirmation when R13 (clean ops) already says it", () => {
    const withCleanOps: Recommendation[] = [
      {
        id: "R13",
        subjectId: "clean-ops",
        priority: "baja",
        tone: "good_signal",
        finding: "Operación limpia",
        evidence: "100 órdenes sin devoluciones ni cancelaciones.",
        action: "Usa este periodo como referencia.",
      },
    ];
    const plan = buildActionPlan({
      recommendations: withCleanOps,
      story: makeStory(),
      previousStory: null,
    });
    expect(plan.signals.some((item) => item.id === "signal|ops-normal")).toBe(false);
  });

  it("marks good-signal recommendations as ok rows", () => {
    const recs = makeRecommendations(2);
    recs[1] = { ...recs[1], tone: "good_signal" };
    const plan = buildActionPlan({ recommendations: recs, story: makeStory(), previousStory: null });
    expect(plan.actions[0].tone).toBe("ok");
  });
});
