import { useCallback, useEffect, useRef, useState } from "react";
import { getDrawerStatus, openDrawer, type DrawerStatus } from "./api";

const DRAWER_POLL_MS = 15000;

export function useCashDrawer() {
  const [device, setDevice] = useState<DrawerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);

  const cancelledRef = useRef(false);
  const refresh = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    void getDrawerStatus().then(status => { if (!cancelledRef.current) setDevice(status); }).catch(() => {
      if (!cancelledRef.current) setDevice(current => current ? { ...current, online: false } : null);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    cancelledRef.current = false;
    refresh();
    window.addEventListener("focus", refresh);
    return () => { mounted.current = false; cancelledRef.current = true; window.removeEventListener("focus", refresh); };
  }, [refresh]);

  // Poll connector health only while a drawer is configured. Most counters
  // have none; for them a check on mount and on focus is enough.
  const configured = device?.configured === true;
  useEffect(() => {
    if (!configured) return;
    const timer = window.setInterval(refresh, DRAWER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [configured, refresh]);

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
