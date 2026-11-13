import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type PreviewDevice = "phone" | "computer";

const viewports: Record<PreviewDevice, { width: number; height: number }> = {
  phone: { width: 390, height: 780 },
  computer: { width: 1280, height: 860 },
};

/**
 * Renders real customer-facing components inside an empty same-document
 * iframe sized like a phone or a computer. Responsive classes (`sm:`, `lg:`)
 * then follow the iframe's width, so the preview has the true layout instead
 * of the owner's screen layout. The iframe loads no URL (no framing headers
 * apply), receives copies of the app's stylesheets, is scaled to fit, can be
 * scrolled, and is kept out of keyboard and pointer interaction.
 */
export function DevicePreview({
  device,
  title,
  children,
  className,
}: {
  device: PreviewDevice;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [available, setAvailable] = useState(0);
  const { width, height } = viewports[device];

  useLayoutEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write("<!doctype html><html lang=\"es-MX\"><head><meta charset=\"utf-8\"></head><body></body></html>");
    doc.close();
    for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
      doc.head.appendChild(node.cloneNode(true));
    }
    doc.documentElement.style.colorScheme = "light";
    doc.body.style.margin = "0";
    const root = doc.createElement("div");
    // Inert: no focus or clicks inside, while the frame itself still scrolls.
    root.setAttribute("inert", "");
    root.style.userSelect = "none";
    doc.body.appendChild(root);
    setMount(root);
    return () => { root.remove(); setMount(null); };
  }, []);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const update = () => setAvailable(element.clientWidth);
    update();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bezel = 12;
  const scale = available > bezel ? Math.min(1, (available - bezel) / width) : 1;
  return (
    <div ref={box} className={className}>
      <div
        className="relative mx-auto overflow-hidden rounded-[1.75rem] border-[6px] border-kova-ink bg-white shadow-kova-card"
        style={{ width: width * scale + bezel, height: height * scale + bezel }}
      >
        <iframe
          ref={frame}
          title={title}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute left-0 top-0 block border-0 bg-white"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        />
      </div>
      {mount && createPortal(children, mount)}
    </div>
  );
}
