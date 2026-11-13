type CalendarReceipt = {
  title: string;
  resource_name: string | null;
  starts_at: string;
  ends_at?: string | null;
  timezone: string;
  calendar_uid?: string;
};
const escape = (v: string) =>
  v
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
const stamp = (v: string) =>
  new Date(v)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
export function calendarFile(receipt: CalendarReceipt): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kova//Reservas//ES",
    "BEGIN:VEVENT",
    `UID:${receipt.calendar_uid ?? `${stamp(receipt.starts_at)}-${receipt.ends_at ? stamp(receipt.ends_at) : "arrival"}@kovasuite.com`}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(receipt.starts_at)}`,
    ...(receipt.ends_at ? [`DTEND:${stamp(receipt.ends_at)}`] : []),
    `SUMMARY:${escape(receipt.title)}`,
    `DESCRIPTION:${escape(receipt.ends_at ? `Cita con ${receipt.resource_name}. Horario de ${receipt.timezone}.` : `Hora de llegada. Sin hora de salida fijada. Horario de ${receipt.timezone}.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map((line) => {
      const encoder = new TextEncoder();
      let folded = "",
        chunk = "";
      for (const char of line) {
        if (encoder.encode(chunk + char).length > 74) {
          folded += chunk + "\r\n ";
          chunk = char;
        } else chunk += char;
      }
      return folded + chunk;
    })
    .join("\r\n");
}
export function downloadCalendar(receipt: CalendarReceipt) {
  const url = URL.createObjectURL(
    new Blob([calendarFile(receipt)], { type: "text/calendar;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mi-cita.ics";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
