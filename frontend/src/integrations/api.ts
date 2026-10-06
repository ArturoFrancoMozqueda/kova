import { csrfHeaders } from "@/lib/csrf";

export type FiscalIdentity = {
  rfc: string;
  legal_name: string;
  postal_code: string;
  tax_regime: string;
};
export type InvoiceRecipient = FiscalIdentity & {
  cfdi_use: string;
  email: string;
};
export type Readiness = {
  cfdi_status: "not_connected";
  terminal_status: "not_connected";
  can_issue_cfdi: false;
  can_charge_terminal: false;
  issuer: FiscalIdentity | null;
  validation_scope: "format_only";
};
export type InvoiceRequest = {
  id: string;
  order_id: string;
  recipient_snapshot: InvoiceRecipient;
  total_amount: string;
  status: "pending_provider";
  fiscal_status: "not_issued";
  created_at: string;
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/integrations/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(init?.method),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : "Revisa los datos e inténtalo de nuevo.",
    );
  }
  return response.json() as Promise<T>;
}
export const getReadiness = () => request<Readiness>("readiness");
export const saveIssuer = (body: FiscalIdentity) =>
  request<Readiness>("issuer", { method: "PUT", body: JSON.stringify(body) });
export const listInvoiceRequests = () =>
  request<InvoiceRequest[]>("invoice-requests");
export const createInvoiceRequest = (
  order_id: string,
  recipient: InvoiceRecipient,
  key: string,
) =>
  request<InvoiceRequest>("invoice-requests", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ order_id, recipient }),
  });
