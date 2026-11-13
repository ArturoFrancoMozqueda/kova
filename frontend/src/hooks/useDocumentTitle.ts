import { useEffect } from "react";

const DEFAULT_TITLE = "kova · POS para tu negocio";

/** `false` leaves the title alone, e.g. for a page rendered as an owner preview. */
export function useDocumentTitle(title: string | null | undefined | false): void {
  useEffect(() => {
    if (title === false) return;
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
