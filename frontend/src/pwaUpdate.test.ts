import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isExpectedServiceWorkerError,
  isReloadSafePath,
  isStaleAssetError,
  reportUnexpectedPwaError,
  runPwaUpdateAtSafePoint,
  safelyUpdateServiceWorker,
} from "./pwaUpdate";

describe("PWA update helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recognizes expected Safari service worker update failures", () => {
    expect(
      isExpectedServiceWorkerError(
        new TypeError("Cannot update a null/nonexistent service worker registration"),
      ),
    ).toBe(true);
    expect(
      isExpectedServiceWorkerError(
        new Error(
          "AbortError: Failed to update a ServiceWorker for scope ('https://kovasuite.com/') with script ('Unknown'): Operation has been aborted",
        ),
      ),
    ).toBe(true);
    expect(isExpectedServiceWorkerError(new TypeError("Script https://kovasuite.com/sw.js load failed"))).toBe(
      true,
    );
  });

  it("does not report expected service worker update failures to console", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    reportUnexpectedPwaError(
      new TypeError("Cannot update a null/nonexistent service worker registration"),
    );

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps unexpected PWA update failures visible", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("unexpected update failure");

    reportUnexpectedPwaError(error);

    expect(consoleError).toHaveBeenCalledWith("PWA update failed:", error);
  });

  it("catches rejected update promises", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    safelyUpdateServiceWorker(() =>
      Promise.reject(new TypeError("Cannot update a null/nonexistent service worker registration")),
    );
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("recognizes stale deploy asset errors", () => {
    expect(isStaleAssetError(new Error("Unable to preload CSS for /assets/IntroAnimation.css"))).toBe(
      true,
    );
    expect(
      isStaleAssetError(
        new TypeError("Failed to fetch dynamically imported module: https://kovasuite.com/assets/Home.js"),
      ),
    ).toBe(true);
  });

  it("does not force reloads while a sale or refund intent may live in memory", () => {
    expect(isReloadSafePath("/register")).toBe(false);
    expect(isReloadSafePath("/register?draft=1")).toBe(false);
    expect(isReloadSafePath("/orders/order-1")).toBe(false);
    expect(isReloadSafePath("/orders/order-1/")).toBe(false);
    expect(isReloadSafePath("/orders")).toBe(true);
    expect(isReloadSafePath("/dashboard")).toBe(true);
  });

  it("defers reloads on every route that owns a form or mutation intent", () => {
    for (const path of [
      "/catalog",
      "/inventory",
      "/expenses",
      "/pedidos",
      "/pedidos/nuevo",
      "/pedidos/order-1/editar",
      "/shifts",
      "/settings/business-profile",
      "/internal/ops/incidents",
      "/login",
      "/signup",
      "/verify-email?token=secret",
      "/accept-invite",
      "/forgot-password",
      "/reset-password",
    ]) {
      expect(isReloadSafePath(path), path).toBe(false);
    }
    expect(isReloadSafePath("/dashboard")).toBe(true);
    expect(isReloadSafePath("/orders")).toBe(true);
  });

  it("uses the same safe-point guard before every PWA update action", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const available = vi.fn();
    window.addEventListener("pos:pwa-update-available", available);

    expect(runPwaUpdateAtSafePoint(action, "/register")).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(available).toHaveBeenCalledOnce();

    expect(runPwaUpdateAtSafePoint(action, "/orders/order-1")).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(available).toHaveBeenCalledTimes(2);

    expect(runPwaUpdateAtSafePoint(action, "/dashboard")).toBe(true);
    await Promise.resolve();
    expect(action).toHaveBeenCalledOnce();

    window.removeEventListener("pos:pwa-update-available", available);
  });
});
