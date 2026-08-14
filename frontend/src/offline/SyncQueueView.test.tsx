import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";

vi.mock("./useSyncQueue", () => ({
  useSyncQueue: () => ({
    pendingCount: 0,
    failedEntries: [],
    syncNow: vi.fn(),
    retryDeadLetter: vi.fn(),
  }),
  useIsOnline: () => true,
}));
vi.mock("./catalogCache", () => ({ readCatalogCache: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "authenticated", tenantId: "tenant-1" } }),
}));

import SyncQueueView from "./SyncQueueView";

describe("SyncQueueView", () => {
  it("keeps the route title synchronized with navigation", async () => {
    render(
      <MemoryRouter>
        <SyncQueueView />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: copy.syncQueue.title })).toBeVisible();
    await waitFor(() => expect(document.title).toBe(`${copy.syncQueue.title} · Kova`));
  });
});
