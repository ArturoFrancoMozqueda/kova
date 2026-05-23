import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // Mobile: bottom sheet — full width, slides up, capped height, rounded top corners
          "relative w-full max-h-[90dvh] overflow-y-auto overscroll-contain",
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
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 space-y-1.5", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight text-kova-ink", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-kova-muted", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3", className)} {...props} />;
}
