import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/lib/cropImage", () => ({
  cropImageToSquare: vi.fn(async (file: File) => file),
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
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:logo-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
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
    fireEvent.click(await screen.findByRole("button", { name: copy.settings.logoEditorSave }));

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

  it("rejects SVG before sending it to the backend", async () => {
    const { container } = render(
      <ToastProvider>
        <LogoUploadField logoUrl="" setReceipt={vi.fn()} />
      </ToastProvider>,
    );
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["<svg></svg>"], "sweet-home.svg", { type: "image/svg+xml" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(copy.settings.logoInvalidType)).toBeInTheDocument();
    expect(mocks.uploadReceiptLogo).not.toHaveBeenCalled();
  });

  it("previews and frames a valid logo before uploading it", async () => {
    const { container } = render(
      <ToastProvider>
        <LogoUploadField logoUrl="" setReceipt={vi.fn()} />
      </ToastProvider>,
    );
    const input = container.querySelector("input[type=file]") as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["logo"], "sweet-home.png", { type: "image/png" })] },
    });

    expect(await screen.findByRole("img", { name: copy.settings.logoEditorFrameLabel })).toBeInTheDocument();
    expect(screen.getByText(copy.settings.logoEditorPreview)).toBeInTheDocument();
    expect(mocks.uploadReceiptLogo).not.toHaveBeenCalled();
  });

  it.each(["upload", "delete"])("ignores a pending %s after changing route or business", async (operation) => {
    let resolve!: (value?: { logo_url: string }) => void;
    const pending = new Promise((done) => { resolve = done; });
    if (operation === "upload") mocks.uploadReceiptLogo.mockReturnValueOnce(pending);
    else mocks.deleteReceiptLogo.mockReturnValueOnce(pending);
    const setReceipt = vi.fn();
    const view = render(<ToastProvider><LogoUploadField logoUrl={refreshedSettings.logo_url} setReceipt={setReceipt} /></ToastProvider>);
    if (operation === "upload") {
      fireEvent.change(view.container.querySelector("input[type=file]")!, {
        target: { files: [new File(["logo"], "logo.png", { type: "image/png" })] },
      });
      fireEvent.click(await screen.findByRole("button", { name: copy.settings.logoEditorSave }));
      await waitFor(() => expect(mocks.uploadReceiptLogo).toHaveBeenCalledOnce());
    } else fireEvent.click(screen.getByRole("button", { name: copy.settings.logoRemoveButton }));
    view.unmount();
    await act(async () => resolve({ logo_url: "/old-business-logo" }));
    expect(mocks.setTenantLogoUrl).not.toHaveBeenCalled();
    expect(setReceipt).not.toHaveBeenCalled();
    expect(mocks.getReceiptSettings).not.toHaveBeenCalled();
  });

  it("ignores a pending receipt refresh after the logo field unmounts", async () => {
    let resolve!: (value: typeof refreshedSettings) => void;
    mocks.getReceiptSettings.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const setReceipt = vi.fn();
    const view = render(<ToastProvider><LogoUploadField logoUrl={refreshedSettings.logo_url} setReceipt={setReceipt} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: copy.settings.logoRemoveButton }));
    await waitFor(() => expect(mocks.getReceiptSettings).toHaveBeenCalledOnce());
    setReceipt.mockClear();
    view.unmount();
    await act(async () => resolve(refreshedSettings));
    expect(setReceipt).not.toHaveBeenCalled();
  });
});
