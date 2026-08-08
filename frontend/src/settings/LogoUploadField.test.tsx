import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";

import { LogoUploadField } from "./LogoUploadField";

const mocks = vi.hoisted(() => ({
  deleteReceiptLogo: vi.fn(),
  getReceiptSettings: vi.fn(),
  setTenantLogoUrl: vi.fn(),
  uploadReceiptLogo: vi.fn(),
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ setTenantLogoUrl: mocks.setTenantLogoUrl }),
}));

vi.mock("@/lib/compressImage", () => ({
  compressImage: vi.fn(async (file: File) => file),
}));

vi.mock("./api", () => ({
  deleteReceiptLogo: mocks.deleteReceiptLogo,
  getReceiptSettings: mocks.getReceiptSettings,
  uploadReceiptLogo: mocks.uploadReceiptLogo,
}));

const refreshedSettings = {
  tenant_id: "tenant-1",
  receipt_business_name: "Sweet Home",
  footer: null,
  tax_contact_text: null,
  logo_url: "/api/v1/settings/receipt/logo/tenant-1?v=2",
};

describe("LogoUploadField tenant branding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReceiptSettings.mockResolvedValue(refreshedSettings);
    mocks.uploadReceiptLogo.mockResolvedValue({ logo_url: refreshedSettings.logo_url });
    mocks.deleteReceiptLogo.mockResolvedValue(undefined);
  });

  it("updates the shell logo immediately after a successful upload", async () => {
    const { container } = render(
      <ToastProvider>
        <LogoUploadField logoUrl="" setReceipt={vi.fn()} />
      </ToastProvider>,
    );
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["logo"], "sweet-home.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.setTenantLogoUrl).toHaveBeenCalledWith(refreshedSettings.logo_url);
    });
  });

  it("restores the Kova fallback immediately after deleting the tenant logo", async () => {
    render(
      <ToastProvider>
        <LogoUploadField logoUrl={refreshedSettings.logo_url} setReceipt={vi.fn()} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: copy.settings.logoRemoveButton }));

    await waitFor(() => {
      expect(mocks.setTenantLogoUrl).toHaveBeenCalledWith(null);
    });
  });
});
