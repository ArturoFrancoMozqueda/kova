export type Category = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type ModifierOption = {
  id: string;
  group_id: string;
  name: string;
  price_delta: string;
  sort_order: number;
  is_active: boolean;
};

export type ModifierGroup = {
  id: string;
  tenant_id: string;
  name: string;
  is_required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  is_active: boolean;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  price_amount: string;
  // Optional for compatibility with catalog rows cached by older PWA bundles.
  // The API returns null when cost is unknown or hidden for the current role.
  cost_price?: string | null;
  track_inventory: boolean;
  low_stock_threshold: number | null;
  image_url: string | null;
  image_position_x: number;
  image_position_y: number;
  image_zoom: number;
  is_active: boolean;
  modifier_groups: ModifierGroup[];
};

export type CategoryCreate = {
  name: string;
  description?: string | null;
  sort_order?: number;
};

export type CategoryUpdate = {
  name?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export type ProductCreate = {
  name: string;
  description?: string | null;
  sku?: string | null;
  price_amount: string;
  cost_price?: string | null;
  category_id?: string | null;
  track_inventory?: boolean;
  low_stock_threshold?: number | null;
  image_position_x?: number;
  image_position_y?: number;
  image_zoom?: number;
};

export type ProductUpdate = {
  name?: string;
  description?: string | null;
  sku?: string | null;
  price_amount?: string;
  cost_price?: string | null;
  category_id?: string | null;
  track_inventory?: boolean;
  low_stock_threshold?: number | null;
  image_position_x?: number;
  image_position_y?: number;
  image_zoom?: number;
  is_active?: boolean;
};

export type CatalogImportRow = {
  row_number: number;
  status: "valid" | "error";
  normalized: {
    name: string;
    sku: string | null;
    price_amount: string | null;
    cost_price: string | null;
    category_name: string | null;
    track_inventory: boolean;
    initial_stock: number;
    low_stock_threshold: number | null;
  };
  errors: string[];
};

export type CatalogImportResponse = {
  dry_run: boolean;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  rows: CatalogImportRow[];
  created_products: number;
  created_categories: number;
  initial_stock_movements: number;
};
