import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

const captureException = vi.fn();
const recoverStaleAsset = vi.fn();
const reloadStaleAssets = vi.fn().mockResolvedValue(undefined);
let reloadSafe = true;

vi.mock("@sentry/react", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

vi.mock("./staleAssetRecovery", () => ({
  recoverStaleAsset: (...args: unknown[]) =>
    recoverStaleAsset(...args) ?? reloadSafe,
  reloadStaleAssets: () => reloadStaleAssets(),
}));

function ThrowingChild({ error }: { error: Error }): ReactElement {
  throw error;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    captureException.mockClear();
    recoverStaleAsset.mockReset();
    recoverStaleAsset.mockImplementation(() => reloadSafe);
    reloadSafe = true;
  });

  it("reloads once for stale asset errors on safe routes", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingChild
          error={
            new Error("Unable to preload CSS for /assets/IntroAnimation.css")
          }
        />
      </ErrorBoundary>,
    );

    expect(recoverStaleAsset).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps the fallback and reports stale asset errors on unsafe routes", async () => {
    reloadSafe = false;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { getByRole } = render(
      <ErrorBoundary>
        <ThrowingChild
          error={
            new TypeError(
              "Failed to fetch dynamically imported module: https://kovasuite.com/assets/Home.js",
            )
          }
        />
      </ErrorBoundary>,
    );

    expect(recoverStaleAsset).toHaveBeenCalledTimes(1);
    // Reporting is deferred: reportError loads Sentry on demand and flushes
    // its queue once the module resolves, so the capture lands a tick later.
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
    expect(getByRole("alert")).toBeInTheDocument();
    expect(
      getByRole("heading", { name: "Actualiza Kova para continuar" }),
    ).toBeVisible();
    fireEvent.click(getByRole("button", { name: "Recargar" }));
    expect(reloadStaleAssets).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
