// Number formatters (`formatCompactMoney`/`formatSignedPercent`/`formatPercent`)
// were promoted to `@/lib/format` so shared UI and other tabs can use them
// without importing `reports/`. Re-exported here for existing report callers.
// `displayPersonName` stays report/team-specific.

export { formatCompactMoney, formatSignedPercent, formatPercent } from "@/lib/format";

/**
 * Human display name for a team member. Accounts created by email often have
 * the raw address as `display_name`; showing "sofia@bakery.local" (truncated)
 * as a person breaks the premium read. Falls back to the capitalized local
 * part of the email; real names pass through untouched.
 */
export function displayPersonName(name: string): string {
  if (!name.includes("@")) return name;
  const local = name.split("@")[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
