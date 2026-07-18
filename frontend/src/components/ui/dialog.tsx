import { type ReactNode, createContext, useContext, useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { trapTabKey } from "@/lib/focusTrap";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

// Shares the generated title id from Dialog down to DialogTitle so the dialog
// can reference its own accessible name via aria-labelledby.
const DialogTitleContext = createContext<string | undefined>(undefined);

export function Dialog({ open, onClose, children, className }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    // Remember where focus was so we can restore it when the dialog closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Move focus into the dialog. Focusing the panel container (tabIndex=-1)
    // lets the screen reader announce the dialog title without accidentally
    // arming a button, and Tab from here moves to the first control.
    panel?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (!panel) return;
      trapTabKey(e, panel);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      // Restore focus to the trigger, guarding against it having unmounted
      // (e.g. a row action whose row was removed) so this never throws.
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      // Decorative dismiss backdrop: keyboard users close via Escape or the
      // labelled close button, so the click shortcut carries no semantics.
      role="presentation"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          // Mobile: bottom sheet — full width, slides up, capped height, rounded top corners
          "relative w-full max-h-[90dvh] overflow-y-auto overscroll-contain focus:outline-none",
          "rounded-t-kova-xl border-t-[0.5px] border-x-[0.5px] border-kova-border bg-white p-5 pt-7 shadow-xl",
          "animate-slide-up",
          // Desktop overrides: centered card
          "sm:max-w-md sm:rounded-kova-xl sm:border-[0.5px] sm:p-6 sm:max-h-[85vh] sm:animate-scale-in",
          // Mobile peek handle pseudo-element
          "before:content-[''] before:absolute before:top-2 before:left-1/2 before:-translate-x-1/2 before:h-1 before:w-10 before:rounded-full before:bg-kova-border sm:before:hidden",
          className,
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-sm text-kova-ink opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-kova-blue focus:ring-offset-2"
          type="button"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
        <DialogTitleContext.Provider value={titleId}>{children}</DialogTitleContext.Provider>
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 space-y-1.5", className)} {...props} />;
}

export function DialogTitle({ className, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const titleId = useContext(DialogTitleContext);
  return (
    // eslint-disable-next-line jsx-a11y/heading-has-content -- children arrive via props spread
    <h2
      id={id ?? titleId}
      className={cn("text-lg font-semibold leading-none tracking-tight text-kova-ink", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-kova-muted", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3", className)} {...props} />;
}
