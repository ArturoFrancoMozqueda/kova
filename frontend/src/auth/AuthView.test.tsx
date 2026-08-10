import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import AuthView from "./AuthView";
import { AuthProvider } from "./AuthContext";

const telemetry = vi.hoisted(() => ({
  queueFunnelEvent: vi.fn(),
  trackAnonymousEvent: vi.fn().mockResolvedValue(undefined),
  trackSignupValidationFailed: vi.fn().mockResolvedValue(undefined),
  funnelClientHeaders: vi.fn(() => ({ "X-Kova-Client-Id": "client-123" })),
}));

vi.mock("@/telemetry/funnel", () => telemetry);

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
  vi.clearAllMocks();
});

describe("AuthView signup recovery flows", () => {
  // Behaviour change (2026-08): the browser used to fire `signup_completed`
  // itself. Production accumulated ~48 of those events against 2 accounts
  // actually created, because the anonymous endpoint accepts anything shaped
  // like a funnel event. The server now records the rung from inside the signup
  // transaction, and the client only forwards the pseudonymous stitching id.
  // See docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md.
  it("hands the funnel id to the server instead of asserting its own conversion", async () => {
    const fetchMock = mockFetch((input, init) => {
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
            message: "created",
            reason: "account_created",
            user_id: "user-secret",
            tenant_id: "tenant-secret",
            dev_verification_token: "token",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/auth/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ message: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta/i }));

    const signupCall = async () =>
      fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes("/api/v1/auth/signup") &&
          (init as RequestInit | undefined)?.method === "POST",
      );

    await waitFor(async () => expect(await signupCall()).toBeTruthy());
    const call = await signupCall();
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Kova-Client-Id"]).toBe("client-123");
    expect(telemetry.trackAnonymousEvent).not.toHaveBeenCalledWith("signup_completed");
  });

  // Verification is no longer a wall in front of the product: a third of all
  // historical signups never confirmed their address and therefore never got in.
  // The account now signs straight in; verification is enforced at the paid
  // boundary and nagged by a persistent banner.
  it("signs the new owner in instead of parking them on a check-your-email screen", async () => {
    const fetchMock = mockFetch((input, init) => {
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
            message: "created",
            reason: "account_created",
            user_id: "user-secret",
            tenant_id: "tenant-secret",
            dev_verification_token: "token",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/auth/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ message: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).includes("/api/v1/auth/login") &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("maps a password 422 to the password field, focuses it, and records only categories", async () => {
    mockFetch((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/auth/session")) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      if (url.includes("/api/v1/auth/signup") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            detail: [{ loc: ["body", "password"], type: "string_too_short" }],
          }),
          { status: 422 },
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
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta/i }));

    await waitFor(() =>
      expect(telemetry.trackSignupValidationFailed).toHaveBeenCalledWith(
        "password",
        "too_short",
      ),
    );
    const password = screen.getByLabelText(/Contraseña/i);
    expect(password).toBe(document.activeElement);
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe(
      "password-requirements password-error",
    );
    expect(screen.getByText(/debe tener al menos 8 caracteres/i)).toBeTruthy();
    expect(screen.getByLabelText(/Correo/i).getAttribute("aria-invalid")).toBeNull();
  });

  it("maps every supported FastAPI location and focuses the first invalid field", async () => {
    mockFetch((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/auth/session")) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      if (url.includes("/api/v1/auth/signup") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            detail: [
              { loc: ["body", "tenant_name"], type: "string_too_long" },
              { loc: ["body", "email"], type: "value_error" },
              { loc: ["body", "password"], type: "value_error" },
            ],
          }),
          { status: 422 },
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
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta/i }));

    await screen.findByText(/120 caracteres o menos/i);
    expect(screen.getByText(/no parece una dirección válida/i)).toBeTruthy();
    expect(screen.getByText(/Incluye al menos una letra y un número/i)).toBeTruthy();
    expect(screen.getByLabelText(/Nombre del negocio/i)).toBe(document.activeElement);
    expect(telemetry.trackSignupValidationFailed).toHaveBeenCalledWith(
      "business",
      "too_long",
    );
    expect(telemetry.trackSignupValidationFailed).toHaveBeenCalledWith(
      "email",
      "invalid_format",
    );
    expect(telemetry.trackSignupValidationFailed).toHaveBeenCalledWith(
      "password",
      "weak_password",
    );
  });

  it("shows the backend-aligned password rules and trial trust copy before submit", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderAt("/signup");

    const password = await screen.findByLabelText(/Contraseña/i);
    expect(password.getAttribute("minlength")).toBe("8");
    expect(password.getAttribute("maxlength")).toBe("128");
    expect(password.getAttribute("pattern")).toBe(
      "(?=.*[A-Za-z])(?=.*[0-9]).{8,128}",
    );
    expect(
      screen.getByText("8 caracteres, al menos una letra y un número"),
    ).toBeTruthy();
    expect(
      screen.getByText("7 días gratis. Sin tarjeta para empezar."),
    ).toBeTruthy();
  });

  it("blocks a weak password in the browser and reports only its category", async () => {
    const fetchMock = mockFetch(() =>
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderAt("/signup");
    fireEvent.change(screen.getByLabelText(/Nombre del negocio/i), {
      target: { value: "Sweet Home" },
    });
    fireEvent.change(screen.getByLabelText(/Correo/i), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta/i }));

    await waitFor(() =>
      expect(telemetry.trackSignupValidationFailed).toHaveBeenCalledWith(
        "password",
        "weak_password",
      ),
    );
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        input.toString().includes("/api/v1/auth/signup") && init?.method === "POST",
      ),
    ).toBe(false);
  });

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
    fireEvent.click(screen.getByRole("checkbox"));
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
    fireEvent.click(screen.getByRole("checkbox"));
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

  it("keeps the submit button disabled until the terms checkbox is checked", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderAt("/signup");

    const submit = await screen.findByRole("button", { name: /Crear cuenta/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("announces a failed login and marks the credential fields invalid", async () => {
    mockFetch((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/auth/session")) {
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/auth/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: "Invalid credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    });

    renderAt("/login");

    fireEvent.change(screen.getByLabelText(/Correo/i), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: "wrong-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Correo o contraseña incorrectos.");

    const email = screen.getByLabelText(/Correo/i);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe("auth-error");
    expect(screen.getByLabelText(/Contraseña/i).getAttribute("aria-invalid")).toBe("true");
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

  it("has no axe violations on the login form", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { container } = renderAt("/login");
    await screen.findByLabelText(/Correo/i);

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
