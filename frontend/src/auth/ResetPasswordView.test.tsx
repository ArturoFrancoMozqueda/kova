import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResetPasswordView from "./ResetPasswordView";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordView />} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ResetPasswordView", () => {
  it("blocks weak passwords before submitting the reset token", () => {
    const fetchMock = mockFetch(() => new Response("", { status: 500 }));
    renderAt("/reset-password?token=reset-token");

    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), {
      target: { value: "abcdefgh" },
    });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), {
      target: { value: "abcdefgh" },
    });

    expect(screen.getByText(/Incluye al menos una letra y un número/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Guardar contraseña/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the invalid-link message only for backend token failures", async () => {
    mockFetch((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/auth/password-reset/confirm") && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: "Invalid or expired reset token" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    });
    renderAt("/reset-password?token=reset-token");

    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), {
      target: { value: "abc12345" },
    });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), {
      target: { value: "abc12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));

    await waitFor(() =>
      expect(screen.getByText(/El enlace ya expiró o no es válido/i)).toBeTruthy(),
    );
  });
});
