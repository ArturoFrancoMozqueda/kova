import { invalidateReportsCache } from "@/reports/api";
import type { Expense, ExpensePayload } from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

function query(startDate: string, endDate: string): string {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  return `?${params.toString()}`;
}

export function listExpenses(startDate: string, endDate: string): Promise<Expense[]> {
  return requestJson(`/api/v1/expenses${query(startDate, endDate)}`);
}

export async function createExpense(payload: ExpensePayload): Promise<Expense> {
  const expense = await requestJson<Expense>("/api/v1/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
  invalidateReportsCache();
  return expense;
}

export async function updateExpense(id: string, payload: ExpensePayload): Promise<Expense> {
  const expense = await requestJson<Expense>(`/api/v1/expenses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
  invalidateReportsCache();
  return expense;
}

export async function deleteExpense(id: string): Promise<Expense> {
  const expense = await requestJson<Expense>(`/api/v1/expenses/${id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  invalidateReportsCache();
  return expense;
}
