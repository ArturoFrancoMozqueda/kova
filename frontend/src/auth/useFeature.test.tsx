import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./AuthContext";
import { getSession } from "./api";
import { useFeature } from "./useFeature";
import { getReceiptSettings } from "@/settings/api";

vi.mock("./api", () => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/settings/api", () => ({
  getReceiptSettings: vi.fn(),
}));

function FeatureProbe() {
  return <div>{useFeature("margin_reports") ? "enabled" : "disabled"}</div>;
}

describe("useFeature", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(getReceiptSettings).mockResolvedValue({
      tenant_id: "tenant-1",
      receipt_business_name: "Kova Test",
      footer: null,
      tax_contact_text: null,
      logo_url: null,
    });
  });

  it("reads a supported flag from the authenticated tenant session", async () => {
    vi.mocked(getSession).mockResolvedValue({
      authenticated: true,
      user: {
        id: "user-1",
        email: "owner@example.com",
        tenant_id: "tenant-1",
        role: "owner",
      },
      tenant_id: "tenant-1",
      tenant_name: "Kova Test",
      feature_flags: { margin_reports: true },
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <FeatureProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("enabled")).toBeInTheDocument();
  });
});
