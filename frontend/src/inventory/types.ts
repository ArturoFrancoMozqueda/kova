export type StockItem = {
  product_id: string;
  product_name: string;
  sku: string | null;
  track_inventory: boolean;
  stock_on_hand: number;
  low_stock_threshold: number | null;
  is_low_stock: boolean;
};

export type MovementResponse = {
  id: string | null;
  product_id: string;
  movement_type: string;
  quantity_delta: number;
  stock_on_hand: number;
  reason: string;
};

export type MovementHistoryItem = {
  id: string;
  movement_type: string;
  quantity_delta: number;
  stock_on_hand_after: number | null;
  reason: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type MovementHistoryResponse = {
  items: MovementHistoryItem[];
  total: number;
  limit: number;
  offset: number;
};

export type InventoryVelocityItem = {
  product_id: string;
  product_name: string;
  units_per_day_7d: string;
  days_until_out: string | null;
  stock_on_hand: number;
};
