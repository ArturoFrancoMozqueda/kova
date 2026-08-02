import { useEffect, useState, type HTMLAttributes } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { copy } from "@/i18n/messages";
import { MOTION_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";
import { RefreshCw, X } from "lucide-react";

export default function PWAUpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const location = useLocation();
  const isPublicOrAuthRoute =
    location.pathname === "/" ||
    location.pathname === "/login" ||
    location.pathname === "/signup" ||
    location.pathname.startsWith("/verify-email");

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("pos:pwa-update-available", show);
    return () => window.removeEventListener("pos:pwa-update-available", show);
  }, []);

  const presence = usePresence(visible && !isPublicOrAuthRoute, MOTION_MS.panelExit);

  if (!presence.mounted) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      {...(presence.exiting
        ? ({ "aria-hidden": true, inert: "" } as HTMLAttributes<HTMLDivElement>)
        : {})}
      className={cn(
        "fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-4 right-4 z-[70] mx-auto max-w-xl rounded-lg border bg-card p-4 shadow-xl sm:bottom-4 sm:left-auto sm:right-4",
        presence.exiting ? "pointer-events-none animate-fade-out" : "animate-slide-in-right",
      )}
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
