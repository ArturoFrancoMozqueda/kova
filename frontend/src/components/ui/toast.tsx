import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
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
    (message: string, variant: ToastVariant = "success") => {
      toastId += 1;
      const id = toastId;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismissToast(id), 4000);
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-kova-lg border-[0.5px] px-4 py-3 shadow-lg min-w-[280px] max-w-[420px]",
              variantStyles[t.variant],
              t.exiting ? "toast-exit" : "toast-enter",
            )}
          >
            {icons[t.variant]}
            <span className="flex-1 text-sm font-medium">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
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
