import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState(null, "", "/");
});

describe("App shell", () => {
  it("redirects unauthenticated users to login", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: /log in/i })).toBeInTheDocument();
  });
});
