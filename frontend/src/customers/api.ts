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
export type CustomerActivitySource = "appointments" | "customer_orders" | "opportunities" | "followups" | "service_cases";
export type CustomerActivity = {
  branch_id: string;
  sections: {
    source: CustomerActivitySource;
    items: { id: string; title: string; state: string; created_at: string; due_at: string | null }[];
    has_more: boolean;
  }[];
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
  init?: RequestInit,
): Promise<CustomerHistory> {
  return request(`/api/v1/customers/${encodeURIComponent(id)}/history?offset=${offset}`, init);
}

export function getCustomer(id: string, init?: RequestInit): Promise<Customer> {
  return request(`/api/v1/customers/${encodeURIComponent(id)}`, init);
}

export function customerActivity(id: string, init?: RequestInit): Promise<CustomerActivity> {
  return request(`/api/v1/customers/${encodeURIComponent(id)}/activity`, init);
}

/** Resolve the exact customer in the current authenticated business, never a list sample. */
export async function resolveActiveCustomer(id: string, init?: RequestInit): Promise<Customer> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("El enlace no contiene un cliente válido.");
  }
  const customer = await getCustomer(id, init);
  if (customer.id.toLowerCase() !== id.toLowerCase() || !customer.is_active) {
    throw new Error("Este cliente no está disponible para una nueva venta o cita.");
  }
  return customer;
}
