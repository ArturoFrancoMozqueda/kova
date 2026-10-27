/** A shared card is a read capability. Keep its fragment out of telemetry,
 * including error messages and navigation breadcrumbs after leaving the card. */
export function redactCardLink(value: string): string {
  return value.replace(/(\/(?:lealtad|seguimiento)\/*(?:\?[^#\s"'<>]*)?)(?:#|%23)[^\s"'<>]*/gi, "$1#[redacted]");
}

export function redactCardTelemetry<T>(value: T): T {
  if (typeof value === "string") return redactCardLink(value) as T;
  if (Array.isArray(value)) return value.map(item => redactCardTelemetry(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactCardTelemetry(item)])) as T;
  }
  return value;
}

export function isLoyaltyCardPage(pathname: string): boolean {
  return /^\/lealtad\/*$/.test(pathname);
}

export function isPrivateCustomerPage(pathname: string): boolean {
  return /^\/(?:lealtad|seguimiento)\/*$/.test(pathname);
}
