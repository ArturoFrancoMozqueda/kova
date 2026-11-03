import type { PublicPlans } from "@/billing/publicPlans";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import AuthView from "./AuthView";
const refreshed = vi.hoisted(() => vi.fn());
vi.mock("./useAuth", () => ({ useAuth: () => ({ refresh: refreshed }) }));
vi.mock("@/telemetry/funnel", () => ({ queueFunnelEvent: vi.fn(), trackSignupValidationFailed: vi.fn(), funnelClientHeaders: () => ({}) }));
const standard: PublicPlans = { offer_revision: "standard-v1", tiered_pricing_enabled: false, available_plans: [{ code: "standard", name: "Plan Standard", amount_minor_units: 29900, currency: "MXN", interval: "month", tax_inclusive: null, features: [], limits: { product_image_bytes: null } }] };
const tiered: PublicPlans = { offer_revision: "tiered-v2", tiered_pricing_enabled: true, available_plans: [{ code: "esencial", name: "Esencial", amount_minor_units: 39900, currency: "MXN", interval: "month", tax_inclusive: true, features: ["pos"], limits: { product_image_bytes: 250_000_000, branches: 1 } }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function mount() { return render(<MemoryRouter initialEntries={["/signup"]}><AuthView mode="signup" /></MemoryRouter>); }
function fill() {
  fireEvent.change(screen.getByLabelText(/Nombre del negocio/i), { target: { value: "Negocio conservado" } });
  fireEvent.change(screen.getByLabelText(/Correo/i), { target: { value: "qa@example.invalid" } });
  fireEvent.change(screen.getByLabelText(/Contraseña/i), { target: { value: "PassStrong123" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
function preserved() {
  expect(screen.getByLabelText(/Nombre del negocio/i)).toHaveValue("Negocio conservado");
  expect(screen.getByLabelText(/Correo/i)).toHaveValue("qa@example.invalid");
  expect(screen.getByLabelText(/Contraseña/i)).toHaveValue("PassStrong123");
  expect(screen.getByRole("checkbox")).toBeChecked();
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it("requires review of a changed offer before signup and sends the reviewed revision on the next attempt", async () => {
  let catalog = standard;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => String(input).endsWith("/billing/plans") ? json(catalog) : json({ detail: "No se completó el registro." }, 400));
  vi.stubGlobal("fetch", fetch); mount();
  await screen.findByText(/Después, \$299 MXN/); fill(); catalog = tiered;
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Los planes se actualizaron"); preserved();
  expect(fetch.mock.calls.filter(([input]) => String(input).endsWith("/auth/signup"))).toHaveLength(0);
  expect(screen.getByText(/Esencial por \$399 MXN/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  await waitFor(() => expect(fetch.mock.calls.filter(([input]) => String(input).endsWith("/auth/signup"))).toHaveLength(1));
  const request = fetch.mock.calls.find(([input]) => String(input).endsWith("/auth/signup"))!;
  expect(JSON.parse(request[1]!.body as string).billing_offer_revision).toBe("tiered-v2");
});
it("handles a server-side offer race without claiming success and preserves the form", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => String(input).endsWith("/billing/plans") ? json(tiered) : json({ detail: "La oferta cambió." }, 409));
  vi.stubGlobal("fetch", fetch); mount(); await screen.findByText(/Esencial por \$399 MXN/); fill();
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Los planes cambiaron antes de completar el registro"); preserved();
  expect(refreshed).not.toHaveBeenCalled();
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith("/auth/login"))).toBe(false);
  expect(screen.getByRole("heading", { name: "Crear cuenta de negocio" })).toBeInTheDocument();
});
it("does not submit an account when current prices cannot be confirmed", async () => {
  let available = true;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { if (!available) throw new TypeError("offline"); return json(standard); });
  vi.stubGlobal("fetch", fetch); mount(); await screen.findByText(/Después, \$299 MXN/); fill(); available = false;
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar los planes actuales"); preserved();
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith("/auth/signup"))).toBe(false);
});
it("refreshes signup pricing when a previously backgrounded tab regains focus", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let catalog = standard;
  vi.stubGlobal("fetch", vi.fn(async () => json(catalog)));
  mount(); await screen.findByText(/Después, \$299 MXN/); fill(); catalog = tiered;
  act(() => window.dispatchEvent(new Event("focus")));
  await screen.findByText(/Esencial por \$399 MXN/); preserved();
});
