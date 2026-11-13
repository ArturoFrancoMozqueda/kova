/** "2 horas", "1 día y 3 horas", "45 minutos" for the minimum notice. */
export function formatNotice(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "sin anticipación mínima";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days ? `${days} ${days === 1 ? "día" : "días"}` : "",
    hours ? `${hours} ${hours === 1 ? "hora" : "horas"}` : "",
    rest ? `${rest} ${rest === 1 ? "minuto" : "minutos"}` : "",
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
}
