import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "./button";

/** Ordinary buttons with Tab navigation; Escape and outside interaction dismiss
 * the disclosure. No menu role or implied arrow-key menu behavior. */
export function ActionDisclosure({ label, actions }: {
  label: string;
  actions: { label: string; icon?: ReactNode; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <Button ref={trigger} type="button" variant="ghost" size="icon" className="h-9 w-9"
        aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
        <Ellipsis aria-hidden="true" />
      </Button>
      {open && (
        <div id={id} role="group" aria-label={label}
          className="absolute right-0 top-full z-20 mt-1 flex min-w-48 flex-col items-stretch gap-1 rounded-kova-md border border-kova-border bg-white p-2 shadow-kova-card-hover">
          {actions.map(action => (
            <Button key={action.label} type="button" variant="ghost" size="sm" className="justify-start" onClick={() => {
              // A dialog opened by the action can restore to this stable trigger.
              trigger.current?.focus();
              setOpen(false);
              action.onSelect();
            }}>{action.icon}{action.label}</Button>
          ))}
        </div>
      )}
    </div>
  );
}
