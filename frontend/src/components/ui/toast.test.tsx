import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./toast";
import { copy } from "@/i18n/messages";

const captureException = vi.fn();
vi.mock("@sentry/react", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

function fireUnhandledRejection(reason: unknown) {
  // jsdom doesn't construct PromiseRejectionEvent, so dispatch a CustomEvent
  // carrying a `reason`, which the listener reads off the event.
  const event = new Event("unhandledrejection") as Event & { reason?: unknown };
  event.reason = reason;
  act(() => {
    window.dispatchEvent(event);
  });
}

describe("global unhandledrejection handler", () => {
  afterEach(() => {
    captureException.mockClear();
  });

  it("reports to Sentry and shows a generic toast", async () => {
    render(
      <ToastProvider>
        <div>app</div>
      </ToastProvider>,
    );

    const reason = new Error("boom");
    fireUnhandledRejection(reason);

    expect(captureException).toHaveBeenCalledWith(reason);
    expect(await screen.findByText(copy.errors.unexpected)).toBeInTheDocument();
  });

  it("throttles repeated rejections to a single toast", async () => {
    render(
      <ToastProvider>
        <div>app</div>
      </ToastProvider>,
    );

    fireUnhandledRejection(new Error("one"));
    fireUnhandledRejection(new Error("two"));
    fireUnhandledRejection(new Error("three"));

    // Every rejection is reported, but only one toast is shown within the
    // 5s throttle window.
    expect(captureException).toHaveBeenCalledTimes(3);
    await waitFor(() =>
      expect(screen.getAllByText(copy.errors.unexpected)).toHaveLength(1),
    );
  });
});
