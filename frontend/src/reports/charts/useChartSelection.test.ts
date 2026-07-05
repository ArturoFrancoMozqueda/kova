import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useChartSelection } from "./useChartSelection";

describe("useChartSelection", () => {
  it("locks a selection on toggle and clears it on a second toggle", () => {
    const { result } = renderHook(() => useChartSelection());
    expect(result.current.activeId).toBeNull();

    act(() => result.current.toggle("a"));
    expect(result.current.selectedId).toBe("a");
    expect(result.current.activeId).toBe("a");

    act(() => result.current.toggle("a"));
    expect(result.current.selectedId).toBeNull();
    expect(result.current.activeId).toBeNull();
  });

  it("uses the preview as the active row only when nothing is locked", () => {
    const { result } = renderHook(() => useChartSelection());
    act(() => result.current.preview("b"));
    expect(result.current.activeId).toBe("b");

    act(() => result.current.toggle("a"));
    act(() => result.current.preview("b"));
    // A locked selection wins over the hover preview.
    expect(result.current.activeId).toBe("a");
  });

  it("honors an initial selection (best-day pre-selection)", () => {
    const { result } = renderHook(() => useChartSelection("best"));
    expect(result.current.activeId).toBe("best");
  });
});
