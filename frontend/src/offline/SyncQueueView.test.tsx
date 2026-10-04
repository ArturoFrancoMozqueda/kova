import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import type { OfflineSaleQueueItem } from "./types";
import type { CachedCatalog } from "./catalogCache";

const queueState = vi.hoisted(() => ({
  quarantinedCount: 0,
  discardQuarantined: vi.fn(),
  failedEntries: [] as OfflineSaleQueueItem[],
  tenantId: "tenant-1",
}));

vi.mock("./useSyncQueue", () => ({
  useSyncQueue: () => ({
    pendingCount: 0,
    failedEntries: queueState.failedEntries,
    quarantinedCount: queueState.quarantinedCount,
    syncNow: vi.fn(),
    retryDeadLetter: vi.fn(),
    discardQuarantined: queueState.discardQuarantined,
  }),
  useIsOnline: () => true,
}));
vi.mock("./catalogCache", () => ({ readCatalogCache: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "authenticated", tenantId: queueState.tenantId } }),
}));

import SyncQueueView from "./SyncQueueView";
import { readCatalogCache } from "./catalogCache";

describe("SyncQueueView", () => {
  beforeEach(() => {
    queueState.quarantinedCount = 0;
    queueState.failedEntries = [];
    queueState.tenantId = "tenant-1";
    queueState.discardQuarantined.mockReset().mockResolvedValue(0);
    vi.mocked(readCatalogCache).mockReset().mockResolvedValue(undefined);
  });

  it.each(["pending", "missing"])("hides previous tenant product names while the new cache is %s", async (cacheState) => {
    queueState.failedEntries = [{
      client_uuid: "sale-a", tenant_id: "tenant-1", status: "failed",
      sale: { items: [{ product_id: "product-1", quantity: 1 }], payments: [{ method: "cash", amount: "18.50" }] },
      attempt_count: 1, created_at: "2026-10-04T12:00:00Z", updated_at: "2026-10-04T12:00:00Z",
    }];
    let resolveNextCache!: (value: CachedCatalog | undefined) => void;
    const nextCache = new Promise<CachedCatalog | undefined>((resolve) => { resolveNextCache = resolve; });
    vi.mocked(readCatalogCache)
      .mockResolvedValueOnce({
        tenant_id: "tenant-1", categories: [], cached_at: "2026-10-04T12:00:00Z",
        products: [{ id: "product-1", name: "Producto privado A" }] as CachedCatalog["products"],
      })
      .mockReturnValueOnce(nextCache);
    const { rerender } = render(<MemoryRouter><SyncQueueView /></MemoryRouter>);
    expect(await screen.findByText("1x Producto privado A")).toBeVisible();

    queueState.tenantId = "tenant-2";
    queueState.failedEntries = [{ ...queueState.failedEntries[0], tenant_id: "tenant-2", client_uuid: "sale-b" }];
    rerender(<MemoryRouter><SyncQueueView /></MemoryRouter>);
    expect(screen.queryByText("1x Producto privado A")).not.toBeInTheDocument();
    expect(screen.getByText(`1x ${copy.syncQueue.unknownProduct}`)).toBeVisible();

    await act(async () => resolveNextCache(cacheState === "missing" ? undefined : {
      tenant_id: "tenant-2", categories: [], cached_at: "2026-10-04T12:00:00Z",
      products: [{ id: "product-1", name: "Producto B" }] as CachedCatalog["products"],
    }));
    expect(screen.queryByText("1x Producto privado A")).not.toBeInTheDocument();
    expect(screen.getByText(cacheState === "missing" ? `1x ${copy.syncQueue.unknownProduct}` : "1x Producto B")).toBeVisible();
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

  it("requires explicit reconciliation confirmation before deleting legacy rows", async () => {
    queueState.quarantinedCount = 2;
    queueState.discardQuarantined.mockResolvedValue(2);
    render(
      <MemoryRouter>
        <SyncQueueView />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: copy.syncQueue.quarantineDiscard }));
    expect(queueState.discardQuarantined).not.toHaveBeenCalled();
    expect(screen.getByText(copy.syncQueue.quarantineDiscardBody(2))).toBeVisible();

    fireEvent.click(screen.getByRole("button", {
      name: copy.syncQueue.quarantineDiscardConfirm,
    }));
    await waitFor(() => expect(queueState.discardQuarantined).toHaveBeenCalledOnce());
  });
});
