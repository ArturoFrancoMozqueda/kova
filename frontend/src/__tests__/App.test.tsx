import { fireEvent, render, screen } from "@testing-library/react";
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

  it("lands on register after a successful login", async () => {
    window.history.pushState(null, "", "/login");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Logged in." }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: "user-1",
              email: "owner@example.com",
              tenant_id: "tenant-1",
              role: "owner",
            },
            tenant_id: "tenant-1",
            tenant_name: "Testing",
          }),
          { status: 200 },
        ),
      );

    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: /email/i }), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "testing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));

    expect(await screen.findByRole("heading", { name: /register/i })).toBeInTheDocument();
  });
});
