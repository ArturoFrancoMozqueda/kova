import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "authenticated", tenantId: "tenant-1" } }),
}));

import { makeStory } from "../__fixtures__/story";
import { usePlanDoneState } from "./usePlanDoneState";

describe("usePlanDoneState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists toggles under the tenant + period key and survives a remount", () => {
    const story = makeStory();
    const first = renderHook(() => usePlanDoneState(story));
    act(() => first.result.current.toggleDone("R2|subject-2"));

    expect(window.localStorage.getItem("kova:plan:tenant-1:2026-07-01:2026-07-07")).toContain(
      "R2|subject-2",
    );

    const second = renderHook(() => usePlanDoneState(story));
    expect(second.result.current.doneIds.has("R2|subject-2")).toBe(true);

    act(() => second.result.current.toggleDone("R2|subject-2"));
    expect(second.result.current.doneIds.has("R2|subject-2")).toBe(false);
  });

  it("keeps done sets isolated per period", () => {
    const july = renderHook(() => usePlanDoneState(makeStory()));
    act(() => july.result.current.toggleDone("R4|p1"));

    const juneStory = makeStory({
      summary: { ...makeStory().summary, start_date: "2026-06-01", end_date: "2026-06-07" },
    });
    const june = renderHook(() => usePlanDoneState(juneStory));
    expect(june.result.current.doneIds.size).toBe(0);
  });
});
