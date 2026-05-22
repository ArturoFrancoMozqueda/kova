import { useEffect } from "react";

const DEFAULT_TITLE = "kova · POS para tu negocio";

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) {
      document.title = DEFAULT_TITLE;
      return;
    }
    document.title = `${title} · Kova`;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
