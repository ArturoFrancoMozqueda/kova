import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recoverStaleAsset, reloadStaleAssets } from "./staleAssetRecovery";
const reload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pwaUpdate", async (original) => ({
  ...(await original<typeof import("./pwaUpdate")>()),
  forceReload: reload,
}));
const chunkError = new TypeError(
  "Failed to fetch dynamically imported module: https://kovasuite.com/assets/AuthView-previous.js",
);
const unregister = vi.fn().mockResolvedValue(true);
const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistrations },
  });
  getRegistrations.mockResolvedValue([{ unregister }]);
  unregister.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());
it("recovers a fatal login import failure without weakening proactive PWA guards", async () => {
  const { isReloadSafePath } = await import("./pwaUpdate");
  expect(isReloadSafePath("/login")).toBe(false);
  expect(
    recoverStaleAsset(chunkError, "/login?next=/register", "build-a"),
  ).toBe(true);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(unregister).toHaveBeenCalledOnce();
  expect(unregister.mock.invocationCallOrder[0]).toBeLessThan(
    reload.mock.invocationCallOrder[0],
  );
  expect(sessionStorage.length).toBe(1);
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe("build-a");
});
it("keeps the once-per-tab/build bound across a fresh module lifetime", async () => {
  expect(recoverStaleAsset(chunkError, "/login", "build-a")).toBe(true);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  vi.resetModules();
  const fresh = await import("./staleAssetRecovery");
  expect(fresh.recoverStaleAsset(chunkError, "/dashboard", "build-a")).toBe(
    false,
  );
  expect(reload).toHaveBeenCalledOnce();
  expect(fresh.recoverStaleAsset(chunkError, "/login", "build-b")).toBe(true);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  expect(fresh.recoverStaleAsset(chunkError, "/login", "build-a")).toBe(false);
  expect(reload).toHaveBeenCalledTimes(2);
});
it.each([
  "/register",
  "/orders/order-1",
  "/pedidos/new",
  "/catalog",
  "/settings/business-profile",
  "/signup",
  "/reset-password",
])("preserves unsaved-work protection on %s", async (path) => {
  expect(recoverStaleAsset(chunkError, path, "build-a")).toBe(false);
  expect(getRegistrations).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});
it("does not reload offline or for unrelated render failures", () => {
  expect(
    recoverStaleAsset(new Error("Invalid sale state"), "/login", "build-a"),
  ).toBe(false);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  expect(recoverStaleAsset(chunkError, "/login", "build-a")).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});
it.each(["getItem", "setItem"] as const)(
  "keeps manual recovery when storage.%s is unavailable",
  (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    expect(recoverStaleAsset(chunkError, "/login", "build-a")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(getRegistrations).not.toHaveBeenCalled();
  },
);
it("still reloads if worker lookup or unregister fails", async () => {
  getRegistrations.mockRejectedValueOnce(new Error("registration unavailable"));
  await reloadStaleAssets();
  unregister.mockRejectedValueOnce(new Error("unregister unavailable"));
  await reloadStaleAssets();
  expect(reload).toHaveBeenCalledTimes(2);
});
it("does not remove identity, queued data or unrelated storage", async () => {
  sessionStorage.setItem("unsaved-form", "keep");
  localStorage.setItem("offline-sale-test", "keep");
  document.cookie = "test_session=keep; path=/";
  expect(recoverStaleAsset(chunkError, "/login", "build-a")).toBe(true);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(sessionStorage.getItem("unsaved-form")).toBe("keep");
  expect(localStorage.getItem("offline-sale-test")).toBe("keep");
  expect(document.cookie).toContain("test_session=keep");
  localStorage.removeItem("offline-sale-test");
  document.cookie = "test_session=; max-age=0; path=/";
});
