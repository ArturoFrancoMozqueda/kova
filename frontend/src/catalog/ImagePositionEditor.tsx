import { useEffect, useRef, useState } from "react";
import { Minus, Plus, LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import { productImageStyle } from "@/catalog/imageUrl";
import { copy } from "@/i18n/messages";

type Props = {
  src: string;
  positionX: number;
  positionY: number;
  zoom: number;
  onPositionChange: (x: number, y: number) => void;
  onZoomChange: (zoom: number) => void;
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ImagePositionEditor({
  src,
  positionX,
  positionY,
  zoom,
  onPositionChange,
  onZoomChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const initialPinchDistance = useRef<number | null>(null);
  const initialPinchZoom = useRef<number>(zoom);
  const [dragging, setDragging] = useState(false);

  // Wheel zoom — must use passive:false to call preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      onZoomChange(clamp(zoom + delta, ZOOM_MIN, ZOOM_MAX));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoom, onZoomChange]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      isDragging.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
    } else if (activePointers.current.size === 2) {
      // Start pinch
      isDragging.current = false;
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      initialPinchDistance.current = dist;
      initialPinchZoom.current = zoom;
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      // Pinch zoom
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (initialPinchDistance.current && initialPinchDistance.current > 0) {
        const ratio = dist / initialPinchDistance.current;
        onZoomChange(clamp(initialPinchZoom.current * ratio, ZOOM_MIN, ZOOM_MAX));
      }
      return;
    }

    if (!isDragging.current || !lastPointer.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    // Dragging right pans focal point left (negative dxPct)
    const dxPct = (dx / rect.width) * 100;
    const dyPct = (dy / rect.height) * 100;
    onPositionChange(
      clamp(positionX - dxPct, 0, 100),
      clamp(positionY - dyPct, 0, 100),
    );
    lastPointer.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size === 0) {
      isDragging.current = false;
      lastPointer.current = null;
      initialPinchDistance.current = null;
      setDragging(false);
    }
  }

  function handleReset() {
    onPositionChange(50, 50);
    onZoomChange(1.0);
  }

  const zoomDisplay = zoom.toFixed(1);

  return (
    <div className="space-y-2">
      {/* WYSIWYG preview / drag target */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          "relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted select-none touch-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        aria-label="Editor de encuadre. Arrastra para mover, rueda del mouse para zoom."
        role="img"
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full pointer-events-none"
          style={productImageStyle({ image_position_x: positionX, image_position_y: positionY, image_zoom: zoom })}
        />
      </div>

      {/* Hint */}
      <p className="text-xs text-muted-foreground">{copy.catalog.productImageEditorHint}</p>

      {/* Zoom controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground/70 w-10 shrink-0">
          {copy.catalog.productImageZoomLabel}
        </span>
        <button
          type="button"
          aria-label={copy.catalog.productImageZoomDecrease}
          onClick={() => onZoomChange(clamp(zoom - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
          disabled={zoom <= ZOOM_MIN}
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-foreground/70 transition-colors hover:bg-muted disabled:opacity-40"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span
          aria-live="polite"
          aria-atomic="true"
          className="w-10 text-center text-sm tabular-nums font-medium"
        >
          {zoomDisplay}×
        </span>
        <button
          type="button"
          aria-label={copy.catalog.productImageZoomIncrease}
          onClick={() => onZoomChange(clamp(zoom + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
          disabled={zoom >= ZOOM_MAX}
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-foreground/70 transition-colors hover:bg-muted disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="ml-auto flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground/70 transition-colors hover:bg-muted"
        >
          <LocateFixed className="h-3 w-3" />
          {copy.catalog.productImageCenter}
        </button>
      </div>
    </div>
  );
}
