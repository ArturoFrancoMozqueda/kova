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
  track_inventory: boolean;
  low_stock_threshold: number | null;
  image_url: string | null;
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
  category_id?: string | null;
  track_inventory?: boolean;
  low_stock_threshold?: number | null;
};

export type ProductUpdate = {
  name?: string;
  description?: string | null;
  sku?: string | null;
  price_amount?: string;
  category_id?: string | null;
  track_inventory?: boolean;
  low_stock_threshold?: number | null;
  is_active?: boolean;
};
