import type { Product } from "@/catalog/types";

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("es-MX");
}

export function exactSkuMatches(products: Product[], query: string): Product[] {
  const value = normalized(query);
  if (!value) return [];
  return products.filter((product) => (normalized(product.sku ?? "") === value || normalized((product as Product & { barcode?: string | null }).barcode ?? "") === value));
}

export function skuSearchMatches(products: Product[], query: string): Product[] {
  const value = normalized(query);
  if (!value) return [];
  const exact = exactSkuMatches(products, value);
  if (exact.length > 0) return exact;
  return products.filter((product) =>
    normalized(product.sku ?? "").includes(value) || normalized((product as Product & { barcode?: string | null }).barcode ?? "").includes(value) || normalized(product.name).includes(value),
  );
}
