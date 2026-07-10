import { type ReactNode } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./dialog";
import { Button } from "./button";
import { copy } from "@/i18n/messages";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (default true — this dialog guards destructive actions). */
  destructive?: boolean;
  /** While an awaited action is in flight both buttons disable and the dialog can't be dismissed. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation dialog for destructive / irreversible actions. Inherits
 * focus management + aria-labelledby from the base Dialog, so every gated
 * action is keyboard- and screen-reader-safe with no per-call-site work.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={busy ? () => {} : onCancel}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {cancelLabel ?? copy.confirm.cancel}
        </Button>
        <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
          {confirmLabel ?? copy.confirm.confirm}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
