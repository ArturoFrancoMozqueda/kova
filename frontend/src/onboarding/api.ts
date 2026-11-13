import { csrfHeaders } from "../lib/csrf";
export type PresetName = "cafe" | "bakery" | "retail" | "abarrotes";

export type PresetApplyResponse = {
  preset: string;
  categories_created: number;
  products_created: number;
  skipped: boolean;
};

/** Read-only contents of a starter catalog, shown before the owner applies it. */
export type PresetPreview = {
  preset: string;
  label: string;
  categories: string[];
  products: { name: string; category: string | null; price_amount: string }[];
};

export type OnboardingStep = {
  key: string;
  label: string;
  completed: boolean;
  action_path: string;
};

export type OnboardingState = {
  tenant_id: string;
  completed_count: number;
  total_count: number;
  steps: OnboardingStep[];
};

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...csrfHeaders(init?.method), ...init?.headers, },
  });
  if (!response.ok) throw new ApiError(await response.text(), response.status);
  return (await response.json()) as T;
}

export function applyPreset(preset: PresetName): Promise<PresetApplyResponse> {
  return requestJson<PresetApplyResponse>("/api/v1/onboarding/apply-preset", {
    method: "POST",
    body: JSON.stringify({ preset }),
  });
}

export function getPresetPreview(preset: PresetName): Promise<PresetPreview> {
  return requestJson<PresetPreview>(`/api/v1/onboarding/presets/${encodeURIComponent(preset)}`);
}

export function getOnboardingState(): Promise<OnboardingState> {
  return requestJson<OnboardingState>("/api/v1/onboarding/state");
}
