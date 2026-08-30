import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";

import { FiscalGlobalDraftsPanel } from "./FiscalGlobalDraftsPanel";
import {
  closeFiscalDraft,
  downloadFiscalDraftAccountantPackage,
  downloadFiscalDraftAccountantReport,
  FiscalDraftApiError,
  getFiscalDraftSettings,
  listFiscalDraftBatches,
  previewFiscalDraft,
  saveFiscalDraftSettings,
} from "./api";

const onlineState = vi.hoisted(() => ({ value: true }));

vi.mock("@/offline/useSyncQueue", () => ({
  useIsOnline: () => onlineState.value,
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    closeFiscalDraft: vi.fn(),
    downloadFiscalDraftAccountantPackage: vi.fn(),
    downloadFiscalDraftAccountantReport: vi.fn(),
    getFiscalDraftSettings: vi.fn(),
    listFiscalDraftBatches: vi.fn(),
    previewFiscalDraft: vi.fn(),
    saveFiscalDraftSettings: vi.fn(),
  };
});

const settings = {
  configured: true,
  frequency: "monthly" as const,
  weekly_close_day: 7,
  monthly_close_day: 31,
  auto_close_enabled: false,
  timezone: "America/Mexico_City" as const,
  scheduler_status: "active" as const,
};

const unconfiguredSettings = { ...settings, configured: false };

const preview = {
  frequency: "monthly" as const,
  period_start: "2024-02-01",
  period_end: "2024-02-29",
  timezone: "America/Mexico_City" as const,
  document_kind: "operational_draft" as const,
  fiscal_status: "not_issued" as const,
  package_schema_version: "accountant-package-v2",
  tax_calculation_status: "not_calculated" as const,
  gross_amount: "116.00",
  discount_total_amount: "0.00",
  tax_total_amount: "16.00",
  total_amount: "116.00",
  refund_total_amount: "18.00",
  net_total_amount: "98.00",
  adjustment_total_amount: "-5.00",
  adjusted_net_amount: "93.00",
  adjustment_count: 1,
  data_quality_warnings: ["TAXES_NOT_CALCULATED"],
  order_count: 2,
  excluded_individually_confirmed_count: 1,
};

const batch = {
  ...preview,
  id: "batch-1",
  status: "closed" as const,
  order_ids: ["order-1", "order-2"],
  closed_at: "2024-03-01T06:00:00Z",
  business_name_snapshot: "Café Kova al cierre",
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
    vi.mocked(downloadFiscalDraftAccountantPackage).mockResolvedValue(
      "cierre-para-contador-2024-02.zip",
    );
  });

  it("lets an owner configure, preview and confirm a close with honest copy", async () => {
    renderPanel();

    const auto = await screen.findByRole("checkbox", { name: /cerrar automáticamente/i });
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
    expect(visibleCopy).toMatch(/cierre para contador/i);
    expect(visibleCopy).toMatch(/recibos? operativos?/i);
    expect(visibleCopy).toMatch(/ni emite CFDI/i);
    expect(visibleCopy).not.toMatch(/XML|PAC|timbrad|factura emitida/i);
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

  it("requires an owner to persist synthetic defaults before previewing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T18:00:00Z"));
    vi.mocked(getFiscalDraftSettings).mockResolvedValueOnce(unconfiguredSettings);
    vi.mocked(saveFiscalDraftSettings).mockResolvedValueOnce(settings);
    try {
      renderPanel();

      expect(await screen.findByText(copy.settings.fiscalSetupRequiredOwnerTitle)).toBeVisible();
      expect(screen.getByLabelText(copy.settings.fiscalPeriodEnd)).toBeDisabled();
      expect(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview })).toBeDisabled();
      expect(screen.getByRole("button", { name: copy.settings.fiscalSaveSettings })).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalSaveSettings }));
      await waitFor(() => expect(saveFiscalDraftSettings).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: "monthly", monthly_close_day: 31 }),
      ));

      const periodInput = screen.getByLabelText(copy.settings.fiscalPeriodEnd);
      await waitFor(() => expect(periodInput).toBeEnabled());
      expect(periodInput).toHaveValue("2026-07-31");
      fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview }));
      await waitFor(() => expect(previewFiscalDraft).toHaveBeenCalledWith("2026-07-31"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains an unconfigured read-only state to managers", async () => {
    vi.mocked(getFiscalDraftSettings).mockResolvedValueOnce(unconfiguredSettings);
    renderPanel("manager");

    expect(await screen.findByText(copy.settings.fiscalSetupRequiredManagerTitle)).toBeVisible();
    expect(screen.getByLabelText(copy.settings.fiscalPeriodEnd)).toBeDisabled();
    expect(screen.queryByRole("button", { name: copy.settings.fiscalSaveSettings })).not.toBeInTheDocument();
    expect(previewFiscalDraft).not.toHaveBeenCalled();
  });

  it("blocks the incident date inline without making a preview request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-16T18:00:00Z"));
    try {
      renderPanel();
      const periodInput = await screen.findByLabelText(copy.settings.fiscalPeriodEnd);
      expect(periodInput).toHaveValue("2026-07-31");

      fireEvent.change(periodInput, { target: { value: "2026-07-16" } });

      expect(screen.getByRole("alert")).toHaveTextContent(/fecha de cierre es.*31 jul 2026/i);
      expect(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview })).toBeDisabled();
      expect(previewFiscalDraft).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates a prepared preview when settings become dirty", async () => {
    renderPanel();
    const periodInput = await screen.findByLabelText(copy.settings.fiscalPeriodEnd);
    fireEvent.change(periodInput, { target: { value: "2024-02-29" } });
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview }));
    expect(await screen.findByText(copy.settings.fiscalPreviewReady)).toBeVisible();

    fireEvent.change(screen.getByLabelText(copy.settings.fiscalMonthlyCloseDay), {
      target: { value: "15" },
    });

    expect(screen.queryByText(copy.settings.fiscalPreviewReady)).not.toBeInTheDocument();
    expect(screen.getByText(copy.settings.fiscalUnsavedSettingsTitle)).toBeVisible();
    expect(periodInput).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview })).toBeDisabled();
  });

  it("maps structured preview rejections inline and reserves toast for server failures", async () => {
    vi.mocked(previewFiscalDraft)
      .mockRejectedValueOnce(
        new FiscalDraftApiError(
          "mismatch",
          400,
          "FISCAL_PERIOD_END_MISMATCH",
        ),
      )
      .mockRejectedValueOnce(new FiscalDraftApiError("server", 500));
    renderPanel();
    const periodInput = await screen.findByLabelText(copy.settings.fiscalPeriodEnd);
    fireEvent.change(periodInput, { target: { value: "2024-02-29" } });

    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy.settings.fiscalPreviewServerMismatch,
    );

    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalPreparePreview }));
    expect(await screen.findByText(copy.settings.fiscalPreviewError)).toBeVisible();
  });

  it("shows the frozen accountant report and lets an owner download or print it", async () => {
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));

    expect(screen.getByRole("heading", { name: copy.settings.fiscalAccountantReportTitle })).toBeVisible();
    expect(screen.getByText("Café Kova al cierre")).toBeVisible();
    expect(screen.getByText(copy.settings.fiscalAccountantReportState)).toBeVisible();
    expect(screen.getAllByText(/no es CFDI/i)).toHaveLength(2);
    expect(screen.getByText(/Kova no calcula IVA ni IEPS/i)).toBeVisible();
    expect(screen.getByText(copy.settings.fiscalOperationalReceiptBadge)).toBeVisible();
    expect(screen.getByText(copy.settings.fiscalNotIssuedBadge)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload }));
    await waitFor(() => expect(downloadFiscalDraftAccountantPackage).toHaveBeenCalledWith(batch.id));

    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantPrint }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("allows a manager to export the read-only report", async () => {
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    renderPanel("manager");

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload }));

    await waitFor(() => expect(downloadFiscalDraftAccountantPackage).toHaveBeenCalledWith(batch.id));
    expect(screen.queryByRole("button", { name: copy.settings.fiscalSaveSettings })).not.toBeInTheDocument();
  });

  it("keeps historical closes available through the legacy CSV", async () => {
    const legacy = {
      ...batch,
      package_schema_version: "legacy-v1",
      business_name_snapshot: null,
      adjustment_total_amount: "0.00",
      adjusted_net_amount: batch.net_total_amount,
      adjustment_count: 0,
    };
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [legacy], total: 1 });
    renderPanel();

    expect(await screen.findByText(copy.settings.fiscalLegacyBadge)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantReportShow }));
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantLegacyDownload }));

    await waitFor(() => expect(downloadFiscalDraftAccountantReport).toHaveBeenCalledWith(legacy.id));
    expect(downloadFiscalDraftAccountantPackage).not.toHaveBeenCalled();
  });

  it("keeps printing available offline but disables the network download", async () => {
    onlineState.value = false;
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));

    expect(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.settings.fiscalAccountantPrint })).toBeEnabled();
    expect(screen.getByText(copy.settings.fiscalAccountantOffline)).toBeVisible();
    expect(downloadFiscalDraftAccountantPackage).not.toHaveBeenCalled();
  });

  it("shows an actionable error when the CSV download fails", async () => {
    vi.mocked(listFiscalDraftBatches).mockResolvedValue({ items: [batch], total: 1 });
    vi.mocked(downloadFiscalDraftAccountantPackage).mockRejectedValueOnce(new Error("network"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: copy.settings.fiscalAccountantReportShow }));
    fireEvent.click(screen.getByRole("button", { name: copy.settings.fiscalAccountantDownload }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy.settings.fiscalAccountantDownloadError,
    );
  });
});
