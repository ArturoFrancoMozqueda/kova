import { type DragEvent, type Dispatch, type SetStateAction, useRef, useState } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/useAuth";
import { copy } from "@/i18n/messages";
import { compressImage } from "@/lib/compressImage";
import { cn } from "@/lib/utils";

import { deleteReceiptLogo, getReceiptSettings, uploadReceiptLogo } from "./api";

type ReceiptDraft = {
  receipt_business_name: string;
  footer: string;
  tax_contact_text: string;
  logo_url: string;
};

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 512 * 1024;
// Generous pre-compression cap. Raster images get compressed to WebP below
// MAX_BYTES; SVG is sent as-is and validated against MAX_BYTES.
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export function LogoUploadField({
  logoUrl,
  setReceipt,
}: {
  logoUrl: string;
  setReceipt: Dispatch<SetStateAction<ReceiptDraft>>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const { setTenantLogoUrl } = useAuth();

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

  const handleFile = async (file: File | undefined) => {
    if (!file || !validateInput(file)) return;
    setIsPending(true);
    try {
      let prepared = file;
      try {
        prepared = await compressImage(file);
      } catch {
        // fall back to original; backend still enforces a size cap
      }
      if (prepared.size > MAX_BYTES) {
        toast(copy.settings.logoTooLarge, "error");
        return;
      }
      const response = await uploadReceiptLogo(prepared);
      setTenantLogoUrl(response.logo_url);
      setReceipt((current) => ({ ...current, logo_url: response.logo_url }));
      const refreshed = await getReceiptSettings();
      setReceipt((current) => ({
        ...current,
        receipt_business_name: refreshed.receipt_business_name,
        footer: refreshed.footer ?? "",
        tax_contact_text: refreshed.tax_contact_text ?? "",
        logo_url: refreshed.logo_url ?? "",
      }));
      toast(copy.settings.logoUploaded, "success");
    } catch {
      toast(copy.settings.logoUploadError, "error");
    } finally {
      setIsPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  };

  const handleDelete = async () => {
    setIsPending(true);
    try {
      await deleteReceiptLogo();
      setTenantLogoUrl(null);
      setReceipt((current) => ({ ...current, logo_url: "" }));
      const refreshed = await getReceiptSettings();
      setReceipt((current) => ({
        ...current,
        receipt_business_name: refreshed.receipt_business_name,
        footer: refreshed.footer ?? "",
        tax_contact_text: refreshed.tax_contact_text ?? "",
        logo_url: refreshed.logo_url ?? "",
      }));
      toast(copy.settings.logoRemoved, "success");
    } catch {
      toast(copy.settings.logoRemoveError, "error");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="receipt-logo-file">{copy.settings.logoUploadLabel}</Label>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-[var(--radius-lg)] border border-dashed border-[color:var(--kova-border)] bg-[color:var(--kova-mist)]/40 p-4 transition-colors",
          isDragging && "border-[color:var(--kova-blue)] bg-[color:var(--kova-blue)]/5",
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--kova-border)] bg-white">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={copy.settings.receiptPreviewLogoAlt}
                className="max-h-12 max-w-12 object-contain"
              />
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{copy.settings.logoUploadTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.settings.logoUploadHint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {copy.settings.logoUploadButton}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="h-4 w-4" />
                {copy.settings.logoRemoveButton}
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={inputRef}
          id="receipt-logo-file"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
        />
      </div>
    </div>
  );
}
