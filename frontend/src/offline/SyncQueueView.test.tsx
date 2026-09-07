import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";

const queueState = vi.hoisted(() => ({ quarantinedCount: 0 }));

vi.mock("./useSyncQueue", () => ({
  useSyncQueue: () => ({
    pendingCount: 0,
    failedEntries: [],
    quarantinedCount: queueState.quarantinedCount,
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
  beforeEach(() => {
    queueState.quarantinedCount = 0;
  });

  it("keeps the route title synchronized with navigation", async () => {
    render(
      <MemoryRouter>
        <SyncQueueView />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: copy.syncQueue.title })).toBeVisible();
    await waitFor(() => expect(document.title).toBe(`${copy.syncQueue.title} · Kova`));
  });

  it("announces legacy recovery without exposing sale payloads or a retry action", async () => {
    queueState.quarantinedCount = 2;
    render(
      <MemoryRouter>
        <SyncQueueView />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: copy.syncQueue.quarantineTitle })).toBeVisible();
    expect(screen.getByText(copy.syncQueue.quarantineBody(2))).toBeVisible();
    expect(screen.getByRole("link", { name: copy.syncQueue.quarantineSupport })).toBeVisible();
    expect(screen.queryByRole("button", { name: copy.syncQueue.retry })).not.toBeInTheDocument();
    expect(screen.queryByText(copy.syncQueue.empty)).not.toBeInTheDocument();
  });
});
