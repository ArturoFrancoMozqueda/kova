import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence, usePresenceKeys } from "./usePresence";

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

type Row = { id: string };
const keyOf = (row: Row) => row.id;
const summarize = (rows: ReturnType<typeof usePresenceKeys<Row>>) =>
  rows.map((row) => `${row.item.id}:${row.state}`);

describe("usePresenceKeys", () => {
  it("marks every present row present", () => {
    const items: Row[] = [{ id: "a" }, { id: "b" }];
    const { result } = renderHook(() => usePresenceKeys(items, keyOf, EXIT_MS));
    expect(summarize(result.current)).toEqual(["a:present", "b:present"]);
  });

  it("keeps a removed row in place while it animates out", () => {
    const all: Row[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { result, rerender } = renderHook(({ items }) => usePresenceKeys(items, keyOf, EXIT_MS), {
      initialProps: { items: all },
    });

    // Removing the middle row: it must stay at index 1, not jump to the end.
    rerender({ items: [all[0]!, all[2]!] });
    expect(summarize(result.current)).toEqual(["a:present", "b:exiting", "c:present"]);

    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(summarize(result.current)).toEqual(["a:present", "c:present"]);
  });

  it("cancels the exit when a row returns mid-flight", () => {
    // The cart's undo toast fires inside this window.
    const all: Row[] = [{ id: "a" }, { id: "b" }];
    const { result, rerender } = renderHook(({ items }) => usePresenceKeys(items, keyOf, EXIT_MS), {
      initialProps: { items: all },
    });

    rerender({ items: [all[0]!] });
    act(() => vi.advanceTimersByTime(EXIT_MS / 2));
    rerender({ items: all });
    expect(summarize(result.current)).toEqual(["a:present", "b:present"]);

    act(() => vi.advanceTimersByTime(EXIT_MS * 2));
    expect(summarize(result.current)).toEqual(["a:present", "b:present"]);
  });

  it("handles two rows leaving in quick succession", () => {
    const all: Row[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { result, rerender } = renderHook(({ items }) => usePresenceKeys(items, keyOf, EXIT_MS), {
      initialProps: { items: all },
    });

    rerender({ items: [all[0]!, all[2]!] });
    act(() => vi.advanceTimersByTime(EXIT_MS / 2));
    rerender({ items: [all[0]!] });
    expect(summarize(result.current)).toEqual(["a:present", "b:exiting", "c:exiting"]);

    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(summarize(result.current)).toEqual(["a:present"]);
  });
});
