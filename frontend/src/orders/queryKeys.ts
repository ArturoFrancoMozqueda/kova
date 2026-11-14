import { queryClient } from "../lib/queryClient";

/** Query-key prefix shared by every cached sales list (`/orders`). */
export const ORDERS_QUERY_KEY = ["orders"] as const;

/** Marks cached sales lists stale after a sale is recorded, voided or
 * refunded, so `/orders` does not keep showing a list up to 30 s old. */
export function invalidateOrderLists(): void {
  void queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
}
