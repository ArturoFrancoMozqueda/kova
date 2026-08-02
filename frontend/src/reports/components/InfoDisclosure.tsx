import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";

import { Disclosure } from "@/components/ui/disclosure";
import { copy } from "@/i18n/messages";

/**
 * Tap-to-reveal methodological note (gross vs net, team caveats). A button —
 * not a hover tooltip — because owners read reports on phones; the full text
 * is never truncated once open.
 */
export function InfoDisclosure({ label, children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      className="mt-2"
      trigger={
        <span className="inline-flex items-center gap-1">
          <Info className="h-3.5 w-3.5" aria-hidden />
          {label ?? copy.reportsView.infoNoteAria}
        </span>
      }
      triggerClassName="h-auto gap-1 px-0 py-0 text-xs text-kova-muted hover:bg-transparent hover:text-kova-ink"
      panelClassName="mt-1"
    >
      <p className="text-xs leading-5 text-muted-foreground">{children}</p>
    </Disclosure>
  );
}
