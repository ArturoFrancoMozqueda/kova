const MAX_LENGTH = 24;

function toTitleCase(value: string): string {
  return value
    .toLocaleLowerCase("es-MX")
    .replace(/(^|\s|['’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("es-MX"));
}

export function formatTenantName(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const hasLower = /\p{Ll}/u.test(trimmed);
  const hasUpper = /\p{Lu}/u.test(trimmed);
  const allCaps = hasUpper && !hasLower;
  const allLower = hasLower && !hasUpper;
  const normalized = allCaps || allLower ? toTitleCase(trimmed) : trimmed;

  if (normalized.length <= MAX_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LENGTH - 1).trimEnd()}…`;
}
