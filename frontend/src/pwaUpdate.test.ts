import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isExpectedServiceWorkerError,
  isReloadSafePath,
  isStaleAssetError,
  reportUnexpectedPwaError,
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

  it("does not force reloads on register routes", () => {
    expect(isReloadSafePath("/register")).toBe(false);
    expect(isReloadSafePath("/register?draft=1")).toBe(false);
    expect(isReloadSafePath("/signup")).toBe(true);
  });
});
