const WIDTHS = [160, 320, 400] as const;

export function productImageSrcSet(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return WIDTHS.map((w) => `${url}${sep}w=${w} ${w}w`).join(", ");
}

export function productImageSrc(url: string, width: number = 400): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}w=${width}`;
}
