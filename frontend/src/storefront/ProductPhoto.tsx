import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { productImageSrc, productImageSrcSet, productImageStyle } from "@/catalog/imageUrl";

export type ProductPhotoData = {
  name: string;
  image_url?: string | null;
  image_position_x?: number | null;
  image_position_y?: number | null;
  image_zoom?: number | null;
};

/** A changing upload revision remounts the image, clearing an old load error. */
export function ProductPhoto({ product, compact = false, menu = false, priority = false }: {
  product: ProductPhotoData;
  compact?: boolean;
  menu?: boolean;
  priority?: boolean;
}) {
  return <Photo key={product.image_url ?? "missing"} product={product} compact={compact} menu={menu} priority={priority} />;
}

function Photo({ product, compact, menu, priority }: { product: ProductPhotoData; compact: boolean; menu: boolean; priority: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = product.image_url;
  const unavailable = !url || failed;
  return (
    <div className={compact
      ? "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-kova-mist"
      : `relative w-full overflow-hidden bg-kova-mist ${menu ? "aspect-[4/3] lg:aspect-square lg:rounded-xl" : "aspect-square rounded-t-2xl"}`}>
      {(!loaded || unavailable) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-kova-muted">
          <ImageIcon className="h-6 w-6" aria-hidden="true" />
          {!compact && <span className="text-center text-xs">{failed
            ? "Fotografía no disponible" : url ? "Cargando fotografía…" : "Sin fotografía"}</span>}
          {compact && unavailable && <span className="sr-only">{failed
            ? "Fotografía no disponible" : "Sin fotografía"}</span>}
        </div>
      )}
      {url && !failed && <img
        src={productImageSrc(url, compact ? 160 : 400)}
        srcSet={compact ? productImageSrcSet(url)
          : `${productImageSrcSet(url)}, ${productImageSrc(url, 800)} 800w`}
        sizes={compact ? "64px" : menu ? "(min-width: 1024px) 112px, (min-width: 640px) calc((100vw - 88px) / 3), calc((100vw - 48px) / 3)" : "auto, (min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"}
        alt={compact ? "" : product.name}
        width={compact ? 64 : 800}
        height={compact ? 64 : 800}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        referrerPolicy="no-referrer"
        className={`h-full w-full ${loaded ? "" : "opacity-0"}`}
        style={productImageStyle(product)}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />}
    </div>
  );
}
