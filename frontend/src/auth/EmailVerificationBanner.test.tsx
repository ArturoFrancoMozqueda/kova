import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailVerificationBanner } from "./EmailVerificationBanner";
import type { AuthUser } from "./AuthContext";

const auth = vi.hoisted(() => ({ state: null as unknown }));

vi.mock("./useAuth", () => ({
  useOptionalAuth: () => (auth.state ? { state: auth.state } : null),
}));

const resendVerificationEmail = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ resendVerificationEmail }));

function authenticatedAs(user: Partial<AuthUser>) {
  auth.state = {
    status: "authenticated",
    user: {
      id: "u1",
      email: "duena@negocio.com",
      tenant_id: "t1",
      role: "owner",
      ...user,
    },
  };
}

afterEach(() => {
  auth.state = null;
  vi.clearAllMocks();
});

describe("EmailVerificationBanner", () => {
  it("stays out of the way for a verified account", () => {
    authenticatedAs({ email_verified: true });
    render(<EmailVerificationBanner />);
    expect(screen.queryByTestId("email-verification-banner")).not.toBeInTheDocument();
  });

  // The flag is optional: a session probe served by an older backend must not
  // nag someone who verified months ago.
  it("treats a missing flag as verified", () => {
    authenticatedAs({});
    render(<EmailVerificationBanner />);
    expect(screen.queryByTestId("email-verification-banner")).not.toBeInTheDocument();
  });

  it("nags an unverified account and names the address the link went to", () => {
    authenticatedAs({ email_verified: false });
    render(<EmailVerificationBanner />);
    expect(screen.getByTestId("email-verification-banner")).toBeInTheDocument();
    expect(screen.getByText(/duena@negocio\.com/)).toBeInTheDocument();
  });

  it("resends the verification email and confirms it went out", async () => {
    authenticatedAs({ email_verified: false });
    resendVerificationEmail.mockResolvedValue({ message: "ok" });
    render(<EmailVerificationBanner />);

    fireEvent.click(screen.getByRole("button", { name: /Reenviar correo/i }));

    await waitFor(() => expect(resendVerificationEmail).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Correo enviado/i)).toBeInTheDocument();
  });

  it("offers a retry instead of failing silently", async () => {
    authenticatedAs({ email_verified: false });
    resendVerificationEmail.mockRejectedValue(new Error("network"));
    render(<EmailVerificationBanner />);

    fireEvent.click(screen.getByRole("button", { name: /Reenviar correo/i }));

    expect(await screen.findByRole("button", { name: /Intentar de nuevo/i })).toBeInTheDocument();
  });

  it("renders nothing when there is no auth provider around it", () => {
    render(<EmailVerificationBanner />);
    expect(screen.queryByTestId("email-verification-banner")).not.toBeInTheDocument();
  });
});
