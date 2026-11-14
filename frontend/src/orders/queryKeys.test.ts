import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../lib/queryClient";
import { ORDERS_QUERY_KEY, invalidateOrderLists } from "./queryKeys";

describe("invalidateOrderLists", () => {
  afterEach(() => { vi.restoreAllMocks(); queryClient.clear(); });

  it("marks every cached sales list stale so /orders shows new, voided or refunded sales", () => {
    queryClient.setQueryData([...ORDERS_QUERY_KEY, "all", "2026-11-01", "2026-11-13"], { items: [] });
    queryClient.setQueryData(["customers"], []);
    invalidateOrderLists();
    expect(queryClient.getQueryState([...ORDERS_QUERY_KEY, "all", "2026-11-01", "2026-11-13"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["customers"])?.isInvalidated).toBe(false);
  });
});
