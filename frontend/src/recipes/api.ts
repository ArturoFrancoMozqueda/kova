import { csrfHeaders } from "@/lib/csrf";
import { ApiError } from "@/catalog/api";
import type { StockUnit } from "@/catalog/units";

export type IngredientLine = { ingredient_product_id: string; quantity: number };

export type CostedLine = IngredientLine & {
  ingredient_name: string;
  stock_unit: StockUnit;
  /** Cost of this quantity; null when the ingredient has no known cost. */
  cost: string | null;
};

export type Recipe = {
  product_id: string;
  version: number | null;
  effective_from: string | null;
  lines: CostedLine[];
  /** Cost of one sold unit; null when any ingredient lacks a cost. */
  cost: string | null;
  known_cost: string;
  ingredients_without_cost: number;
};

export type OptionConsumption = {
  modifier_option_id: string;
  lines: CostedLine[];
  cost_delta: string | null;
};

async function request<T>(url: string, method = "GET", body?: unknown, key?: string): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...csrfHeaders(method),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ApiError(await response.text(), response.status);
  return (await response.json()) as T;
}

export const getRecipe = (productId: string) =>
  request<Recipe>(`/api/v1/catalog/products/${productId}/recipe`);

/** The key is kept by the caller so a retried save after a lost response is not a new version. */
export const saveRecipe = (productId: string, lines: IngredientLine[], key: string) =>
  request<Recipe>(`/api/v1/catalog/products/${productId}/recipe`, "PUT", { lines }, key);

export const getOptionConsumption = (optionId: string) =>
  request<OptionConsumption>(`/api/v1/catalog/modifier-options/${optionId}/consumption`);

export const saveOptionConsumption = (optionId: string, lines: IngredientLine[], key: string) =>
  request<OptionConsumption>(`/api/v1/catalog/modifier-options/${optionId}/consumption`, "PUT", { lines }, key);

export type BatchRecipe = Recipe & {
  batch_yield: number | null;
  /** Ingredient cost per expected piece; null when incomplete or there is no recipe. */
  cost_per_piece: string | null;
};

export const getBatchRecipe = (productId: string) =>
  request<BatchRecipe>(`/api/v1/catalog/products/${productId}/batch-recipe`);

export const saveBatchRecipe = (productId: string, batchYield: number, lines: IngredientLine[], key: string) =>
  request<BatchRecipe>(`/api/v1/catalog/products/${productId}/batch-recipe`, "PUT", { batch_yield: batchYield, lines }, key);

export type WasteReason = "merma" | "caducidad" | "robo" | "daño" | "autoconsumo" | "otro";

export type ProductionInput = {
  product_id: string;
  batches: number;
  actual_quantity: number;
  waste_reason_code?: WasteReason;
  notes?: string;
  update_catalog_cost: boolean;
};

export type ProductionBatch = {
  id: string;
  product_id: string;
  product_name: string;
  recipe_version: number;
  batches: number;
  expected_quantity: number;
  actual_quantity: number;
  shortfall: number;
  waste_reason_code: WasteReason | null;
  ingredient_cost: string | null;
  unit_cost: string | null;
  catalog_cost_updated: boolean;
  notes: string | null;
  created_at: string;
  consumed: CostedLine[];
};

/** The key is kept by the caller so a retry after a lost response records one batch. */
export const recordProduction = (body: ProductionInput, key: string) =>
  request<ProductionBatch>("/api/v1/inventory/production", "POST", body, key);
