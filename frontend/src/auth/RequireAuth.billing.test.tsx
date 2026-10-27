import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ role: "owner", mode: "online" }));

vi.mock("./useAuth", () => ({ useAuth: () => ({ state: {
  status: "authenticated", sessionMode: identity.mode,
  user: identity,
  commercialAccess: { allowed: false, reason: "unpaid", valid_until: null },
}, refresh: vi.fn() }) }));

import RequireAuth from "./RequireAuth";

describe("billing route protection", () => {
  beforeEach(() => { identity.role = "owner"; identity.mode = "online"; });
  it.each(["/register", "/reports", "/catalog", "/sync-queue", "/assistant"])("blocks commercial content at %s", (path) => {
    render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path={path} element={<RequireAuth><p>Contenido privado</p></RequireAuth>} />
      <Route path="/settings/billing" element={<p>Activar plan</p>} />
    </Routes></MemoryRouter>);
    expect(screen.getByText("Activar plan")).toBeInTheDocument();
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
  });

  it.each(["/settings/billing", "/settings/billing/success", "/settings/billing/cancel", "/settings/advanced"])("retains payment recovery and account rights at %s", (path) => {
    render(<MemoryRouter initialEntries={[path]}><RequireAuth><p>Recuperar cuenta</p></RequireAuth></MemoryRouter>);
    expect(screen.getByText("Recuperar cuenta")).toBeInTheDocument();
  });

  it("gives blocked employees an owner recovery message without exposing billing", () => {
    identity.role = "cashier";
    render(<MemoryRouter initialEntries={["/register"]}><RequireAuth><p>Contenido privado</p></RequireAuth></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("persona dueña del negocio");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
  });

  it("shows an expired offline grant without redirecting between register and billing", () => {
    identity.mode = "offline";
    render(<MemoryRouter initialEntries={["/register"]}><Routes>
      <Route path="*" element={<RequireAuth><p>Contenido privado</p></RequireAuth>} />
    </Routes></MemoryRouter>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar|verificar|volver/i })).toBeInTheDocument();
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
  });
});
