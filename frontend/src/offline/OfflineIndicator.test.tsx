import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineIndicator } from "./OfflineIndicator";
import { copy } from "../i18n/messages";

const queue = vi.hoisted(() => ({ pendingCount: 0, failedEntries: [] as unknown[], quarantinedCount: 0 }));
vi.mock("./useSyncQueue", () => ({ useIsOnline: () => true, useSyncQueue: () => queue }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: { status: "authenticated" } }) }));

describe("OfflineIndicator failed sales", () => {
  beforeEach(() => {
    queue.pendingCount = 0;
    queue.failedEntries = [];
    queue.quarantinedCount = 0;
  });

  it.each([true, false])("links to failed sales even with no pending entries (compact: %s)", (compact) => {
    queue.failedEntries = [{ client_uuid: "failed-sale" }];
    render(<MemoryRouter><OfflineIndicator compact={compact} showOnlineLabel /></MemoryRouter>);

    expect(screen.getByRole("link", { name: `${copy.syncQueue.failed}: 1` })).toHaveAttribute("href", "/sync-queue");
    expect(screen.queryByText("Sincronizado")).not.toBeInTheDocument();
  });

  it.each(["pending", "quarantined"])("does not claim synchronization while %s sales need review", (status) => {
    if (status === "pending") queue.pendingCount = 1;
    else queue.quarantinedCount = 1;
    render(<MemoryRouter><OfflineIndicator compact showOnlineLabel /></MemoryRouter>);

    expect(screen.getByText("Conectado")).toBeVisible();
    expect(screen.queryByText("Sincronizado")).not.toBeInTheDocument();
  });

  it("shows synchronization only after the queue is clear", () => {
    render(<MemoryRouter><OfflineIndicator compact showOnlineLabel /></MemoryRouter>);
    expect(screen.getByText("Sincronizado")).toBeVisible();
  });
});
