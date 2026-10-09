import { useCallback, useEffect, useRef, useState } from "react";
import { getDrawerStatus, openDrawer, type DrawerStatus } from "./api";

export function useCashDrawer() {
  const [device, setDevice] = useState<DrawerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void getDrawerStatus().then(status => { if (!cancelled) setDevice(status); }).catch(() => {
        if (!cancelled) setDevice(current => current ? { ...current, online: false } : null);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { mounted.current = false; cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  const open = useCallback(async (kind: "sale" | "manual", reason = "", orderId?: string) => {
    if (!mounted.current || !device?.configured || (kind === "sale" && !device.auto_open)) return;
    if (running.current) {
      setMessage("Hay una apertura en curso. Verifica el cajón y usa la llave si es necesario.");
      return;
    }
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      const status = await openDrawer(kind, reason, orderId);
      if (mounted.current && status !== "disabled") setMessage(status === "sent"
        ? "Orden enviada al cajón. Verifica que se abrió."
        : `No se pudo confirmar la apertura del cajón. Usa la llave.${kind === "sale" ? " La venta permanece guardada." : ""}`);
    } catch {
      if (mounted.current) setMessage(`No se pudo abrir el cajón. Revisa el conector o usa la llave.${kind === "sale" ? " La venta permanece guardada." : ""}`);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [device]);
  return { device, busy, message, open };
}
