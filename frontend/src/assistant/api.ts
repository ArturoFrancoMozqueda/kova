import { csrfHeaders } from "@/lib/csrf";

export type Identity = { tenantId: string; userId: string; branchId: string };
export type Capabilities = { enabled: boolean; inference_ready: boolean; local_answers_ready?: boolean; provider_name?: string; configuration: boolean; documents: boolean; email: boolean; role: string };
export type Preferences = { chat_consent: boolean; chat_provider?: "groq" | "cloudflare" | "openrouter"; chat_recipients?: "groq+cerebras" | null; document_consent: boolean; email_opt_in: boolean; frequency: "daily" | "weekly" };
export type Usage = { tenant_used: number; tenant_limit: number; user_used: number; user_limit: number; reset_at: string; retry_at?: string; unit?: "tokens" | "neurons"; provider?: "groq" | "cloudflare" | "openrouter"; window?: "utc_day" | "rolling_24h"; limit_kind?: "available" | "temporary" | "provider_daily" | "provider_monthly" | "tenant_daily" };
export type Step = { action: string; resource_id?: string | null; values: Record<string, unknown>; before?: Record<string, unknown> | null; result?: Record<string, unknown> | null };
export type Resource = {
  id: string; kind: string; status: string; shared: boolean; branch_id: string; can_edit: boolean;
  created_at: string; updated_at: string;
  data: {
    title?: string; content?: string; role?: string; answer?: string; error?: string;
    retry_at?: string; limit_kind?: string; response_mode?: "direct" | "model" | "grounded";
    fingerprint?: string; steps?: Step[]; filename?: string; purpose?: string;
    source_ids?: string[]; sources?: { id: string; title: string; page: number; path: string }[];
    cards?: { kind: string; data: { start_date?: string; end_date?: string; total_net_sales?: string; branch_count?: number; branches?: { branch_id: string; branch_name: string; net_sales: string; completed_orders: number }[]; products?: { product_id: string; product_name: string; quantity_sold: number; gross_sales: string }[];
      restock_alerts?: { product_id: string; product_name: string; stock_on_hand: number; low_stock_threshold: number; days_until_out: string | null; severity: "critical" | "warning" }[];
      available_alert_count?: number; inventory_valuation?: { complete: boolean; tracked_products: number; products_without_cost: number };
    } }[];
    metrics?: Record<string, string | number> | null; proposal_id?: string | null;
    preview?: { total_rows: number; valid_rows: number; error_rows: number; rows: { row_number: number; errors: string[]; normalized?: { name: string; price_amount: string } }[] };
    ocr?: boolean; metric?: string; target?: string; current?: string; achieved?: boolean;
    path?: string; verified?: boolean; start_date?: string; end_date?: string;
  };
};

export function assistantApi(identity: Identity, signal?: AbortSignal | (() => AbortSignal)) {
  return async function request<T>(path: string, method = "GET", body?: unknown, key?: string): Promise<T> {
    if (!navigator.onLine) throw new Error("Conéctate para usar el asistente. Tus ventas offline siguen disponibles.");
    const raw = body instanceof File;
    const response = await fetch(`/api/v1/assistant${path}`, {
      method, signal: typeof signal === "function" ? signal() : signal, credentials: "include", cache: "no-store",
      headers: {
        "X-Kova-Expected-Tenant": identity.tenantId, "X-Kova-Expected-User": identity.userId,
        "X-Kova-Branch": identity.branchId, ...csrfHeaders(method),
        ...(body !== undefined ? { "Content-Type": raw ? "application/octet-stream" : "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : raw ? body as File : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { detail?: string | { message?: string } };
      const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.message;
      throw new Error(detail ?? (response.status === 429 ? "Se alcanzó un límite. Espera antes de volver a intentar." : "No pudimos completar esta acción."));
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
}
