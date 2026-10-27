import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnrollmentSettings } from "./EnrollmentSettings";
const fetchMock = vi.fn<typeof fetch>();
const identity = { tenantId: "tenant-1", userId: "owner-1", branchId: "branch-1" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  fetchMock.mockImplementation(async (_url, init) => json(init?.method === "PUT" ? { enabled: true, version: 1 } : { enabled: false, version: 0 }));
});
afterEach(() => vi.unstubAllGlobals());
it("never enables enrollment until the owner explicitly opts in and saves the observed version", async () => {
  render(<EnrollmentSettings identity={identity} />);
  expect(await screen.findByText("Las nuevas tarjetas desde el menú están desactivadas.")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Configurar tarjetas" }));
  expect(screen.getByRole("checkbox", { name: "Permitir nuevas tarjetas desde el menú" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Guardar acceso a tarjetas" }));
  await screen.findByText(/Acceso a tarjetas guardado/);
  const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(init?.body).toBe(JSON.stringify({ enabled: true, expected_version: 0 }));
  expect(init?.headers).toMatchObject({ "X-Kova-Expected-Tenant": identity.tenantId, "X-Kova-Expected-User": identity.userId, "X-Kova-Branch": identity.branchId, "Idempotency-Key": expect.any(String) });
});
it("does not invent a disabled default when discovery fails, and retries the current policy", async () => {
  fetchMock.mockResolvedValueOnce(json({}, 503)); render(<EnrollmentSettings identity={identity} />);
  await screen.findByText("No pudimos consultar el acceso a tarjetas desde el menú.");
  expect(screen.getByRole("button", { name: "Configurar tarjetas" })).toBeDisabled();
  expect(screen.queryByText("Las nuevas tarjetas desde el menú están desactivadas.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Consultar acceso actual a tarjetas" }));
  await screen.findByText("Las nuevas tarjetas desde el menú están desactivadas.");
});
it("refreshes a changed policy without overwriting the current backend version", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "PUT" ? json({}, 409) : json({ enabled: false, version: 3 }));
  render(<EnrollmentSettings identity={identity} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Configurar tarjetas" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Configurar tarjetas" }));
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Guardar acceso a tarjetas" }));
  await screen.findByText(/Los datos cambiaron/);
  fireEvent.click(screen.getByRole("button", { name: "Consultar acceso actual a tarjetas" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(2));
  expect(fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")![1]?.body).toContain('"expected_version":3');
});
