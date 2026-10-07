import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Keep the prerendered indexing policy when React navigates without a reload.
// In particular, returning from signup/legal pages must clear their noindex.
export default function RouteIndexing() {
  const { pathname } = useLocation();

  useEffect(() => {
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (pathname === "/") {
      existing?.remove();
      return;
    }
    const meta = existing ?? document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    if (!existing) document.head.appendChild(meta);
  }, [pathname]);

  return null;
}
