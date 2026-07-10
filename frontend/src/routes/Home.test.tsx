import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trackAnonymousEvent = vi.fn();
const trackAnonymousEventOnce = vi.fn();

vi.mock("@/telemetry/funnel", () => ({
  trackAnonymousEvent: (...args: unknown[]) => trackAnonymousEvent(...args),
  trackAnonymousEventOnce: (...args: unknown[]) => trackAnonymousEventOnce(...args),
}));

// Unauthenticated visitor → primary CTAs point to /signup.
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "unauthenticated" } }),
}));

import Home from "./Home";

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

describe("landing telemetry (PLAN-UX-03)", () => {
  beforeEach(() => {
    trackAnonymousEvent.mockClear();
    trackAnonymousEventOnce.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fires landing_viewed once on mount", () => {
    renderHome();
    expect(trackAnonymousEventOnce).toHaveBeenCalledWith("landing_viewed", "landing_viewed");
  });

  it("fires landing_cta_clicked and signup_started when a primary CTA is clicked", () => {
    renderHome();

    const signupLink = screen
      .getAllByRole("link")
      .find((el) => el.getAttribute("href") === "/signup");
    expect(signupLink).toBeDefined();

    fireEvent.click(signupLink!);

    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "landing_cta_clicked",
      expect.objectContaining({ cta: expect.any(String) }),
    );
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "signup_started",
      expect.objectContaining({ cta: expect.any(String) }),
    );
  });
});
