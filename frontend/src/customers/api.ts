import { csrfHeaders } from "@/lib/csrf";

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};
export type CustomerWrite = Pick<
  Customer,
  "name" | "email" | "phone" | "is_active"
>;
export type CustomerHistory = {
  customer: Customer;
  purchases: {
    id: string;
    branch_id: string;
    occurred_at: string;
    status: string;
    total_amount: string;
    refunded_amount: string;
  }[];
  limit: number;
  offset: number;
  has_more: boolean;
};
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = "No pudimos cargar los clientes. Inténtalo de nuevo.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* Use default message. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
export function listCustomers(
  q = "",
  offset = 0,
  includeInactive = false,
): Promise<Customer[]> {
  return request(
    `/api/v1/customers?${new URLSearchParams({ q, offset: String(offset), include_inactive: String(includeInactive) })}`,
  );
}
export function saveCustomer(
  body: CustomerWrite,
  id?: string,
): Promise<Customer> {
  const method = id ? "PUT" : "POST";
  return request(`/api/v1/customers${id ? `/${id}` : ""}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(method),
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
export function customerHistory(
  id: string,
  offset = 0,
): Promise<CustomerHistory> {
  return request(`/api/v1/customers/${id}/history?offset=${offset}`);
}
