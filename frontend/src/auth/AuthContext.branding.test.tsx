import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getReceiptSettings } from "@/settings/api";

import { AuthProvider, useAuthContext } from "./AuthContext";
import { getSession } from "./api";

vi.mock("./api", () => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/settings/api", () => ({
  getReceiptSettings: vi.fn(),
}));

function BrandingProbe() {
  const { state } = useAuthContext();
  return (
    <div>
      {state.status === "authenticated" ? (state.tenantLogoUrl ?? "kova-fallback") : "loading"}
    </div>
  );
}

describe("AuthContext tenant branding", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue({
      authenticated: true,
      user: {
        id: "user-1",
        email: "owner@example.com",
        tenant_id: "tenant-1",
        role: "owner",
      },
      tenant_id: "tenant-1",
      tenant_name: "Sweet Home",
      feature_flags: {},
    });
  });

  it("loads the configured tenant logo after authenticating the shell", async () => {
    vi.mocked(getReceiptSettings).mockResolvedValue({
      tenant_id: "tenant-1",
      receipt_business_name: "Sweet Home",
      footer: null,
      tax_contact_text: null,
      logo_url: "/api/v1/settings/receipt/logo/tenant-1?v=1",
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <BrandingProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("/api/v1/settings/receipt/logo/tenant-1?v=1"),
    ).toBeInTheDocument();
  });

  it("keeps the Kova fallback when the tenant has no configured logo", async () => {
    vi.mocked(getReceiptSettings).mockResolvedValue({
      tenant_id: "tenant-1",
      receipt_business_name: "Sweet Home",
      footer: null,
      tax_contact_text: null,
      logo_url: null,
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <BrandingProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("kova-fallback")).toBeInTheDocument();
  });
});
