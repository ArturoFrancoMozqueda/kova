import { useCallback, useState } from "react";

/**
 * Click-to-lock + hover/focus-preview selection, shared by every report chart.
 * `selectedId` is sticky (set by click, toggles off on a second click);
 * `previewId` is transient (hover/focus). The active row is the selection, or
 * the preview when nothing is locked — mirroring the pre-Recharts behavior.
 */
export function useChartSelection(initialSelectedId: string | null = null) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  }, []);

  const preview = useCallback((id: string | null) => {
    setPreviewId(id);
  }, []);

  const activeId = selectedId ?? previewId;

  return { selectedId, previewId, activeId, toggle, preview };
}
