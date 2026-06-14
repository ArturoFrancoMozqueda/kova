import type { CSSProperties } from "react";
const WIDTHS = [160, 320, 400] as const;
const DEFAULT_IMAGE_POSITION = 50;

export function productImageSrcSet(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return WIDTHS.map((w) => `${url}${sep}w=${w} ${w}w`).join(", ");
}

export function productImageSrc(url: string, width: number = 400): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}w=${width}`;
}

export function productImageStyle(
  product: {
    image_position_x?: number | null;
    image_position_y?: number | null;
    image_zoom?: number | null;
  },
): CSSProperties {
  const x = product.image_position_x ?? DEFAULT_IMAGE_POSITION;
  const y = product.image_position_y ?? DEFAULT_IMAGE_POSITION;
  const zoom = product.image_zoom ?? 1.0;
  return {
    objectFit: "cover",
    objectPosition: `${x}% ${y}%`,
    transformOrigin: `${x}% ${y}%`,
    ...(zoom !== 1.0 && { transform: `scale(${zoom})` }),
  };
}
