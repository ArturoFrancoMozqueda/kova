import { expect, it } from "vitest";
import { calendarFile } from "./calendarFile";
import type { BookingReceipt } from "@/appointments/bookingTypes";
it("exports stable UTC events without management credentials or injectable calendar lines", () => {
  const receipt: BookingReceipt = {
    title: "Consulta\nBEGIN:VEVENT," + "á".repeat(100),
    resource_name: "Cabina; Ana",
    starts_at: "2026-11-14T09:00:00-06:00",
    ends_at: "2026-11-14T09:30:00-06:00",
    timezone: "America/Mexico_City",
    status: "scheduled",
    version: 1,
    can_manage: true,
    calendar_uid: "private-event@kovasuite.com",
    manage_path: "/reservar/gestionar#private-capability",
  };
  const result = calendarFile(receipt);
  expect(result).toContain("DTSTART:20261114T150000Z");
  expect(result).toContain("UID:private-event@kovasuite.com");
  expect(result.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1);
  expect(result).not.toContain("private-capability");
  for (const line of result.split("\r\n"))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
});
