import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";

import SettingsView from "./SettingsView";
import {
  getAccountDeletionStatus,
  getBusinessProfile,
  getReceiptSettings,
  listEmployees,
  listInvitations,
} from "./api";

const authMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setTenantLogoUrl: vi.fn(),
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: {
        id: "user-1",
        email: "owner@example.com",
        tenant_id: "tenant-1",
        role: "owner",
      },
      tenantId: "tenant-1",
      tenantName: "Sweet Home",
      tenantLogoUrl: null,
      featureFlags: {},
    },
    refresh: authMocks.refresh,
    setTenantLogoUrl: authMocks.setTenantLogoUrl,
  }),
}));

vi.mock("./api", () => ({
  cancelAccountDeletion: vi.fn(),
  deactivateEmployee: vi.fn(),
  deleteReceiptLogo: vi.fn(),
  downloadAccountExport: vi.fn(),
  getAccountDeletionStatus: vi.fn(),
  getBusinessProfile: vi.fn(),
  getReceiptSettings: vi.fn(),
  inviteEmployee: vi.fn(),
  listEmployees: vi.fn(),
  listInvitations: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  saveBusinessProfile: vi.fn(),
  saveReceiptSettings: vi.fn(),
  scheduleAccountDeletion: vi.fn(),
  updateEmployeeRole: vi.fn(),
  uploadReceiptLogo: vi.fn(),
}));

function renderSettings(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <SettingsView />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("SettingsView business logo placement", () => {
  beforeEach(() => {
    vi.mocked(getBusinessProfile).mockResolvedValue({
      tenant_id: "tenant-1",
      public_name: "Sweet Home",
      support_email: null,
      support_phone: null,
      timezone: "America/Mexico_City",
      locale: "es-MX",
      currency: "MXN",
    });
    vi.mocked(getReceiptSettings).mockResolvedValue({
      tenant_id: "tenant-1",
      receipt_business_name: "Sweet Home",
      footer: null,
      tax_contact_text: null,
      logo_url: null,
    });
    vi.mocked(listEmployees).mockResolvedValue([]);
    vi.mocked(listInvitations).mockResolvedValue([]);
    vi.mocked(getAccountDeletionStatus).mockResolvedValue({
      status: "none",
      requested_at: null,
      purge_after: null,
    });
  });

  it("shows the business logo control in Perfil", async () => {
    renderSettings("/settings/business-profile");

    expect(await screen.findByText(copy.settings.logoUploadLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.settings.logoUploadLabel)).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp",
    );
  });

  it("does not show the upload control in Recibo", async () => {
    renderSettings("/settings/receipt");

    expect(await screen.findByText(copy.settings.receiptSettings)).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.settings.logoUploadLabel)).not.toBeInTheDocument();
  });
});
