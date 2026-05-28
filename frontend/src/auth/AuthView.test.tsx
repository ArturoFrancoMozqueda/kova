import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthView from "./AuthView";
import { AuthProvider } from "./AuthContext";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/signup" element={<AuthView mode="signup" />} />
          <Route path="/login" element={<AuthView mode="login" />} />
          <Route path="/forgot-password" element={<div>forgot</div>} />
        </Routes>
      </AuthProvider>
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

describe("AuthView signup recovery flows", () => {
  it("shows the 'email in use' panel with login CTA when the API returns email_in_use", async () => {
    mockFetch((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/auth/session")) {
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/auth/signup") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            message: "Email already has an account. Sign in to continue.",
            reason: "email_in_use",
            user_id: null,
            tenant_id: null,
            dev_verification_token: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    });

    renderAt("/signup");

    fireEvent.change(screen.getByLabelText(/Nombre del negocio/i), {
      target: { value: "Sweet Home" },
    });
    fireEvent.change(screen.getByLabelText(/Correo/i), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: "S3cur3pass!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Este correo ya tiene una cuenta en Kova/i),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /Iniciar sesión/i })).toBeTruthy();
  });

  it("shows the 'verification resent' confirmation when the API returns verification_resent", async () => {
    mockFetch((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/auth/session")) {
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/auth/signup") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            message: "Verification email re-sent.",
            reason: "verification_resent",
            user_id: null,
            tenant_id: null,
            dev_verification_token: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    });

    renderAt("/signup");

    fireEvent.change(screen.getByLabelText(/Nombre del negocio/i), {
      target: { value: "Sweet Home" },
    });
    fireEvent.change(screen.getByLabelText(/Correo/i), {
      target: { value: "fatima@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: "S3cur3pass!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Ya tenías una cuenta sin verificar/i),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(/Te reenviamos el correo de verificación a fatima@example.com/i),
    ).toBeTruthy();
  });

  it("prefills the login email from the ?email= query string", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderAt("/login?email=owner%40example.com");

    const input = await screen.findByLabelText(/Correo/i);
    expect((input as HTMLInputElement).value).toBe("owner@example.com");
  });
});
