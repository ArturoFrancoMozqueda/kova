import { useEffect, useRef, useState } from "react";
import { LocateFixed, Minus, Plus, Scan } from "lucide-react";
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
const FRAME_CORNERS = [
  "left-2 top-2 border-l border-t",
  "right-2 top-2 border-r border-t",
  "bottom-2 left-2 border-b border-l",
  "bottom-2 right-2 border-b border-r",
] as const;

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
  const imageStyle = productImageStyle({
    image_position_x: positionX,
    image_position_y: positionY,
    image_zoom: zoom,
  });

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-950 p-4 sm:p-5">
          <img
            src={src}
            alt=""
            draggable={false}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-md"
            style={{ objectPosition: `${positionX}% ${positionY}%` }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(0,0,0,0.16)_42%,rgba(0,0,0,0.62)_100%)]" />
          <div className="relative flex h-full items-center justify-center">
            <div
              ref={containerRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={cn(
                "group relative aspect-video w-full max-w-[92%] overflow-hidden rounded-md border-2 border-white bg-muted shadow-2xl ring-1 ring-black/30 select-none touch-none",
                dragging ? "cursor-grabbing" : "cursor-grab",
              )}
              aria-label={copy.catalog.productImageFrameLabel}
              role="img"
            >
              <img
                src={src}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full pointer-events-none"
                style={imageStyle}
              />
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute inset-y-0 left-1/3 border-l border-white/45" />
                <div className="absolute inset-y-0 left-2/3 border-l border-white/45" />
                <div className="absolute inset-x-0 top-1/3 border-t border-white/45" />
                <div className="absolute inset-x-0 top-2/3 border-t border-white/45" />
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/20"
              />
              {FRAME_CORNERS.map((classes) => (
                <span
                  key={classes}
                  aria-hidden="true"
                  className={cn("pointer-events-none absolute h-7 w-7 border-white drop-shadow", classes)}
                />
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute left-4 top-4 hidden items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm sm:flex">
            <Scan className="h-3 w-3" />
            {copy.catalog.productImageFrameBadge}
          </div>
        </div>

        <div className="space-y-3 border-t border-border bg-background p-3">
          <p className="text-xs text-muted-foreground">{copy.catalog.productImageEditorHint}</p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground/70 w-10 shrink-0">
              {copy.catalog.productImageZoomLabel}
            </span>
            <button
              type="button"
              aria-label={copy.catalog.productImageZoomDecrease}
              onClick={() => onZoomChange(clamp(zoom - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
              disabled={zoom <= ZOOM_MIN}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground/70 transition-colors hover:bg-muted disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span
              aria-live="polite"
              aria-atomic="true"
              className="w-12 text-center text-sm tabular-nums font-medium"
            >
              {zoomDisplay}x
            </span>
            <button
              type="button"
              aria-label={copy.catalog.productImageZoomIncrease}
              onClick={() => onZoomChange(clamp(zoom + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
              disabled={zoom >= ZOOM_MAX}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground/70 transition-colors hover:bg-muted disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={copy.catalog.productImageCenter}
              onClick={handleReset}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-muted"
            >
              <LocateFixed className="h-3.5 w-3.5" />
              {copy.catalog.productImageCenter}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
