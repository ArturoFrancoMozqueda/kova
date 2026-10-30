import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";
import type { Product } from "@/catalog/types";
import { productImageSrc, productImageSrcSet, productImageStyle } from "@/catalog/imageUrl";

type PhotoProduct = Pick<Product,
  "image_url" | "image_position_x" | "image_position_y" | "image_zoom">;

/** Native lazy loading may prefetch a full screenful of unseen POS rows. */
export function RegisterProductPhoto({ product }: { product: PhotoProduct }) {
  return <ViewportPhoto key={product.image_url ?? "missing"} product={product} />;
}

function ViewportPhoto({ product }: { product: PhotoProduct }) {
  const element = useRef<HTMLDivElement>(null);
  const [admitted, setAdmitted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target || !product.image_url) return;
    if (typeof IntersectionObserver !== "function") {
      setAdmitted(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.target === target && entry.isIntersecting)) {
        setAdmitted(true);
        observer.disconnect();
      }
    }, { rootMargin: "0px", threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [product.image_url]);

  return <div
    ref={element}
    aria-hidden="true"
    className="relative h-20 w-full shrink-0 overflow-hidden rounded-lg bg-muted/50"
  >
    {product.image_url && (!admitted || !loaded) && !failed && <span className="absolute inset-0 bg-muted/50" />}
    {(failed || !product.image_url) && <span className="absolute inset-0 flex items-center justify-center text-muted-foreground/60">
      <Package className="h-5 w-5" />
    </span>}
    {admitted && product.image_url && !failed && <img
      src={productImageSrc(product.image_url, 400)}
      srcSet={productImageSrcSet(product.image_url)}
      // Auto sizing can select the intrinsic 400px width when this lazy image detaches.
      sizes="(max-width: 639px) 42vw, (max-width: 1279px) 22vw, 200px"
      width={400}
      height={400}
      alt=""
      loading="lazy"
      decoding="async"
      // React 18 supports native unknown attributes with their lowercase name.
      {...{ fetchpriority: "low" }}
      className={`h-full w-full ${loaded ? "" : "opacity-0"}`}
      style={productImageStyle(product)}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />}
  </div>;
}
