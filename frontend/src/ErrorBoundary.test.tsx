import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

const captureException = vi.fn();
const forceReload = vi.fn();
let reloadSafe = true;

vi.mock("@sentry/react", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

vi.mock("./pwaUpdate", () => ({
  forceReload: () => forceReload(),
  isReloadSafePath: () => reloadSafe,
  isStaleAssetError: (error: unknown) =>
    error instanceof Error && /unable to preload css|failed to fetch dynamically imported module/i.test(error.message),
}));

function ThrowingChild({ error }: { error: Error }): ReactElement {
  throw error;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    captureException.mockClear();
    forceReload.mockClear();
    reloadSafe = true;
  });

  it("reloads once for stale asset errors on safe routes", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error("Unable to preload CSS for /assets/IntroAnimation.css")} />
      </ErrorBoundary>,
    );

    expect(forceReload).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps the fallback and reports stale asset errors on unsafe routes", () => {
    reloadSafe = false;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

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

    expect(forceReload).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(getByRole("alert")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
