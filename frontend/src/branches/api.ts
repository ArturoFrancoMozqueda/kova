import { csrfHeaders } from "@/lib/csrf";

export type Branch = {
  id: string;
  name: string;
  address: string | null;
  created_at: string;
};
export type BranchProductSales = {
  product_id: string;
  product_name: string;
  net_quantity: number;
  net_sales: string;
};
export type BranchSales = {
  branch_id: string;
  branch_name: string;
  completed_orders: number;
  gross_sales: string;
  refunded_amount: string;
  net_sales: string;
  average_ticket: string;
  share_pct: string;
  products: BranchProductSales[];
};
export type BranchComparison = {
  start_date: string;
  end_date: string;
  timezone: string;
  total_net_sales: string;
  leader_branch_ids: string[];
  branches: BranchSales[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = "No pudimos cargar las sucursales. Inténtalo de nuevo.";
    try {
      const body: { detail?: unknown } = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* Use the actionable default if the response is not JSON. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function listBranches(tenantId?: string): Promise<Branch[]> {
  // Discovery must remain possible after restoring a DB with fewer branches.
  return request(
    "/api/v1/branches",
    tenantId ? { headers: { "X-Kova-Branch": tenantId } } : undefined,
  );
}

export function saveBranch(
  name: string,
  address: string,
  id?: string,
): Promise<Branch> {
  const method = id ? "PATCH" : "POST";
  return request(`/api/v1/branches${id ? `/${id}` : ""}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(method),
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      name: name.trim(),
      address: address.trim() || null,
    }),
  });
}

export function compareBranches(
  start: string,
  end: string,
): Promise<BranchComparison> {
  const query = new URLSearchParams({ start_date: start, end_date: end });
  return request(`/api/v1/reports/branches?${query}`);
}
