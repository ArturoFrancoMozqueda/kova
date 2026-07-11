import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Sentry from "@sentry/react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/i18n/messages";

type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastAction {
  label: string;
  onAction: () => void;
}

interface ToastOptions {
  variant?: ToastVariant;
  action?: ToastAction;
  durationMs?: number;
}

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (message: string, variantOrOptions?: ToastVariant | ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

const icons: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-kova-growth" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning" />,
  info: <Info className="h-4 w-4 text-kova-blue" />,
};

const variantStyles: Record<ToastVariant, string> = {
  success: "border-kova-growth/30 bg-kova-growth/10 text-kova-ink",
  error: "border-destructive/30 bg-destructive/10 text-kova-ink",
  warning: "border-warning/40 bg-warning/10 text-kova-ink",
  info: "border-kova-blue/30 bg-kova-blue/10 text-kova-ink",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const toast = useCallback(
    (message: string, variantOrOptions: ToastVariant | ToastOptions = "success") => {
      const opts: ToastOptions =
        typeof variantOrOptions === "string"
          ? { variant: variantOrOptions }
          : variantOrOptions;
      const variant = opts.variant ?? "success";
      const duration = opts.durationMs ?? (opts.action ? 6000 : 4000);
      toastId += 1;
      const id = toastId;
      setToasts((prev) => [...prev, { id, message, variant, action: opts.action }]);
      setTimeout(() => dismissToast(id), duration);
    },
    [dismissToast],
  );

  // Catch promise rejections that escape every view's try/catch — async errors
  // the ErrorBoundary (render-only) can't see. Report to Sentry (no-op when the
  // DSN is unset) and show one generic toast, throttled so a rejection loop
  // can't flood the screen.
  const lastUnhandledToastAt = useRef(0);
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      Sentry.captureException(event.reason);
      const now = Date.now();
      if (now - lastUnhandledToastAt.current > 5000) {
        lastUnhandledToastAt.current = now;
        toast(copy.errors.unexpected, "error");
      }
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        // On mobile, clear the app top bar (logo + TrialChip live top-right) so
        // a success toast never covers the "prueba gratis" chip; on desktop the
        // chip is in the sidebar, so toasts sit tight in the top-right corner.
        // Right offset respects the notch on both.
        className={cn(
          "fixed z-[100] flex flex-col gap-2 pointer-events-none",
          "right-[max(1rem,env(safe-area-inset-right))]",
          "top-[calc(env(safe-area-inset-top)+4.25rem)]",
          "lg:top-[max(1rem,env(safe-area-inset-top))]",
        )}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            // Errors interrupt the screen reader (assertive); other variants
            // announce politely so they don't cut off in-progress output.
            role={t.variant === "error" ? "alert" : "status"}
            aria-live={t.variant === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-kova-lg border-[0.5px] px-4 py-3 shadow-lg min-w-[280px] max-w-[420px]",
              variantStyles[t.variant],
              t.exiting ? "toast-exit" : "toast-enter",
            )}
          >
            {icons[t.variant]}
            <span className="flex-1 text-sm font-medium">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onAction();
                  dismissToast(t.id);
                }}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-kova-blue hover:bg-kova-blue/10 transition-colors"
                type="button"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Cerrar aviso"
              className="shrink-0 rounded-sm opacity-60 hover:opacity-100 transition-opacity"
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
