export type PresetName = "bakery" | "retail";

export type PresetApplyResponse = {
  preset: string;
  categories_created: number;
  products_created: number;
  skipped: boolean;
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
    headers: { "Content-Type": "application/json", ...init?.headers },
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
