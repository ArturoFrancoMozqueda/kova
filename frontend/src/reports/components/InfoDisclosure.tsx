import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";

import { copy } from "@/i18n/messages";

/**
 * Tap-to-reveal methodological note (gross vs net, team caveats). A button —
 * not a hover tooltip — because owners read reports on phones; the full text
 * is never truncated once open.
 */
export function InfoDisclosure({ label, children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-xs font-medium text-kova-muted hover:text-kova-ink"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
        {label ?? copy.reportsView.infoNoteAria}
      </button>
      {open ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{children}</p> : null}
    </div>
  );
}
