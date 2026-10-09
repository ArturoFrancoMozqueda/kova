export function passwordExceedsByteLimit(password: string): boolean {
  return new TextEncoder().encode(password).length > 72;
}

export function hasPasswordByteLimitError(message: string): boolean {
  try {
    const body = JSON.parse(message) as { detail?: Array<{ type?: string }> };
    return Array.isArray(body.detail) && body.detail.some((error) => error.type === "password_too_long");
  } catch {
    return false;
  }
}
