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
