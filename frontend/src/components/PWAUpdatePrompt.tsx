import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { copy } from "@/i18n/messages";
import { RefreshCw, X } from "lucide-react";

export default function PWAUpdatePrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("pos:pwa-update-available", show);
    return () => window.removeEventListener("pos:pwa-update-available", show);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-[70] mx-auto max-w-xl rounded-lg border bg-card p-4 shadow-xl sm:left-auto sm:right-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <RefreshCw className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{copy.pwaUpdate.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.pwaUpdate.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent("pos:pwa-apply-update"))}
            >
              {copy.pwaUpdate.update}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setVisible(false)}>
              {copy.pwaUpdate.later}
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={copy.pwaUpdate.dismiss}
          onClick={() => setVisible(false)}
          className="h-8 w-8 shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
