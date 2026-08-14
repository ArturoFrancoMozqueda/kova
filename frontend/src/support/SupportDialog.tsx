import { useEffect, useState } from "react";
import { Copy, Mail, MessageCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copy } from "@/i18n/messages";
import { supportMailto } from "@/lib/support";
import { getLatestRequestId } from "@/lib/supportContext";
import { cn } from "@/lib/utils";
import { isWhatsAppEnabled, whatsAppLink } from "@/lib/whatsapp";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SupportDialog({ open, onClose }: Props) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRequestId(getLatestRequestId());
    setCopied(false);
  }, [open]);

  const message = requestId
    ? `${copy.app.supportWhatsAppMessage}\n${copy.app.supportReference}: ${requestId}`
    : copy.app.supportWhatsAppMessage;

  return (
    <Dialog open={open} onClose={onClose} className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{copy.app.supportTitle}</DialogTitle>
        <DialogDescription>{copy.app.supportDescription}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <a
          className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start")}
          href={supportMailto(requestId)}
        >
          <Mail className="h-4 w-4" />
          {copy.app.supportEmail}
        </a>
        {isWhatsAppEnabled() ? (
          <a
            className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start")}
            href={whatsAppLink(message)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle className="h-4 w-4" />
            {copy.app.supportWhatsApp}
          </a>
        ) : null}

        <div className="rounded-kova-lg border border-kova-border bg-kova-mist/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {copy.app.supportTechnicalContext}
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <code className="min-w-0 break-all text-xs text-kova-ink">
              {requestId ?? copy.app.supportReferenceUnavailable}
            </code>
            {requestId ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(requestId)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                <Copy className="h-4 w-4" />
                {copied ? copy.app.supportCopied : copy.app.supportCopy}
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{copy.app.supportContextSafety}</p>
        </div>
      </div>
    </Dialog>
  );
}
