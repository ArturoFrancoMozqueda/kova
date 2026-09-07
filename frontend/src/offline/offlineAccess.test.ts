import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  accessGet: vi.fn(),
  accessPut: vi.fn(),
  accessDelete: vi.fn(),
  catalogGet: vi.fn(),
}));

vi.mock("./db", () => ({
  offlineDb: {
    offline_access: {
      get: stores.accessGet,
      put: stores.accessPut,
      delete: stores.accessDelete,
    },
    catalog_cache: { get: stores.catalogGet },
  },
}));

import {
  OFFLINE_ACCESS_MAX_AGE_MS,
  cacheVerifiedOfflineAccess,
  clearOfflineAccess,
  readPreparedOfflineAccess,
} from "./offlineAccess";

const session = {
  tenant_id: "tenant-1",
  tenant_name: "Panadería",
  user: {
    id: "user-1",
    tenant_id: "tenant-1",
    role: "owner",
  },
  feature_flags: { customer_orders: true },
};

describe("offline access snapshot", () => {
  beforeEach(() => {
    Object.values(stores).forEach((mock) => mock.mockReset());
  });

  it("stores identity metadata without any cookie or token", async () => {
    await cacheVerifiedOfflineAccess(session, 1_000);

    expect(stores.accessPut).toHaveBeenCalledWith({
      id: "active",
      ...session,
      verified_at: new Date(1_000).toISOString(),
      expires_at: new Date(1_000 + OFFLINE_ACCESS_MAX_AGE_MS).toISOString(),
    });
    expect(JSON.stringify(stores.accessPut.mock.calls[0][0])).not.toMatch(/token|cookie|email/i);
  });

  it("requires an unexpired snapshot and this tenant's cached catalog", async () => {
    stores.accessGet.mockResolvedValue({
      id: "active",
      ...session,
      verified_at: new Date(1_000).toISOString(),
      expires_at: new Date(1_000 + OFFLINE_ACCESS_MAX_AGE_MS).toISOString(),
    });
    stores.catalogGet.mockResolvedValue({ tenant_id: "tenant-1", products: [], categories: [] });

    await expect(readPreparedOfflineAccess(2_000)).resolves.toMatchObject({
      status: "ready",
      snapshot: { tenant_id: "tenant-1", user: { id: "user-1" } },
    });

    stores.catalogGet.mockResolvedValue(undefined);
    await expect(readPreparedOfflineAccess(2_000)).resolves.toEqual({ status: "not_prepared" });
    await expect(readPreparedOfflineAccess(1_000 + OFFLINE_ACCESS_MAX_AGE_MS)).resolves.toEqual({
      status: "expired",
    });
  });

  it("clears the prepared identity on logout", async () => {
    await clearOfflineAccess();
    expect(stores.accessDelete).toHaveBeenCalledWith("active");
  });
});
