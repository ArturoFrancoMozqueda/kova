import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import VerifyEmailView from "./VerifyEmailView";

const json = (status = 200) => new Response(JSON.stringify({ message: "QA" }), { status });

function renderVerification(path = "/verify-email?token=qa-first-token", strict = false) {
  const view = <MemoryRouter initialEntries={[path]}>
    <Link to="/verify-email?token=qa-new-token">Abrir enlace nuevo</Link>
    <Link to="/catalog">Abrir catálogo</Link>
    <Routes>
      <Route path="/verify-email" element={<VerifyEmailView />} />
      <Route path="/login" element={<div>login abierto</div>} />
      <Route path="/catalog" element={<div>catálogo abierto</div>} />
    </Routes>
  </MemoryRouter>;
  return render(strict ? <StrictMode>{view}</StrictMode> : view);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("email verification links", () => {
  it("does not consume a single-use link twice during StrictMode effect replay", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json()).mockResolvedValue(json(400));
    vi.stubGlobal("fetch", fetchMock);
    renderVerification(undefined, true);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Correo verificado/i));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ token: "qa-first-token" }));
  });

  it.each(["network", 503, 429])("allows retry after a temporary failure (%s)", async (failure) => {
    const fetchMock = vi.fn().mockImplementationOnce(() => {
      if (failure === "network") throw new TypeError("QA connection unavailable");
      return Promise.resolve(json(Number(failure)));
    }).mockResolvedValue(json());
    vi.stubGlobal("fetch", fetchMock);
    renderVerification();
    expect(await screen.findByRole("alert")).not.toHaveTextContent(/expiró/);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Correo verificado/i));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("takes an expired link to sign-in so the existing account can request another", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400)));
    renderVerification();
    expect(await screen.findByRole("alert")).toHaveTextContent(/expiró/);
    expect(screen.getByRole("link", { name: /Iniciar sesión/i })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("ignores the old link response and verifies the new link independently", async () => {
    let finishOld!: (response: Response) => void;
    let finishNew!: (response: Response) => void;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve) => {
      if (JSON.parse(String(init?.body)).token === "qa-new-token") finishNew = resolve;
      else finishOld = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderVerification();
    fireEvent.click(screen.getByRole("link", { name: "Abrir enlace nuevo" }));
    await act(async () => { finishOld(json()); });
    expect(screen.queryByText(/Correo verificado/i)).not.toBeInTheDocument();
    await act(async () => { finishNew(json(400)); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/expiró/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("redirects only while the success screen is mounted (leave=%s)", async (leave) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json()));
    renderVerification();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("status")).toHaveTextContent(/Correo verificado/i);
    if (leave) fireEvent.click(screen.getByRole("link", { name: "Abrir catálogo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.getByText(leave ? "catálogo abierto" : "login abierto")).toBeVisible();
    expect(screen.queryByText(leave ? "login abierto" : "catálogo abierto")).not.toBeInTheDocument();
  });

  it.each(["/verify-email", "/verify-email?token=%20%20"])("does not submit an incomplete link (%s)", (path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderVerification(path);
    expect(screen.getByRole("alert")).toHaveTextContent(/incompleto/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
