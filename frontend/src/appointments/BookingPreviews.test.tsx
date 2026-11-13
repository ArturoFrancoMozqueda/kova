import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { BookingPagePreview } from "./BookingPreviews";

const data = (day: string) => ({
  context: {
    mode: "appointments" as const, business_name: "Estética Ana", branch_name: "Centro", horizon_days: 14, manage_cutoff_hours: 24,
    services: [
      { id: "s1", name: "Corte", description: "Corte y peinado", duration_minutes: 45, resource_ids: ["r1"], is_active: true, version: 1 },
      { id: "s2", name: "Tinte", description: "", duration_minutes: 90, resource_ids: ["r1"], is_active: true, version: 1 },
    ],
    resources: [{ id: "r1", name: "Ana", timezone: "America/Mexico_City" }],
  },
  selection: { service_id: "s1", resource_id: "r1", day },
  slots: [
    { starts_at: `${day}T16:00:00Z`, ends_at: `${day}T16:45:00Z`, timezone: "America/Mexico_City" },
    { starts_at: `${day}T17:00:00Z`, ends_at: `${day}T17:45:00Z`, timezone: "America/Mexico_City" },
  ],
});
const phone = (preview: HTMLElement) => preview.querySelector("iframe")!.contentDocument!.body;

it("renders the real public booking page with the server's preview for the draft", async () => {
  const load = vi.fn(async () => data("2026-11-20"));
  render(<MemoryRouter><BookingPagePreview load={load} enabled={false}
    draft={{ page: { mode: "appointments", horizon_days: 14, notice_minutes: 120, slot_minutes: 60, manage_cutoff_hours: 24 } }} /></MemoryRouter>);
  const preview = screen.getByRole("complementary", { name: "Vista previa de reservas en línea" });
  await waitFor(() => expect(phone(preview)).toHaveTextContent("Estética Ana"));
  expect(load).toHaveBeenCalledWith({ page: { mode: "appointments", horizon_days: 14, notice_minutes: 120, slot_minutes: 60, manage_cutoff_hours: 24 } });
  const page = phone(preview);
  expect(page).toHaveTextContent("¿Qué servicio necesitas?");
  expect(page).toHaveTextContent("Corte y peinado");
  expect(page).toHaveTextContent("Horarios disponibles");
  expect(page).toHaveTextContent("10:00");
  expect(page.firstElementChild).toHaveAttribute("inert");
  expect(preview).toHaveTextContent("con 2 horas de anticipación");
  expect(preview).toHaveTextContent("no podrán reservar hasta que lo actives");
  expect(preview).toHaveTextContent(/Para Corte, el 20 de noviembre de 2026 tus clientes verían 2 horarios/);
  // The owner's tab title is not replaced by the customer page's title.
  expect(document.title).not.toContain("Reserva una cita");

  fireEvent.change(screen.getByLabelText("Servicio de ejemplo"), { target: { value: "s2" } });
  await waitFor(() => expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ service_id: "s2" })));
  fireEvent.change(screen.getByLabelText("Día de ejemplo"), { target: { value: "2026-11-21" } });
  await waitFor(() => expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ day: "2026-11-21" })));
});

it("keeps the last valid page and says so when the draft is rejected", async () => {
  const load = vi.fn(async () => data("2026-11-20"));
  const view = render(<MemoryRouter><BookingPagePreview load={load} draft={{}} /></MemoryRouter>);
  const preview = screen.getByRole("complementary", { name: "Vista previa de reservas en línea" });
  await waitFor(() => expect(phone(preview)).toHaveTextContent("Estética Ana"));
  load.mockRejectedValueOnce(new Error("422"));
  view.rerender(<MemoryRouter><BookingPagePreview load={load} draft={{ availability: { resource_id: "r1", weekly: [{ weekday: 1, windows: [{ start: "12:00", end: "10:00" }] }], exceptions: [] } }} /></MemoryRouter>);
  await waitFor(() => expect(preview).toHaveTextContent("muestra el último ajuste válido"));
  expect(phone(preview)).toHaveTextContent("Estética Ana");
});
