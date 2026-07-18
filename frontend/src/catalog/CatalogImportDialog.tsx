import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { copy } from "../i18n/messages";
import { catalogImportTemplateUrl, commitCatalogImport, previewCatalogImport } from "./api";
import type { CatalogImportResponse } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: (result: CatalogImportResponse) => void | Promise<void>;
};

export function CatalogImportDialog({ open, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CatalogImportResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setPreview(null);
    setPending(false);
    setError(null);
  }, [open]);

  const chooseFile = async (selected: File | undefined) => {
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setError(null);
    if (selected.size > 2 * 1024 * 1024) {
      setError(copy.catalog.importFileTooLarge);
      return;
    }
    setPending(true);
    try {
      setPreview(await previewCatalogImport(selected));
    } catch (cause) {
      setError(resolveApiErrorMessage(cause, copy.catalog.importPreviewError));
    } finally {
      setPending(false);
    }
  };

  const confirm = async () => {
    if (!file || !preview || preview.error_rows > 0) return;
    setPending(true);
    setError(null);
    try {
      await onImported(await commitCatalogImport(file));
    } catch (cause) {
      setError(resolveApiErrorMessage(cause, copy.catalog.importCommitError));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={pending ? () => undefined : onClose} className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{copy.catalog.importTitle}</DialogTitle>
        <DialogDescription>{copy.catalog.importDescription}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-kova-lg border border-kova-border bg-kova-mist/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-kova-blue" />
            <div>
              <p className="text-sm font-semibold text-kova-ink">{copy.catalog.importPrepareTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">{copy.catalog.importPrepareBody}</p>
            </div>
          </div>
          <a
            href={catalogImportTemplateUrl}
            download
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
          >
            <Download className="h-4 w-4" />
            {copy.catalog.importDownloadTemplate}
          </a>
        </div>

        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".csv,text/csv"
          aria-label={copy.catalog.importChooseFile}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <button
          type="button"
          className="flex min-h-28 w-full flex-col items-center justify-center rounded-kova-lg border border-dashed border-kova-border bg-white px-4 py-5 text-center transition-colors hover:border-kova-blue hover:bg-kova-mist/30 focus:outline-none focus:ring-2 focus:ring-kova-blue focus:ring-offset-2"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
        >
          {pending && !preview ? <Loader2 className="h-6 w-6 animate-spin text-kova-blue" /> : <Upload className="h-6 w-6 text-kova-blue" />}
          <span className="mt-2 text-sm font-semibold text-kova-ink">
            {pending && !preview ? copy.catalog.importReviewing : file?.name ?? copy.catalog.importChooseFile}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">{copy.catalog.importFileHint}</span>
        </button>

        {error && (
          <div role="alert" className="flex gap-2 rounded-kova-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {preview && (
          <div className="space-y-3" aria-live="polite">
            <div className="grid grid-cols-3 gap-2">
              <ImportCount label={copy.catalog.importTotal} value={preview.total_rows} />
              <ImportCount label={copy.catalog.importValid} value={preview.valid_rows} tone="success" />
              <ImportCount label={copy.catalog.importErrors} value={preview.error_rows} tone={preview.error_rows ? "error" : "success"} />
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {preview.rows.map((row) => (
                <div key={row.row_number} className="rounded-kova-lg border border-kova-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-kova-ink">{row.normalized.name || copy.catalog.importUnnamed}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {copy.catalog.importRow(row.row_number)} · {row.normalized.sku || copy.catalog.importNoSku}
                      </p>
                    </div>
                    <Badge variant={row.status === "valid" ? "success" : "destructive"}>
                      {row.status === "valid" ? copy.catalog.importReady : copy.catalog.importNeedsReview}
                    </Badge>
                  </div>
                  {row.errors.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-red-700">
                      {row.errors.map((message) => <li key={message}>• {message}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            {preview.error_rows === 0 && (
              <div className="flex gap-2 rounded-kova-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{copy.catalog.importReadyBody(preview.valid_rows)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>{copy.catalog.cancel}</Button>
        <Button type="button" onClick={() => void confirm()} disabled={pending || !preview || preview.error_rows > 0}>
          {pending && preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {copy.catalog.importConfirm}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function ImportCount({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "error" }) {
  const toneClass = tone === "success" ? "text-emerald-700" : tone === "error" ? "text-red-700" : "text-kova-ink";
  return (
    <div className="rounded-kova-lg border border-kova-border bg-white p-3 text-center">
      <p className={`text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
