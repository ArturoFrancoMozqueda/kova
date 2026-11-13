import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/i18n/messages";
import { useOperationsPanel } from "./useOperationsPanel";

const identity = { tenantId: "tenant-1", userId: "user-1", branchId: "branch-1" };

describe("useOperationsPanel error presentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never shows the browser's raw 'Failed to fetch' when the connection drops", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { result } = renderHook(() => useOperationsPanel("/api/v1/automations", identity));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(copy.errors.network);
    expect(result.current.error).not.toMatch(/failed to fetch/i);
  });

  it("keeps the public message mapped from a server failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Traceback (most recent call last)" }), { status: 500 })));
    const { result } = renderHook(() => useOperationsPanel("/api/v1/automations", identity));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(copy.errors.server);
  });
});
