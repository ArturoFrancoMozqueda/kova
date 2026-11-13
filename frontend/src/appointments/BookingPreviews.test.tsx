import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AvailabilityPreview, PublicationPreview } from "./BookingPreviews";

it("shows the start times customers will see for the chosen weekday", () => {
  render(<AvailabilityPreview resourceName="Ana" slotMinutes={30} weekly={[
    { weekday: 4, windows: [{ start: "16:00", end: "17:00" }] },
    { weekday: 1, windows: [{ start: "10:00", end: "11:30" }] },
  ]} />);
  const preview = screen.getByRole("complementary", { name: "Vista previa de horarios" });
  expect(preview).toHaveTextContent("Horarios disponibles · martes");
  expect(preview).toHaveTextContent(/10:00.*10:30.*11:00/);
  expect(preview).toHaveTextContent("Un martes, tus clientes podrán elegir 3 horarios con Ana, desde las 10:00 hasta las 11:00.");
  fireEvent.change(screen.getByLabelText("Ver un día"), { target: { value: "4" } });
  expect(preview).toHaveTextContent("Horarios disponibles · viernes");
  expect(preview).toHaveTextContent(/16:00.*16:30/);
});

it("says plainly when nobody can book", () => {
  render(<AvailabilityPreview resourceName="Ana" slotMinutes={15} weekly={[]} />);
  expect(screen.getByRole("complementary", { name: "Vista previa de horarios" })).toHaveTextContent("Ana no tiene días con horario");
});

it("limits the real date picker by the draft horizon and explains notice and changes", () => {
  render(<PublicationPreview draft={{ mode: "appointments", enabled: false, version: 1, horizon_days: 14, notice_minutes: 120, slot_minutes: 15, manage_cutoff_hours: 24, share_path: null }} />);
  const preview = screen.getByRole("complementary", { name: "Vista previa de reservas en línea" });
  expect(preview).toHaveTextContent("(14 días)");
  expect(preview).toHaveTextContent("con 2 horas de anticipación");
  expect(preview).toHaveTextContent("hasta 24 horas antes");
  expect(preview).toHaveTextContent("no podrán reservar hasta que lo actives");
  expect(preview.querySelector("[inert]")).not.toBeNull();
});
