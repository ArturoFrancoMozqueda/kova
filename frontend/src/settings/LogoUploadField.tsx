import { type DragEvent, type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Trash2, Upload } from "lucide-react";

import { ImagePositionEditor } from "@/catalog/ImagePositionEditor";
import { productImageStyle } from "@/catalog/imageUrl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/useAuth";
import { copy } from "@/i18n/messages";
import { compressImage } from "@/lib/compressImage";
import { cropImageToSquare } from "@/lib/cropImage";
import { cn } from "@/lib/utils";
import type { ReceiptPaperWidth } from "@/lib/receiptPaper";

import { deleteReceiptLogo, getReceiptSettings, uploadReceiptLogo } from "./api";

type ReceiptDraft = {
  receipt_business_name: string;
  footer: string;
  tax_contact_text: string;
  logo_url: string;
  paper_width_mm: ReceiptPaperWidth;
};

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 512 * 1024;
// Generous pre-compression cap. Raster images get compressed to WebP below
// MAX_BYTES before they are sent to the backend.
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export function LogoUploadField({
  logoUrl,
  setReceipt,
}: {
  logoUrl: string;
  setReceipt: Dispatch<SetStateAction<ReceiptDraft>>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [selection, setSelection] = useState<{ file: File; previewUrl: string } | null>(null);
  const [positionX, setPositionX] = useState(50);
  const [positionY, setPositionY] = useState(50);
  const [zoom, setZoom] = useState(1);
  const { toast } = useToast();
  const { setTenantLogoUrl } = useAuth();

  useEffect(() => {
    const active = activeRef;
    active.current = true;
    // Settings unmounts this field when the loaded business changes. Pending
    // uploads must not update its surviving parent or the new session's logo.
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (selection) URL.revokeObjectURL(selection.previewUrl);
    };
  }, [selection]);

  const validateInput = (file: File): boolean => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast(copy.settings.logoInvalidType, "error");
      return false;
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast(copy.settings.logoTooLarge, "error");
      return false;
    }
    return true;
  };

  const handleFile = (file: File | undefined) => {
    if (!file || !validateInput(file)) return;
    setSelection({ file, previewUrl: URL.createObjectURL(file) });
    setPositionX(50);
    setPositionY(50);
    setZoom(1);
  };

  const handleSave = async () => {
    if (!selection) return;
    setIsPending(true);
    try {
      let prepared = await cropImageToSquare(selection.file, { positionX, positionY, zoom });
      if (!activeRef.current) return;
      try {
        prepared = await compressImage(prepared);
      } catch {
        // fall back to original; backend still enforces a size cap
      }
      if (!activeRef.current) return;
      if (prepared.size > MAX_BYTES) {
        toast(copy.settings.logoTooLarge, "error");
        return;
      }
      const response = await uploadReceiptLogo(prepared);
      if (!activeRef.current) return;
      setTenantLogoUrl(response.logo_url);
      setReceipt((current) => ({ ...current, logo_url: response.logo_url }));
      const refreshed = await getReceiptSettings();
      if (!activeRef.current) return;
      setReceipt((current) => ({
        ...current,
        receipt_business_name: refreshed.receipt_business_name,
        footer: refreshed.footer ?? "",
        tax_contact_text: refreshed.tax_contact_text ?? "",
        logo_url: refreshed.logo_url ?? "",
      }));
      toast(copy.settings.logoUploaded, "success");
      setSelection(null);
    } catch {
      if (activeRef.current) toast(copy.settings.logoUploadError, "error");
    } finally {
      if (activeRef.current) setIsPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFile(event.dataTransfer.files[0]);
  };

  const handleCancelSelection = () => {
    setSelection(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDelete = async () => {
    setIsPending(true);
    try {
      await deleteReceiptLogo();
      if (!activeRef.current) return;
      setTenantLogoUrl(null);
      setReceipt((current) => ({ ...current, logo_url: "" }));
      const refreshed = await getReceiptSettings();
      if (!activeRef.current) return;
      setReceipt((current) => ({
        ...current,
        receipt_business_name: refreshed.receipt_business_name,
        footer: refreshed.footer ?? "",
        tax_contact_text: refreshed.tax_contact_text ?? "",
        logo_url: refreshed.logo_url ?? "",
      }));
      toast(copy.settings.logoRemoved, "success");
    } catch {
      if (activeRef.current) toast(copy.settings.logoRemoveError, "error");
    } finally {
      if (activeRef.current) setIsPending(false);
    }
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="receipt-logo-file">{copy.settings.logoUploadLabel}</Label>
      {selection ? (
        <div className="overflow-hidden rounded-kova-lg border border-kova-border bg-white shadow-kova-card" aria-busy={isPending}>
          <div className="border-b border-kova-border px-4 py-3 sm:px-5">
            <p className="font-semibold text-kova-ink">{copy.settings.logoEditorTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy.settings.logoEditorDescription}</p>
          </div>
          <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_180px]">
            <ImagePositionEditor
              src={selection.previewUrl}
              positionX={positionX}
              positionY={positionY}
              zoom={zoom}
              onPositionChange={(x, y) => {
                setPositionX(x);
                setPositionY(y);
              }}
              onZoomChange={setZoom}
              aspectRatio="square"
              frameLabel={copy.settings.logoEditorFrameLabel}
              frameBadge={copy.settings.logoEditorFrameBadge}
              editorHint={copy.settings.logoEditorHint}
            />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{copy.settings.logoEditorPreview}</p>
              <div className="flex items-center gap-3 rounded-kova-md bg-kova-ink p-3 text-white">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-kova-md ring-1 ring-inset ring-white/15">
                  <img
                    src={selection.previewUrl}
                    alt=""
                    className="h-full w-full"
                    style={productImageStyle({ image_position_x: positionX, image_position_y: positionY, image_zoom: zoom })}
                  />
                </span>
                <span className="min-w-0 text-sm font-semibold">{copy.settings.logoEditorTenantPlaceholder}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-kova-border bg-muted/30 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
            <Button type="button" variant="outline" disabled={isPending} onClick={handleCancelSelection}>
              {copy.settings.logoEditorCancel}
            </Button>
            <Button type="button" disabled={isPending} onClick={() => void handleSave()}>
              {copy.settings.logoEditorSave}
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "rounded-kova-lg border border-kova-border bg-white p-4 shadow-sm transition-[border-color,box-shadow] duration-hover sm:p-5",
            isDragging && "border-kova-blue ring-2 ring-primary/20",
          )}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {logoUrl ? (
              <img src={logoUrl} alt={copy.settings.receiptPreviewLogoAlt} className="h-16 w-16 shrink-0 rounded-kova-md object-cover ring-1 ring-kova-border" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ImagePlus className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-kova-ink">{logoUrl ? copy.settings.logoActiveHint : copy.settings.logoUploadTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{logoUrl ? copy.settings.logoUploadHint : copy.settings.logoEmptyHint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => inputRef.current?.click()}>
                {logoUrl ? <Pencil className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                {logoUrl ? copy.settings.logoChangeButton : copy.settings.logoUploadButton}
              </Button>
              {logoUrl ? (
                <Button type="button" variant="outline" disabled={isPending} onClick={() => void handleDelete()}>
                  <Trash2 className="h-4 w-4" />
                  {copy.settings.logoRemoveButton}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        id="receipt-logo-file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={isPending}
        onChange={(event) => handleFile(event.currentTarget.files?.[0])}
      />
    </div>
  );
}
