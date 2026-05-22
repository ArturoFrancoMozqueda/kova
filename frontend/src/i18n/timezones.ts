// Map IANA timezone IDs used by Mexican tenants to a human-readable label
// with the current UTC offset hint. Used in /reports header and other
// places where the raw IANA string would be confusing.

const MEXICO_TZ_LABELS: Record<string, string> = {
  "America/Mexico_City": "Ciudad de México (UTC-6)",
  "America/Cancun": "Cancún (UTC-5)",
  "America/Tijuana": "Tijuana (UTC-8)",
  "America/Hermosillo": "Hermosillo (UTC-7)",
  "America/Chihuahua": "Chihuahua (UTC-7)",
  "America/Mazatlan": "Mazatlán (UTC-7)",
  "America/Monterrey": "Monterrey (UTC-6)",
  "America/Merida": "Mérida (UTC-6)",
};

export function timezoneLabel(timezone: string | null | undefined): string {
  if (!timezone) return "";
  return MEXICO_TZ_LABELS[timezone] ?? timezone;
}
