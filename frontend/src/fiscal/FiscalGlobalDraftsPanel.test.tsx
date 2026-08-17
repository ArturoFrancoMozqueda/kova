import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";

import { FiscalGlobalDraftsPanel } from "./FiscalGlobalDraftsPanel";
import {
  closeFiscalDraft,
  downloadFiscalDraftAccountantReport,
  getFiscalDraftSettings,
  listFiscalDraftBatches,
  previewFiscalDraft,
  saveFiscalDraftSettings,
} from "./api";

const onlineState = vi.hoisted(() => ({ value: true }));

vi.mock("@/offline/useSyncQueue", () => ({
  useIsOnline: () => onlineState.value,
}));

vi.mock("./api", () => ({
  closeFiscalDraft: vi.fn(),
  downloadFiscalDraftAccountantReport: vi.fn(),
  getFiscalDraftSettings: vi.fn(),
  listFiscalDraftBatches: vi.fn(),
  previewFiscalDraft: vi.fn(),
  saveFiscalDraftSettings: vi.fn(),
}));

const settings = {
  frequency: "monthly" as const,
  weekly_close_day: 7,
  monthly_close_day: 31,
  auto_close_enabled: false,
  timezone: "America/Mexico_City" as const,
  scheduler_status: "active" as const,
};

const preview = {
  frequency: "monthly" as const,
  period_start: "2024-02-01",
  period_end: "2024-02-29",
  timezone: "America/Mexico_City" as const,
  document_kind: "operational_draft" as const,
  fiscal_status: "not_issued" as const,
  gross_amount: "116.00",
  discount_total_amount: "0.00",
  tax_total_amount: "16.00",
  total_amount: "116.00",
  refund_total_amount: "18.00",
  net_total_amount: "98.00",
  order_count: 2,
  excluded_individually_confirmed_count: 1,
};

const batch = {
  ...preview,
  id: "batch-1",
  status: "closed" as const,
  order_ids: ["order-1", "order-2"],
  closed_at: "2024-03-01T06:00:00Z",
};

function renderPanel(role = "owner") {
  return render(
    <ToastProvider>
      <FiscalGlobalDraftsPanel role={role} tenantName="Café Kova" />
    </ToastProvider>,
  );
}

describe("FiscalGlobalDraftsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineState.value = true;
    vi.mocked(getFiscalDraftSettings).mockResolvedValue(settings);
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(previewFiscalDraft).mockResolvedValue(preview);
    vi.mocked(saveFiscalDraftSettings).mockResolvedValue({ ...settings, auto_close_enabled: true });
    vi.mocked(closeFiscalDraft).mockResolvedValue(batch);
    vi.mocked(downloadFiscalDraftAccountantReport).mockResolvedValue(
      "reporte-control-interno-2024-02.csv",
    );
  });

  it("lets an owner configure, preview and confirm a close with honest copy", async () => {
    renderPanel();

    const auto = await screen.findByRole("checkbox", { name: /preparar automáticamente/i });
    fireEvent.click(auto);
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalSaveSettings }));
    await waitFor(() => expect(saveFiscalDraftSettings).toHaveBeenCalledWith(
      expect.objectContaining({ auto_close_enabled: true, monthly_close_day: 31 }),
    ));

    fireEvent.change(screen.getByLabelText(copy.settings.fiscalPeriodEnd), {
      target: { value: "2024-02-29" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview }));
    expect(await screen.findByText(copy.settings.fiscalPreviewReady)).toBeVisible();
    expect(screen.getByText(/2 ventas incluidas.*1 excluida/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalCloseAction }));
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalCloseConfirmAction }));
    await waitFor(() => expect(closeFiscalDraft).toHaveBeenCalledWith(
      "2024-02-29",
      expect.any(String),
    ));

    const visibleCopy = document.body.textContent ?? "";
    expect(visibleCopy).toMatch(/borrador interno/i);
    expect(visibleCopy).toMatch(/recibo operativo/i);
    expect(visibleCopy).not.toMatch(/CFDI|XML|PDF|PAC|timbrad|factura emitida/i);
  });

  it("keeps a manager in read-only mode while allowing preview", async () => {
    renderPanel("manager");

    expect(await screen.findByText(copy.settings.fiscalReadOnlyTitle)).toBeVisible();
    expect(screen.getByLabelText(copy.settings.fiscalFrequency)).toBeDisabled();
    expect(screen.queryByRole("button", { name: copy.settings.fiscalSaveSettings })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(copy.settings.fiscalPeriodEnd), {
      target: { value: "2024-02-29" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview }));
    expect(await screen.findByText(copy.settings.fiscalPreviewReady)).toBeVisible();
    expect(screen.queryByRole("button", { name: copy.settings.fiscalCloseAction })).not.toBeInTheDocument();
  });

  it("disables every mutation while offline without blocking Caja copy", async () => {
    onlineState.value = false;
    renderPanel();

    expect(await screen.findByText(copy.settings.fiscalOfflineTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: copy.settings.fiscalSaveSettings })).toBeDisabled();
    expect(screen.getByLabelText(copy.settings.fiscalPeriodEnd)).toBeDisabled();
    expect(screen.getByText(/seguir vendiendo desde Caja/i)).toBeVisible();
    expect(saveFiscalDraftSettings).not.toHaveBeenCalled();
    expect(closeFiscalDraft).not.toHaveBeenCalled();
  });

  it("shows a retry state when the focal API cannot load", async () => {
    vi.mocked(getFiscalDraftSettings).mockRejectedValueOnce(new Error("network"));
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.settings.fiscalLoadError);
    expect(screen.getByRole("button", { name: copy.dashboard.retry })).toBeVisible();
  });

  it("shows the frozen accountant report and lets an owner download or print it", async () => {
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));

    expect(screen.getByRole("heading", { name: copy.settings.fiscalAccountantReportTitle })).toBeVisible();
    expect(screen.getByText("Café Kova")).toBeVisible();
    expect(screen.getByText(copy.settings.fiscalAccountantReportState)).toBeVisible();
    expect(screen.getAllByText(/no es CFDI/i)).toHaveLength(2);
    expect(screen.getByText(/Kova no calcula impuestos hoy/i)).toBeVisible();
    expect(screen.getByText(copy.settings.fiscalOperationalReceiptBadge)).toBeVisible();
    expect(screen.getByText(copy.settings.fiscalNotIssuedBadge)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload }));
    await waitFor(() => expect(downloadFiscalDraftAccountantReport).toHaveBeenCalledWith(batch.id));

    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantPrint }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("allows a manager to export the read-only report", async () => {
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    renderPanel("manager");

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload }));

    await waitFor(() => expect(downloadFiscalDraftAccountantReport).toHaveBeenCalledWith(batch.id));
    expect(screen.queryByRole("button", { name: copy.settings.fiscalSaveSettings })).not.toBeInTheDocument();
  });

  it("keeps printing available offline but disables the network download", async () => {
    onlineState.value = false;
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));

    expect(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.settings.fiscalAccountantPrint })).toBeEnabled();
    expect(screen.getByText(copy.settings.fiscalAccountantOffline)).toBeVisible();
    expect(downloadFiscalDraftAccountantReport).not.toHaveBeenCalled();
  });

  it("shows an actionable error when the CSV download fails", async () => {
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    vi.mocked(downloadFiscalDraftAccountantReport).mockRejectedValueOnce(new Error("network"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy.settings.fiscalAccountantDownloadError,
    );
  });
});
