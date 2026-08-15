import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CircleAlert, FileCheck2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { copy } from "@/i18n/messages";
import { useIsOnline } from "@/offline/useSyncQueue";

import {
  closeFiscalDraft,
  getFiscalDraftSettings,
  listFiscalDraftBatches,
  previewFiscalDraft,
  saveFiscalDraftSettings,
  type FiscalDraftBatch,
  type FiscalDraftFrequency,
  type FiscalDraftPreview,
  type FiscalDraftSettings,
} from "./api";

type LoadState = "loading" | "ready" | "error";

const frequencyLabels: Record<FiscalDraftFrequency, string> = {
  daily: copy.settings.fiscalFrequencyDaily,
  weekly: copy.settings.fiscalFrequencyWeekly,
  monthly: copy.settings.fiscalFrequencyMonthly,
};

const weekdayOptions = [
  copy.settings.fiscalMonday,
  copy.settings.fiscalTuesday,
  copy.settings.fiscalWednesday,
  copy.settings.fiscalThursday,
  copy.settings.fiscalFriday,
  copy.settings.fiscalSaturday,
  copy.settings.fiscalSunday,
];

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});

const date = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatMoney(value: string): string {
  return money.format(Number(value));
}

function formatDate(value: string): string {
  return date.format(new Date(`${value}T12:00:00Z`));
}

function settingsBody(settings: FiscalDraftSettings) {
  return {
    frequency: settings.frequency,
    weekly_close_day: settings.weekly_close_day,
    monthly_close_day: settings.monthly_close_day,
    auto_close_enabled: settings.auto_close_enabled,
  };
}

export function FiscalGlobalDraftsPanel({ role }: { role: string }) {
  const isOwner = role === "owner";
  const isOnline = useIsOnline();
  const { toast } = useToast();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [settings, setSettings] = useState<FiscalDraftSettings | null>(null);
  const [batches, setBatches] = useState<FiscalDraftBatch[]>([]);
  const [periodEnd, setPeriodEnd] = useState("");
  const [preview, setPreview] = useState<FiscalDraftPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const closeAttempt = useRef<{ periodEnd: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const [currentSettings, batchList] = await Promise.all([
        getFiscalDraftSettings(),
        listFiscalDraftBatches(),
      ]);
      setSettings(currentSettings);
      setBatches(batchList.items);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    if (!settings || !isOwner || !isOnline) return;
    setSaveBusy(true);
    try {
      const saved = await saveFiscalDraftSettings(settingsBody(settings));
      setSettings(saved);
      toast(copy.settings.fiscalSettingsSaved, "success");
    } catch {
      toast(copy.settings.fiscalSettingsSaveError, "error");
    } finally {
      setSaveBusy(false);
    }
  }

  async function preparePreview() {
    if (!periodEnd || !isOnline) return;
    setPreviewBusy(true);
    setPreview(null);
    try {
      setPreview(await previewFiscalDraft(periodEnd));
    } catch {
      toast(copy.settings.fiscalPreviewError, "error");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function closePeriod() {
    if (!periodEnd || !isOwner || !isOnline) return;
    setCloseBusy(true);
    try {
      if (closeAttempt.current?.periodEnd !== periodEnd) {
        closeAttempt.current = { periodEnd, key: crypto.randomUUID() };
      }
      const closed = await closeFiscalDraft(periodEnd, closeAttempt.current.key);
      closeAttempt.current = null;
      setBatches((current) => [closed, ...current.filter((item) => item.id !== closed.id)]);
      setPreview(closed);
      setConfirmClose(false);
      toast(copy.settings.fiscalCloseSuccess, "success");
    } catch {
      toast(copy.settings.fiscalCloseError, "error");
    } finally {
      setCloseBusy(false);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="space-y-4" aria-label={copy.settings.fiscalLoading}>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (loadState === "error" || !settings) {
    return (
      <ViewError
        message={copy.settings.fiscalLoadError}
        retryLabel={copy.dashboard.retry}
        onRetry={() => void load()}
      />
    );
  }

  const mutationsDisabled = !isOwner || !isOnline;

  return (
    <div className="space-y-6">
      {!isOnline ? (
        <div
          className="flex items-start gap-3 rounded-kova-md border border-amber-200 bg-amber-50 p-4 text-amber-950"
          role="status"
        >
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{copy.settings.fiscalOfflineTitle}</p>
            <p className="mt-1 text-sm leading-6">{copy.settings.fiscalOfflineBody}</p>
          </div>
        </div>
      ) : null}

      {!isOwner ? (
        <div className="rounded-kova-md border border-kova-border bg-kova-mist p-4">
          <p className="text-sm font-semibold">{copy.settings.fiscalReadOnlyTitle}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.settings.fiscalReadOnlyBody}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{copy.settings.fiscalSettingsTitle}</CardTitle>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {copy.settings.fiscalSettingsBody}
              </p>
            </div>
            <Badge variant="secondary">{copy.settings.fiscalOperationalBadge}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="fiscal-frequency">{copy.settings.fiscalFrequency}</Label>
            <Select
              id="fiscal-frequency"
              value={settings.frequency}
              disabled={mutationsDisabled}
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? { ...current, frequency: event.target.value as FiscalDraftFrequency }
                    : current,
                )
              }
            >
              {Object.entries(frequencyLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>

          {settings.frequency === "weekly" ? (
            <div className="space-y-1">
              <Label htmlFor="fiscal-weekday">{copy.settings.fiscalWeeklyCloseDay}</Label>
              <Select
                id="fiscal-weekday"
                value={String(settings.weekly_close_day)}
                disabled={mutationsDisabled}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, weekly_close_day: Number(event.target.value) } : current,
                  )
                }
              >
                {weekdayOptions.map((label, index) => (
                  <option key={label} value={index + 1}>{label}</option>
                ))}
              </Select>
            </div>
          ) : null}

          {settings.frequency === "monthly" ? (
            <div className="space-y-1">
              <Label htmlFor="fiscal-month-day">{copy.settings.fiscalMonthlyCloseDay}</Label>
              <Input
                id="fiscal-month-day"
                type="number"
                min={1}
                max={31}
                value={settings.monthly_close_day}
                disabled={mutationsDisabled}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, monthly_close_day: Number(event.target.value) } : current,
                  )
                }
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {copy.settings.fiscalMonthEndHint}
              </p>
            </div>
          ) : null}

          <div className="flex items-start gap-3 rounded-kova-md border border-kova-border p-4 sm:col-span-2">
            <input
              id="fiscal-auto-close"
              className="mt-1 h-4 w-4 accent-kova-blue"
              type="checkbox"
              checked={settings.auto_close_enabled}
              disabled={mutationsDisabled}
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, auto_close_enabled: event.target.checked } : current,
                )
              }
            />
            <label htmlFor="fiscal-auto-close">
              <span className="block text-sm font-semibold">{copy.settings.fiscalAutoTitle}</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                {copy.settings.fiscalAutoBody}
              </span>
            </label>
          </div>

          {isOwner ? (
            <Button
              className="justify-self-start sm:col-span-2"
              disabled={saveBusy || !isOnline}
              onClick={() => void saveSettings()}
            >
              {copy.settings.fiscalSaveSettings}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.settings.fiscalPreviewTitle}</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            {copy.settings.fiscalPreviewBody}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full space-y-1 sm:max-w-xs">
              <Label htmlFor="fiscal-period-end">{copy.settings.fiscalPeriodEnd}</Label>
              <Input
                id="fiscal-period-end"
                type="date"
                value={periodEnd}
                disabled={!isOnline}
                onChange={(event) => {
                  setPeriodEnd(event.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <Button
              variant="outline"
              disabled={!periodEnd || !isOnline || previewBusy}
              onClick={() => void preparePreview()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {copy.settings.fiscalPreparePreview}
            </Button>
          </div>

          {previewBusy ? <Skeleton className="h-40 w-full" /> : null}
          {preview ? (
            <PreviewSummary preview={preview} />
          ) : !previewBusy ? (
            <ViewEmpty
              bare
              icon={<CalendarClock className="h-6 w-6" />}
              title={copy.settings.fiscalPreviewEmptyTitle}
              body={copy.settings.fiscalPreviewEmptyBody}
            />
          ) : null}

          {preview && isOwner ? (
            <div className="flex flex-col gap-2 border-t border-kova-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-muted-foreground">
                {copy.settings.fiscalCloseHint}
              </p>
              <Button
                disabled={!isOnline || closeBusy || preview.order_count === 0}
                onClick={() => setConfirmClose(true)}
              >
                {copy.settings.fiscalCloseAction}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.settings.fiscalHistoryTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <ViewEmpty
              bare
              icon={<FileCheck2 className="h-6 w-6" />}
              title={copy.settings.fiscalHistoryEmptyTitle}
              body={copy.settings.fiscalHistoryEmptyBody}
            />
          ) : (
            <div className="space-y-2">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex flex-col gap-3 rounded-kova-md border border-kova-border p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {formatDate(batch.period_start)} – {formatDate(batch.period_end)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {copy.settings.fiscalOrdersCount(batch.order_count)} · {formatMoney(batch.total_amount)}
                    </p>
                  </div>
                  <Badge variant="secondary">{copy.settings.fiscalInternalDraftBadge}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmClose}
        title={copy.settings.fiscalCloseConfirmTitle}
        description={copy.settings.fiscalCloseConfirmBody}
        confirmLabel={copy.settings.fiscalCloseConfirmAction}
        destructive={false}
        busy={closeBusy}
        onConfirm={() => void closePeriod()}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}

function PreviewSummary({ preview }: { preview: FiscalDraftPreview }) {
  return (
    <div className="rounded-kova-lg border border-kova-blue/20 bg-kova-blue/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{copy.settings.fiscalPreviewReady}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(preview.period_start)} – {formatDate(preview.period_end)} · {frequencyLabels[preview.frequency]}
          </p>
        </div>
        <Badge variant="secondary">{copy.settings.fiscalInternalDraftBadge}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label={copy.settings.fiscalGross} value={formatMoney(preview.gross_amount)} />
        <Metric label={copy.settings.fiscalDiscounts} value={formatMoney(preview.discount_total_amount)} />
        <Metric label={copy.settings.fiscalTaxes} value={formatMoney(preview.tax_total_amount)} />
        <Metric label={copy.settings.fiscalTotal} value={formatMoney(preview.total_amount)} />
        <Metric label={copy.settings.fiscalRefunds} value={formatMoney(preview.refund_total_amount)} />
        <Metric label={copy.settings.fiscalNetTotal} value={formatMoney(preview.net_total_amount)} strong />
      </dl>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        {copy.settings.fiscalPreviewCounts(
          preview.order_count,
          preview.excluded_individually_confirmed_count,
        )}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {copy.settings.fiscalOperationalNote}
      </p>
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? "mt-1 font-semibold text-kova-ink" : "mt-1 text-sm font-medium"}>
        {value}
      </dd>
    </div>
  );
}
