export type BusinessProfile = {
  tenant_id: string;
  public_name: string;
  support_email: string | null;
  support_phone: string | null;
  timezone: string;
  locale: string;
  currency: string;
};

export type ReceiptSettings = {
  tenant_id: string;
  receipt_business_name: string;
  footer: string | null;
  tax_contact_text: string | null;
  logo_url: string | null;
};

export type LogoUploadResponse = {
  logo_url: string;
};

export type Employee = {
  membership_id: string;
  user_id: string;
  email: string;
  role: "owner" | "manager" | "cashier" | "staff";
  is_active: boolean;
  created_at: string;
};

export type Invitation = {
  id: string;
  email: string;
  role: "owner" | "manager" | "cashier";
  status: string;
  created_at: string;
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

export function getBusinessProfile(): Promise<BusinessProfile> {
  return requestJson<BusinessProfile>("/api/v1/settings/business-profile");
}

export function saveBusinessProfile(body: Omit<BusinessProfile, "tenant_id">): Promise<BusinessProfile> {
  return requestJson<BusinessProfile>("/api/v1/settings/business-profile", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function getReceiptSettings(): Promise<ReceiptSettings> {
  return requestJson<ReceiptSettings>("/api/v1/settings/receipt");
}

export function saveReceiptSettings(body: Omit<ReceiptSettings, "tenant_id">): Promise<ReceiptSettings> {
  return requestJson<ReceiptSettings>("/api/v1/settings/receipt", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function uploadReceiptLogo(file: File): Promise<LogoUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/v1/settings/receipt/logo", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new ApiError(await response.text(), response.status);
  return (await response.json()) as LogoUploadResponse;
}

export async function deleteReceiptLogo(): Promise<void> {
  const response = await fetch("/api/v1/settings/receipt/logo", { method: "DELETE" });
  if (!response.ok) throw new ApiError(await response.text(), response.status);
}

export function listEmployees(): Promise<Employee[]> {
  return requestJson<Employee[]>("/api/v1/employees");
}

export function listInvitations(): Promise<Invitation[]> {
  return requestJson<Invitation[]>("/api/v1/employees/invitations");
}

export function inviteEmployee(body: { email: string; role: "owner" | "manager" | "cashier" }): Promise<Invitation> {
  return requestJson<Invitation>("/api/v1/employees/invitations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateEmployeeRole(
  membershipId: string,
  role: "owner" | "manager" | "cashier",
): Promise<Employee> {
  return requestJson<Employee>(`/api/v1/employees/${membershipId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function deactivateEmployee(membershipId: string): Promise<void> {
  const response = await fetch(`/api/v1/employees/${membershipId}`, { method: "DELETE" });
  if (!response.ok) throw new ApiError(await response.text(), response.status);
}
