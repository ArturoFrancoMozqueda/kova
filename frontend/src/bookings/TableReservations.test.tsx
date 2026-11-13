import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import PublicBookingView from "./PublicBookingView";
import ManageTableView from "./ManageTableView";
import { addDays, dateKey } from "./DatePicker";
import { calendarFile } from "./calendarFile";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const day = addDays(dateKey(new Date()), 2);
const arrival = {
  starts_at: `${day}T15:00:00+00:00`,
  timezone: "America/Mexico_City",
};
const context = {
  business_name: "Cafetería",
  branch_name: "Centro",
  mode: "tables",
  timezone: arrival.timezone,
  horizon_days: 30,
  manage_cutoff_hours: 24,
  services: [],
  resources: [],
};
const receipt = {
  ...arrival,
  title: "Reserva de mesa",
  party_size: 2,
  resource_name: null,
  status: "requested",
  version: 1,
  can_manage: true,
  calendar_uid: "arrival-only@kovasuite.com",
  manage_path: "/reservar/mesa#private-test-token",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  window.history.replaceState(null, "", "/");
});
function open() {
  return render(
    <MemoryRouter initialEntries={["/reservar/page"]}>
      <Routes>
        <Route path="/reservar/:token" element={<PublicBookingView />} />
      </Routes>
    </MemoryRouter>,
  );
}
async function fill() {
  await screen.findByRole("heading", { name: "Solicita una mesa" });
  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
  fireEvent.click(screen.getByRole("button", { name: dateLabel }));
  fireEvent.click(await screen.findByRole("button", { name: /09:00/ }));
  fireEvent.change(screen.getByLabelText("Tu nombre"), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByLabelText("Teléfono de contacto"), {
    target: { value: "5512345678" },
  });
}
it("requests a table without duration or table assignment and never auto-confirms it", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/context?")
      ? json(context)
      : String(url).includes("/table-arrivals?")
        ? json({ items: [arrival] })
        : json(receipt),
  );
  open();
  await fill();
  expect(
    screen.queryByLabelText(/salida|duración|servicio/i),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Solicitar mesa" }));
  await screen.findByRole("heading", { name: "Solicitud recibida" });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Pendiente de confirmación",
  );
  expect(
    screen.queryByRole("heading", { name: "Reserva confirmada" }),
  ).not.toBeInTheDocument();
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/table-requests"),
  );
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    page_token: "page",
    starts_at: arrival.starts_at,
    name: "Ana",
    phone: "5512345678",
    party_size: 2,
    identity_token: null,
  });
  expect(call?.[1]).toMatchObject({
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { "Idempotency-Key": expect.any(String) },
  });
  expect(
    screen.getByRole("link", { name: /Consultar mi solicitud/ }),
  ).toHaveAttribute("href", receipt.manage_path);
});
it("preserves contact on failed requests and cannot send while offline", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/context?")
      ? json(context)
      : String(url).includes("/table-arrivals?")
        ? json({ items: [arrival] })
        : json({ detail: "El horario cambió. Elige otra hora." }, 409),
  );
  open();
  await fill();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  fireEvent(window, new Event("offline"));
  expect(screen.getByRole("button", { name: "Solicitar mesa" })).toBeDisabled();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  fireEvent(window, new Event("online"));
  fireEvent.click(screen.getByRole("button", { name: "Solicitar mesa" }));
  await screen.findByText("El horario cambió. Elige otra hora.");
  expect(screen.getByLabelText("Tu nombre")).toHaveValue("Ana");
  expect(screen.getByLabelText("Teléfono de contacto")).toHaveValue(
    "5512345678",
  );
  expect(
    screen.queryByRole("heading", { name: "Solicitud recibida" }),
  ).not.toBeInTheDocument();
});
it("keeps private management credentials in the request body and reflects business confirmation", async () => {
  window.history.replaceState(null, "", "/reservar/mesa#private-test-token");
  fetchMock.mockResolvedValue(
    json({
      ...receipt,
      status: "confirmed",
      resource_name: "Mesa 1",
      version: 2,
    }),
  );
  render(<ManageTableView />);
  await screen.findByRole("heading", { name: "Reserva confirmada" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Descargar llegada al calendario" }),
    ).toBeVisible(),
  );
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/v1/public/bookings/table-manage/read");
  expect(JSON.parse(String(init?.body))).toEqual({
    token: "private-test-token",
  });
  expect(init?.credentials).toBe("omit");
  expect(screen.queryByLabelText(/salida|duración/i)).not.toBeInTheDocument();
});
it("exports a confirmed arrival with no invented end time or credential", () => {
  const file = calendarFile({ ...receipt, resource_name: "Mesa 1" });
  expect(file).toContain("DTSTART:");
  expect(file).not.toContain("DTEND:");
  expect(file).not.toContain("private-test-token");
  expect(file).toContain("UID:arrival-only@kovasuite.com");
});
