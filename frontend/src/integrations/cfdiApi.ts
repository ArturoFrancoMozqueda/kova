import { csrfHeaders } from "@/lib/csrf";
import type { FiscalIdentity, InvoiceRecipient } from "./api";

export type CfdiEnvironment = "test" | "live";
export type CfdiConnection = {
  environment: CfdiEnvironment;
  organization_id: string;
  connected: boolean;
  issuer_rfc: string | null;
  production_ready: boolean;
  certificate_expires_at: string | null;
};
export type CfdiStatus = {
  provider: "facturapi";
  storage_available: boolean;
  connections: CfdiConnection[];
};
export type ManagedCfdiSetup = {
  available: boolean;
  state: "not_started" | "creating" | "unknown" | "configured" | "error" | "legacy";
  issuer: FiscalIdentity | null;
  organization_created: boolean;
  test_connected: boolean;
  live_connected: boolean;
  production_ready: boolean;
  certificate_expires_at: string | null;
  last_error_code: string | null;
  manifest_url: "https://www.facturapi.io/embedded/manifiesto" | null;
};
// These are fixed public validation messages from the managed setup backend.
// Never forward arbitrary provider details, which can contain fiscal secrets.
const managedPublicErrors = new Set([
  "El archivo .cer debe pesar hasta 64 KB.",
  "El archivo .key debe pesar hasta 64 KB.",
  "La contraseña del CSD debe tener entre 1 y 256 caracteres.",
  "Revisa la contraseña del CSD.",
  "Configura primero el RFC del negocio.",
  "No se pudo leer el certificado .cer.",
  "El certificado CSD todavía no está vigente.",
  "El certificado CSD está vencido. Carga uno vigente.",
  "El RFC del certificado debe coincidir con el RFC del negocio.",
  "Carga tu Certificado de Sello Digital (CSD), no tu e.firma.",
  "No se pudo abrir el .key. Revisa el archivo y su contraseña.",
  "El archivo .key debe corresponder al certificado CSD .cer.",
  "La razón social debe tener como máximo 100 caracteres para facturación",
  "La activación fiscal está en curso; espera y actualiza su estado",
  "Activa primero la facturación de tu negocio",
  "La conexión fiscal existente requiere una migración asistida",
  "El RFC de una organización fiscal activada no puede reemplazarse",
  "La activación cambió; actualiza su estado antes de continuar",
  "La activación de facturación de Kova aún no está disponible",
]);
const fiscalError = "No pudimos completar la operación fiscal. Revisa el estado antes de reintentar.";
export class ManagedCfdiError extends Error {
  constructor(message: string) {
    super(managedPublicErrors.has(message) ? message : fiscalError);
  }
}
export type TaxKind = "iva16" | "iva8" | "iva0" | "exempt" | "not_subject";
export type PaymentForm = "01" | "03" | "04" | "28";
export type InvoiceContext = {
  request_id: string;
  order_id: string;
  issuer: FiscalIdentity;
  recipient: InvoiceRecipient;
  total_amount: string;
  discount_amount: string;
  lines: {
    order_item_id: string;
    product_name: string;
    quantity: number;
    unit_price_amount: string;
    discount_amount: string;
    tax_amount: string;
    line_total_amount: string;
  }[];
  payments: { method: string; amount: string }[];
  suggested_payment_forms: PaymentForm[];
};
export type InvoicePreparation = {
  recipient?: InvoiceRecipient;
  request_id: string;
  environment: CfdiEnvironment;
  payment_form: PaymentForm;
  lines: {
    order_item_id: string;
    product_key: string;
    unit_key: string;
    tax_kind: TaxKind;
    tax_included: boolean;
  }[];
};
export type InvoicePreview = {
  recipient_snapshot: InvoiceRecipient;
  request_id: string;
  order_id: string;
  environment: CfdiEnvironment;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  lines: {
    order_item_id: string;
    product_name: string;
    quantity: number;
    product_key: string;
    unit_key: string;
    tax_kind: TaxKind;
    tax_included: boolean;
    unit_price_amount: string;
    gross_amount: string;
    discount_amount: string;
    tax_amount: string;
    total_amount: string;
  }[];
};
export type CfdiDocument = {
  recipient_snapshot: InvoiceRecipient;
  id: string;
  request_id: string;
  order_id: string;
  environment: CfdiEnvironment;
  state:
    | "prepared"
    | "submitting"
    | "unknown"
    | "pending"
    | "issued"
    | "cancel_pending"
    | "canceled"
    | "rejected"
    | "integrity_error";
  provider_id?: string | null;
  uuid?: string | null;
  total_amount: string;
  created_at: string;
  updated_at: string;
  last_error_code?: string | null;
  cancellation_status?: string | null;
  xml_available: boolean;
};

async function apiClient(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api/v1/integrations/cfdi/${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...csrfHeaders(init?.method),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const data: { detail?: unknown } | null = await response
      .json()
      .catch(() => null);
    if (path === "setup" || path.startsWith("setup/")) {
      if (
        [400, 409].includes(response.status) &&
        typeof data?.detail === "string" &&
        managedPublicErrors.has(data.detail)
      ) throw new ManagedCfdiError(data.detail);
      throw new Error(fiscalError);
    }
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : fiscalError,
    );
  }
  return response;
}
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiClient(path, init)).json() as Promise<T>;
}
function post<T>(path: string, body: unknown, key?: string): Promise<T> {
  return json(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: key ? { "Idempotency-Key": key } : {},
  });
}
export const getCfdiStatus = () => json<CfdiStatus>("status");
export const getManagedCfdiSetup = () => json<ManagedCfdiSetup>("setup");
export const startManagedCfdiSetup = (issuer: FiscalIdentity) =>
  post<ManagedCfdiSetup>("setup", { issuer });
export const refreshManagedCfdiSetup = () =>
  json<ManagedCfdiSetup>("setup/refresh", { method: "POST" });
export const uploadCfdiCertificate = (
  cer: File,
  key: File,
  password: string,
) => {
  const body = new FormData();
  body.append("cer", cer);
  body.append("key", key);
  body.append("password", password);
  return json<ManagedCfdiSetup>("setup/certificate", { method: "POST", body });
};
export const connectCfdi = (environment: CfdiEnvironment, api_key: string) =>
  json<CfdiConnection>("connection", {
    method: "PUT",
    body: JSON.stringify({ environment, api_key }),
  });
export const refreshCfdiConnection = (environment: CfdiEnvironment) =>
  post<CfdiConnection>("connection/refresh", { environment });
export const getInvoiceContext = (requestId: string) =>
  json<InvoiceContext>(`requests/${encodeURIComponent(requestId)}/context`);
export const previewCfdi = (body: InvoicePreparation) =>
  post<InvoicePreview>("preview", body);
export const issueCfdi = (body: InvoicePreparation, key: string) =>
  post<CfdiDocument>("documents", body, key);
export const listCfdiDocuments = () => json<CfdiDocument[]>("documents");
export const reconcileCfdi = (id: string) =>
  post<CfdiDocument>(`documents/${encodeURIComponent(id)}/reconcile`, {});
export const cancelCfdi = (
  id: string,
  body: { motive: "01" | "02" | "03"; substitution_uuid?: string },
  key: string,
) =>
  post<CfdiDocument>(`documents/${encodeURIComponent(id)}/cancel`, body, key);
export async function downloadCfdi(
  id: string,
  format: "xml" | "pdf",
  environment: CfdiEnvironment,
): Promise<void> {
  const response = await apiClient(
    `documents/${encodeURIComponent(id)}/${format}`,
  );
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${environment === "test" ? "test-sin-validez-fiscal-" : ""}cfdi-${id}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
