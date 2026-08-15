import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";

import SettingsView from "./SettingsView";
import { getBusinessProfile, getReceiptSettings, listEmployees, listInvitations } from "./api";

const authState = vi.hoisted(() => ({ role: "owner", enabled: true }));
const fiscalPanel = vi.hoisted(() => vi.fn());

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: authState.role },
      tenantId: "tenant-1",
      tenantName: "Kova Test",
      tenantLogoUrl: null,
      featureFlags: { fiscal_global_drafts: authState.enabled },
    },
    refresh: vi.fn(),
    setTenantLogoUrl: vi.fn(),
  }),
}));

vi.mock("@/fiscal/FiscalGlobalDraftsPanel", () => ({
  FiscalGlobalDraftsPanel: (props: { role: string }) => {
    fiscalPanel(props);
    return <div>Panel fiscal focal</div>;
  },
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    getAccountDeletionStatus: vi.fn().mockResolvedValue({ status: "none", requested_at: null, purge_after: null }),
    getBusinessProfile: vi.fn(),
    getReceiptSettings: vi.fn(),
    listEmployees: vi.fn(),
    listInvitations: vi.fn(),
  };
});

function renderSettings(path = "/settings/fiscal") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <SettingsView />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("SettingsView fiscal feature gate", () => {
  beforeEach(() => {
    authState.role = "owner";
    authState.enabled = true;
    fiscalPanel.mockClear();
    vi.mocked(getBusinessProfile).mockResolvedValue({
      tenant_id: "tenant-1",
      public_name: "Kova Test",
      support_email: null,
      support_phone: null,
      timezone: "America/Mexico_City",
      locale: "es-MX",
      currency: "MXN",
    });
    vi.mocked(getReceiptSettings).mockResolvedValue({
      tenant_id: "tenant-1",
      receipt_business_name: "Kova Test",
      footer: null,
      tax_contact_text: null,
      logo_url: null,
      paper_width_mm: 80,
    });
    vi.mocked(listEmployees).mockResolvedValue([]);
    vi.mocked(listInvitations).mockResolvedValue([]);
  });

  it("shows the focal tab for an enabled owner", async () => {
    renderSettings();

    expect(await screen.findByText("Panel fiscal focal")).toBeVisible();
    expect(screen.getByRole("link", { name: copy.settings.tabFiscal })).toBeVisible();
    expect(fiscalPanel).toHaveBeenCalledWith({ role: "owner" });
  });

  it("allows enabled managers to consult the panel", async () => {
    authState.role = "manager";
    renderSettings();

    expect(await screen.findByText("Panel fiscal focal")).toBeVisible();
    expect(fiscalPanel).toHaveBeenCalledWith({ role: "manager" });
  });

  it("does not mount or request the focal panel on direct access when the flag is off", async () => {
    authState.enabled = false;
    renderSettings();

    expect(await screen.findByText(copy.settings.businessProfile)).toBeVisible();
    expect(screen.queryByRole("link", { name: copy.settings.tabFiscal })).not.toBeInTheDocument();
    expect(screen.queryByText("Panel fiscal focal")).not.toBeInTheDocument();
    expect(fiscalPanel).not.toHaveBeenCalled();
  });

  it("keeps the focal navigation hidden from cashiers", async () => {
    authState.role = "cashier";
    renderSettings();

    expect(await screen.findByText(copy.settings.businessProfile)).toBeVisible();
    expect(screen.queryByRole("link", { name: copy.settings.tabFiscal })).not.toBeInTheDocument();
    expect(fiscalPanel).not.toHaveBeenCalled();
  });
});
