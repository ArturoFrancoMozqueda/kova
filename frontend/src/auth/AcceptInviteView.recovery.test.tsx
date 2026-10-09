import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AcceptInviteView from "./AcceptInviteView";

const preview = { email: "invitee@example.com", role: "cashier", tenant_name: "Mi negocio", requires_password: true };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function renderInvite(path = "/accept-invite?token=valid-token") {
  return render(<MemoryRouter initialEntries={[path]}>
    <Link to="/accept-invite?token=new-token">Abrir enlace nuevo</Link>
    <Link to="/catalog">Abrir catálogo</Link>
    <Routes>
      <Route path="/accept-invite" element={<AcceptInviteView />} />
      <Route path="/login" element={<div>login abierto</div>} />
      <Route path="/catalog" element={<div>catálogo abierto</div>} />
    </Routes>
  </MemoryRouter>);
}

async function enterPassword() {
  fireEvent.change(await screen.findByLabelText("Nueva contraseña"), { target: { value: "Prueba1234" } });
  fireEvent.change(screen.getByLabelText("Confirma la contraseña"), { target: { value: "Prueba1234" } });
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("invitation recovery", () => {
  it.each(["network", 503, 429])("retries a temporary preview failure (%s) without invalidating the invitation", async (failure) => {
    const fetchMock = vi.fn().mockImplementationOnce(() => {
      if (failure === "network") throw new TypeError("Network failed");
      return Promise.resolve(json({ detail: "Internal details" }, Number(failure)));
    }).mockResolvedValue(json(preview));
    vi.stubGlobal("fetch", fetchMock);
    renderInvite();
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("expiró");
    expect(alert).not.toHaveTextContent("Internal details");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Correo")).toHaveValue(preview.email);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["network", 503, 429])("keeps passwords and allows acceptance retry after a temporary failure (%s)", async (failure) => {
    let posts = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(json(preview));
      if (++posts === 1) {
        if (failure === "network") throw new TypeError("Network failed");
        return Promise.resolve(json({ detail: "Internal details" }, Number(failure)));
      }
      return Promise.resolve(json({ status: "accepted" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderInvite();
    await enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("expiró");
    expect(alert).not.toHaveTextContent("Internal details");
    expect(screen.getByLabelText("Nueva contraseña")).toHaveValue("Prueba1234");
    expect(screen.getByLabelText("Confirma la contraseña")).toHaveValue("Prueba1234");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Tu acceso se activó");
    const bodies = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST").map((call) => call[1]?.body);
    expect(bodies).toEqual([JSON.stringify({ token: "valid-token", password: "Prueba1234" }), JSON.stringify({ token: "valid-token", password: "Prueba1234" })]);
  });

  it.each(["preview", "accept"])("keeps genuine invalid invitation responses terminal (%s)", async (stage) => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve(
      stage === "preview" || init?.method === "POST" ? json({ detail: "Invitation expired" }, 400) : json(preview),
    )));
    renderInvite();
    if (stage === "accept") {
      await enterPassword();
      fireEvent.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    }
    expect(await screen.findByRole("heading", { name: "Invitación no válida" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("keeps a missing token terminal without contacting the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderInvite("/accept-invite");
    expect(screen.getByRole("heading", { name: "Enlace incompleto" })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores pending acceptance of a previous token when opening another invitation", async () => {
    let finishOld!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Promise<Response>((resolve) => { finishOld = resolve; });
      return Promise.resolve(json({ ...preview, email: url.includes("new-token") ? "new@example.com" : preview.email }));
    }));
    renderInvite();
    await enterPassword();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    fireEvent.click(screen.getByRole("link", { name: "Abrir enlace nuevo" }));
    await waitFor(() => expect(screen.getByLabelText("Correo")).toHaveValue("new@example.com"));
    await act(async () => { finishOld(json({ status: "accepted" })); });
    expect(screen.queryByText(/Tu acceso se activó/)).toBeNull();
    expect(screen.getByLabelText("Nueva contraseña")).toHaveValue("");
  });

  it.each([false, true])("redirects only while the invitation success screen remains mounted (leave=%s)", async (leave) => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve(json(init?.method === "POST" ? { status: "accepted" } : preview))));
    renderInvite();
    await enterPassword();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("status")).toHaveTextContent("Tu acceso se activó");
    if (leave) fireEvent.click(screen.getByRole("link", { name: "Abrir catálogo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.getByText(leave ? "catálogo abierto" : "login abierto")).toBeVisible();
    expect(screen.queryByText(leave ? "login abierto" : "catálogo abierto")).toBeNull();
  });
});
