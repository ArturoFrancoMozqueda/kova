import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ResetPasswordView", () => {
  it("blocks oversized accented passwords and allows correction without expiring the link", async () => {
    const fetchMock = mockFetch(() => new Response(JSON.stringify({ message: "Password updated." }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    renderAt("/reset-password?token=reset-token");
    const password = "A1" + "ñ".repeat(36);
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: password } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: password } });
    expect(screen.getByText(/La contraseña es demasiado larga/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar contraseña/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: "Abc12345" } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "Abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Tu contraseña se actualizó/i);
  });

  it("shows the server byte-limit error without calling the link invalid", async () => {
    mockFetch(() => new Response(JSON.stringify({ detail: [{ type: "password_too_long" }] }), {
      status: 422, headers: { "content-type": "application/json" },
    }));
    renderAt("/reset-password?token=reset-token");
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: "Abc12345" } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "Abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/La contraseña es demasiado larga/i);
    expect(screen.getByRole("button", { name: /Guardar contraseña/i })).toBeEnabled();
  });

  it("opens a new token as a fresh form after a previous link expired", async () => {
    const fetchMock = mockFetch((_input, init) => {
      const valid = JSON.parse(String(init?.body)).token === "new-token";
      return new Response(JSON.stringify(valid ? { message: "Password updated." } : { detail: "Invalid or expired reset token" }), {
        status: valid ? 200 : 400, headers: { "content-type": "application/json" },
      });
    });
    render(
      <MemoryRouter initialEntries={["/reset-password?token=expired-token"]}>
        <Link to="/reset-password?token=new-token">Abrir enlace nuevo</Link>
        <Routes><Route path="/reset-password" element={<ResetPasswordView />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: "abc12345" } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("link", { name: "Abrir enlace nuevo" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Nueva contraseña/i)).toHaveValue("");
    expect(screen.getByLabelText(/Confirma la contraseña/i)).toHaveValue("");
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: "abc12345" } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ token: "new-token", new_password: "abc12345" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Tu contraseña se actualizó/i);
  });

  it("ignores a successful previous token response after opening a new link", async () => {
    vi.useFakeTimers();
    let finishOld!: (response: Response) => void;
    mockFetch(() => new Promise<Response>((resolve) => { finishOld = resolve; }));
    render(
      <MemoryRouter initialEntries={["/reset-password?token=old-token"]}>
        <Link to="/reset-password?token=new-token">Abrir enlace nuevo</Link>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordView />} />
          <Route path="/login" element={<div>login</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: "abc12345" } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));
    fireEvent.click(screen.getByRole("link", { name: "Abrir enlace nuevo" }));
    await act(async () => {
      finishOld(new Response(JSON.stringify({ message: "Password updated." }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("login")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Nueva contraseña/i)).toHaveValue("");
  });

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
    expect(screen.getByRole("alert")).toHaveTextContent(/El enlace ya expiró/i);
    expect(screen.getByRole("link", { name: /Pedir un enlace nuevo/i })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("button", { name: /Guardar contraseña/i })).toBeDisabled();
  });

  it("allows retry after a temporary service failure", async () => {
    mockFetch(() => new Response("Internal details", { status: 500 }));
    renderAt("/reset-password?token=reset-token");
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: "abc12345" } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));

    expect(await screen.findByRole("alert")).not.toHaveTextContent(/El enlace ya expiró/i);
    expect(screen.getByRole("button", { name: /Guardar contraseña/i })).toBeEnabled();
    expect(screen.queryByText("Internal details")).not.toBeInTheDocument();
  });

  it.each([false, true])("redirects only while the success screen remains mounted (leave=%s)", async (leave) => {
    vi.useFakeTimers();
    mockFetch(() => new Response(JSON.stringify({ message: "Password updated." }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    render(
      <MemoryRouter initialEntries={["/reset-password?token=reset-token"]}>
        <Link to="/catalog">Abrir catálogo</Link>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordView />} />
          <Route path="/login" element={<div>login</div>} />
          <Route path="/catalog" element={<div>catálogo abierto</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), { target: { value: "abc12345" } });
    fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar contraseña/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("status")).toHaveTextContent(/Tu contraseña se actualizó/i);

    if (leave) fireEvent.click(screen.getByRole("link", { name: "Abrir catálogo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.getByText(leave ? "catálogo abierto" : "login")).toBeInTheDocument();
    expect(screen.queryByText(leave ? "login" : "catálogo abierto")).not.toBeInTheDocument();
  });
});
