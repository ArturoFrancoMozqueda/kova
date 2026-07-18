import { csrfHeaders } from "../lib/csrf";
import type {
  Category,
  CategoryCreate,
  CategoryUpdate,
  CatalogImportResponse,
  ModifierGroup,
  ModifierOption,
  Product,
  ProductCreate,
  ProductUpdate,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...csrfHeaders(init?.method),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

function ikey(): string {
  return crypto.randomUUID();
}

async function sendCatalogImport(
  file: File,
  dryRun: boolean,
): Promise<CatalogImportResponse> {
  const response = await fetch(`/api/v1/catalog/import?dry_run=${dryRun}`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      ...csrfHeaders("POST"),
      ...(dryRun ? {} : { "Idempotency-Key": ikey() }),
    },
    body: file,
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as CatalogImportResponse;
}

export function previewCatalogImport(file: File): Promise<CatalogImportResponse> {
  return sendCatalogImport(file, true);
}

export function commitCatalogImport(file: File): Promise<CatalogImportResponse> {
  return sendCatalogImport(file, false);
}

export const catalogImportTemplateUrl = "/api/v1/catalog/import/template";

export function listCategories(): Promise<Category[]> {
  return requestJson<Category[]>("/api/v1/catalog/categories");
}

export function createCategory(body: CategoryCreate): Promise<Category> {
  return requestJson<Category>("/api/v1/catalog/categories", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function updateCategory(id: string, body: CategoryUpdate): Promise<Category> {
  return requestJson<Category>(`/api/v1/catalog/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function deactivateCategory(id: string): Promise<Category> {
  return requestJson<Category>(`/api/v1/catalog/categories/${id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": ikey() },
  });
}

export function listProducts(): Promise<Product[]> {
  return requestJson<Product[]>("/api/v1/catalog/products");
}

// The product form value object carries client-only fields (image_file,
// image_remove, modifier_group_ids) that the API schema rejects now that it
// forbids unknown fields. Send only the declared schema fields.
function productPayload(body: ProductCreate | ProductUpdate) {
  return {
    name: body.name,
    description: body.description,
    sku: body.sku,
    price_amount: body.price_amount,
    cost_price: body.cost_price,
    category_id: body.category_id,
    track_inventory: body.track_inventory,
    low_stock_threshold: body.low_stock_threshold,
    image_position_x: body.image_position_x,
    image_position_y: body.image_position_y,
    image_zoom: body.image_zoom,
  };
}

export function createProduct(body: ProductCreate): Promise<Product> {
  return requestJson<Product>("/api/v1/catalog/products", {
    method: "POST",
    body: JSON.stringify(productPayload(body)),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function updateProduct(id: string, body: ProductUpdate): Promise<Product> {
  return requestJson<Product>(`/api/v1/catalog/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...productPayload(body), is_active: body.is_active }),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function deactivateProduct(id: string): Promise<Product> {
  return requestJson<Product>(`/api/v1/catalog/products/${id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": ikey() },
  });
}

export async function uploadProductImage(
  productId: string,
  file: File,
): Promise<{ image_url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`/api/v1/catalog/products/${productId}/image`, {
    method: "POST",
    headers: { ...csrfHeaders("POST") },
    body: formData,
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as { image_url: string };
}

export async function deleteProductImage(productId: string): Promise<void> {
  const response = await fetch(`/api/v1/catalog/products/${productId}/image`, {
    method: "DELETE",
    headers: { ...csrfHeaders("DELETE") },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
}

// ─── Modifier groups ─────────────────────────────────────────────────────────

export function listModifierGroups(): Promise<ModifierGroup[]> {
  return requestJson<ModifierGroup[]>("/api/v1/catalog/modifier-groups");
}

export function createModifierGroup(body: {
  name: string;
  is_required?: boolean;
  min_selections?: number;
  max_selections?: number;
}): Promise<ModifierGroup> {
  return requestJson<ModifierGroup>("/api/v1/catalog/modifier-groups", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function updateModifierGroup(
  id: string,
  body: { name?: string; is_required?: boolean; is_active?: boolean },
): Promise<ModifierGroup> {
  return requestJson<ModifierGroup>(`/api/v1/catalog/modifier-groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function deactivateModifierGroup(id: string): Promise<ModifierGroup> {
  return requestJson<ModifierGroup>(`/api/v1/catalog/modifier-groups/${id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": ikey() },
  });
}

export function createModifierOption(
  groupId: string,
  body: { name: string; price_delta: string },
): Promise<ModifierOption> {
  return requestJson<ModifierOption>(`/api/v1/catalog/modifier-groups/${groupId}/options`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function deactivateModifierOption(
  groupId: string,
  optionId: string,
): Promise<ModifierOption> {
  return requestJson<ModifierOption>(
    `/api/v1/catalog/modifier-groups/${groupId}/options/${optionId}`,
    { method: "DELETE" },
  );
}

export function setProductModifierGroups(
  productId: string,
  groupIds: string[],
): Promise<ModifierGroup[]> {
  const assignments = Array.from(
    new Set(groupIds.map((id) => id.trim()).filter(Boolean)),
  ).map((id, i) => ({ modifier_group_id: id, sort_order: i }));

  return requestJson<ModifierGroup[]>(`/api/v1/catalog/products/${productId}/modifier-groups`, {
    method: "PUT",
    body: JSON.stringify({
      assignments,
    }),
  });
}
