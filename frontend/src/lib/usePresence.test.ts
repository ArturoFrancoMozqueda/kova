import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "./usePresence";

const EXIT_MS = 180;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePresence", () => {
  it("mounts immediately when open", () => {
    const { result } = renderHook(() => usePresence(true, EXIT_MS));
    expect(result.current).toEqual({ mounted: true, exiting: false });
  });

  it("stays mounted through the exit window, then drops", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, EXIT_MS), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, exiting: true });

    act(() => vi.advanceTimersByTime(EXIT_MS - 1));
    expect(result.current.mounted).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, exiting: false });
  });

  it("cancels the exit when reopened mid-flight", () => {
    // The cart's undo toast can fire inside the exit window, so a reopen must
    // retarget rather than leave a ghost node behind.
    const { result, rerender } = renderHook(({ open }) => usePresence(open, EXIT_MS), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    act(() => vi.advanceTimersByTime(EXIT_MS / 2));
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, exiting: false });

    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(result.current).toEqual({ mounted: true, exiting: false });
  });

  it("never reports exiting for a node that was closed from the start", () => {
    const { result } = renderHook(() => usePresence(false, EXIT_MS));
    expect(result.current).toEqual({ mounted: false, exiting: false });
    act(() => vi.advanceTimersByTime(EXIT_MS * 2));
    expect(result.current).toEqual({ mounted: false, exiting: false });
  });
});
