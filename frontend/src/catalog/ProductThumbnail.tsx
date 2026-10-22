import { useState } from "react";
import { Package, RefreshCw } from "lucide-react";
import { copy } from "@/i18n/messages";
import type { Product } from "./types";
import { productImageSrc, productImageSrcSet, productImageStyle } from "./imageUrl";

type ThumbnailProduct = Pick<Product,
  "name" | "image_url" | "image_position_x" | "image_position_y" | "image_zoom">;

export function ProductThumbnail({ product }: { product: ThumbnailProduct }) {
  return <Thumbnail key={product.image_url ?? "missing"} product={product} />;
}

function Thumbnail({ product }: { product: ThumbnailProduct }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-kova-md bg-kova-mist lg:h-11 lg:w-11">
      {!product.image_url ? <>
        <Package aria-hidden="true" className="h-8 w-8 text-muted-foreground/60" />
        <span className="sr-only">Sin fotografía</span>
      </> : failed ? <button
        type="button"
        aria-label={`Volver a cargar la foto de ${product.name}`}
        title="Fotografía no disponible. Volver a cargar"
        onClick={event => {
          event.stopPropagation();
          setLoaded(false);
          setFailed(false);
          setAttempt(current => current + 1);
        }}
        className="flex h-full w-full items-center justify-center rounded-kova-md text-muted-foreground hover:text-kova-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <RefreshCw aria-hidden="true" className="h-5 w-5" />
      </button> : <>
        {!loaded && <span className="absolute inset-0 animate-pulse bg-kova-border/40 motion-reduce:animate-none">
          <span className="sr-only">{`Cargando fotografía de ${product.name}`}</span>
        </span>}
        <img
          key={attempt}
          src={productImageSrc(product.image_url, 160)}
          srcSet={productImageSrcSet(product.image_url)}
          sizes="(min-width: 1024px) 44px, 48px"
          width={48}
          height={48}
          alt={copy.catalog.productImageAlt(product.name)}
          className={`h-full w-full ${loaded ? "" : "opacity-0"}`}
          style={productImageStyle(product)}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      </>}
    </div>
  );
}
