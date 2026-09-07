import { beforeEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as string[]);
const clearOfflineAccess = vi.hoisted(() => vi.fn(async () => {
  events.push("clear-offline-identity");
}));
const announceSessionChange = vi.hoisted(() => vi.fn(() => {
  events.push("announce-session-change");
}));

vi.mock("@/offline/offlineAccess", () => ({ clearOfflineAccess }));
vi.mock("./sessionCoordination", () => ({
  announceSessionChange,
  clearLogoutPending: vi.fn(() => events.push("clear-logout-marker")),
}));

import { login, refreshSession } from "./api";

describe("login identity handoff", () => {
  beforeEach(() => {
    events.length = 0;
    clearOfflineAccess.mockClear();
    announceSessionChange.mockClear();
    vi.restoreAllMocks();
  });

  it("invalidates the previous offline identity before notifying other tabs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Logged in." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await login({ email: "owner@example.com", password: "testing" });

    expect(clearOfflineAccess).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "clear-offline-identity",
      "clear-logout-marker",
      "announce-session-change",
    ]);
  });

  it("distinguishes an expired refresh cookie from a temporarily unavailable server", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));

    await expect(refreshSession()).resolves.toBe(false);
    await expect(refreshSession()).rejects.toMatchObject({ status: 503, message: "Unavailable" });
  });
});
