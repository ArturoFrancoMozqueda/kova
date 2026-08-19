import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RequireInternalAdmin from "./RequireInternalAdmin";
import { ApiError } from "./api";

const getOpsMe = vi.fn();
const useAuth = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, getOpsMe: () => getOpsMe() };
});
vi.mock("@/auth/useAuth", () => ({ useAuth: () => useAuth() }));

function renderGuard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/internal/ops"]}>
        <Routes>
          <Route
            path="/internal/ops"
            element={
              <RequireInternalAdmin>
                <div>SECRET OPS</div>
              </RequireInternalAdmin>
            }
          />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireInternalAdmin", () => {
  beforeEach(() => {
    getOpsMe.mockReset();
    useAuth.mockReset();
  });

  it("redirects to login when unauthenticated", async () => {
    useAuth.mockReturnValue({ state: { status: "unauthenticated" } });
    renderGuard();
    expect(await screen.findByText("LOGIN PAGE")).toBeInTheDocument();
    expect(screen.queryByText("SECRET OPS")).not.toBeInTheDocument();
  });

  it("shows a non-sensitive loading state while auth resolves", () => {
    useAuth.mockReturnValue({ state: { status: "loading" } });
    renderGuard();
    expect(screen.getByLabelText("Validando acceso")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("SECRET OPS")).not.toBeInTheDocument();
  });

  it("renders children for an allowlisted admin", async () => {
    useAuth.mockReturnValue({ state: { status: "authenticated" } });
    getOpsMe.mockResolvedValue({ email: "ceo@kova.mx", is_internal_admin: true });
    renderGuard();
    expect(await screen.findByText("SECRET OPS")).toBeInTheDocument();
  });

  it("renders NotFound (not children) on 403", async () => {
    useAuth.mockReturnValue({ state: { status: "authenticated" } });
    getOpsMe.mockRejectedValue(new ApiError("forbidden", 403));
    renderGuard();
    // NotFound heading comes from shared copy; SECRET must never show.
    await waitFor(() => expect(screen.queryByText("SECRET OPS")).not.toBeInTheDocument());
    expect(screen.queryByText("LOGIN PAGE")).not.toBeInTheDocument();
  });

  it("redirects to login on 401", async () => {
    useAuth.mockReturnValue({ state: { status: "authenticated" } });
    getOpsMe.mockRejectedValue(new ApiError("unauth", 401));
    renderGuard();
    expect(await screen.findByText("LOGIN PAGE")).toBeInTheDocument();
  });
});
