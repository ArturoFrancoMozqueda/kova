import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type LinkedState = {
  requested: boolean;
  loading: boolean;
  error: string;
  close: () => void;
  reload: () => void;
};
export function LinkedRecordNotice({
  linked,
  children,
}: {
  linked: LinkedState;
  children?: ReactNode;
}) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (linked.requested && !linked.loading) {
      container.current?.focus({ preventScroll: true });
      container.current?.scrollIntoView?.({ block: "start" });
    }
  }, [linked.requested, linked.loading]);
  if (!linked.requested) return null;
  return (
    <section
      ref={container}
      tabIndex={-1}
      aria-label="Registro del enlace"
      className="min-w-0 space-y-4 rounded-2xl border border-kova-border bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Registro del enlace</h2>
        <Button
          className="h-auto min-h-11 whitespace-normal"
          variant="ghost"
          onClick={linked.close}
        >
          Cerrar registro del enlace
        </Button>
      </div>
      {linked.loading && (
        <p role="status">Consultando el registro solicitado…</p>
      )}
      {linked.error && (
        <div className="space-y-3">
          <p role="alert">{linked.error}</p>
          <Button
            className="h-auto min-h-11 whitespace-normal"
            variant="outline"
            onClick={linked.reload}
          >
            Consultar registro de nuevo
          </Button>
        </div>
      )}
      {!linked.loading && !linked.error && children}
    </section>
  );
}
