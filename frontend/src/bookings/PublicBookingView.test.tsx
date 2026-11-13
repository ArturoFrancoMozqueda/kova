import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import PublicBookingView from "./PublicBookingView";
import { addDays, dateKey } from "./DatePicker";
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const day = addDays(dateKey(new Date()), 2);
const slot = {
  starts_at: `${day}T15:00:00+00:00`,
  ends_at: `${day}T15:30:00+00:00`,
  timezone: "America/Mexico_City",
};
const context = {
  business_name: "Negocio",
  branch_name: "Centro",
  horizon_days: 30,
  manage_cutoff_hours: 24,
  services: [
    {
      id: "service",
      name: "Consulta",
      duration_minutes: 30,
      description: "",
      resource_ids: ["person"],
    },
  ],
  resources: [{ id: "person", name: "Ana", timezone: slot.timezone }],
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
});
async function chooseSlot() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Consulta.*30 minutos/ }),
  );
  const label = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
  fireEvent.click(screen.getByRole("button", { name: label }));
  fireEvent.click(await screen.findByRole("button", { name: /09:00/ }));
}
it("keeps the contact draft after a slot is taken and never presents a failed reservation as confirmed", async () => {
  fetchMock.mockImplementation(async (url, init) =>
    String(url).includes("/context?")
      ? json(context)
      : String(url).includes("/slots?")
        ? json({ items: [slot] })
        : init?.method === "POST"
          ? json(
              { detail: "Ese horario ya no está disponible. Elige otro." },
              409,
            )
          : json({}),
  );
  render(
    <MemoryRouter initialEntries={["/reservar/page"]}>
      <Routes>
        <Route path="/reservar/:token" element={<PublicBookingView />} />
      </Routes>
    </MemoryRouter>,
  );
  await chooseSlot();
  expect(
    screen.getByRole("button", { name: "Elegir otro horario" }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Nombre", { exact: true }), {
    target: { value: "Mariana" },
  });
  fireEvent.change(screen.getByLabelText("Teléfono de contacto"), {
    target: { value: "5512345678" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar mi reserva" }));
  await screen.findByText(/Ese horario ya no está disponible/);
  expect(
    screen.queryByRole("heading", { name: "Tu cita está confirmada" }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /09:00/ }));
  expect(screen.getByLabelText("Nombre", { exact: true })).toHaveValue(
    "Mariana",
  );
  expect(screen.getByLabelText("Teléfono de contacto")).toHaveValue(
    "5512345678",
  );
  const call = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url) === "/api/v1/public/bookings" && init?.method === "POST",
  );
  expect(call?.[1]).toMatchObject({
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { "Idempotency-Key": expect.any(String) },
  });
  const count = fetchMock.mock.calls.length;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  fireEvent(window, new Event("offline"));
  expect(screen.getByRole("button", { name: "Confirmar mi reserva" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar mi reserva" }));
  expect(fetchMock.mock.calls).toHaveLength(count);
  expect(screen.getByLabelText("Nombre", { exact: true })).toHaveValue("Mariana");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  fireEvent(window, new Event("online"));
  expect(screen.getByRole("button", { name: "Confirmar mi reserva" })).toBeEnabled();
});
it("presents a retryable error instead of inventing an empty agenda on malformed responses", async () => {
  fetchMock.mockResolvedValue(new Response("<html>upstream error</html>"));
  render(
    <MemoryRouter initialEntries={["/reservar/page"]}>
      <Routes>
        <Route path="/reservar/:token" element={<PublicBookingView />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos conectar con la agenda",
    ),
  );
  expect(
    screen.queryByText(/Unexpected token|upstream error/),
  ).not.toBeInTheDocument();
});
