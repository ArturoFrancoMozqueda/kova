export type Category = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
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
  is_active: boolean;
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
