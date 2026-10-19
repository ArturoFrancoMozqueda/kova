import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import CrmView from "./CrmView";
import type { CrmData, ContactConsent } from "./types";

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", role: "owner" },
      tenantId: "tenant-1",
      sessionMode: "online",
    },
  }),
}));
vi.mock("@/branches/activeBranch", () => ({
  getActiveBranchId: () => "branch-1",
}));
const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const overview = (): CrmData => ({
  opportunities: [],
  consents: [],
  capabilities: { whatsapp: "not_connected", email: "not_connected" },
  opportunities_has_more: false,
  consents_has_more: false,
});
const customer = {
  id: "customer-1",
  name: "Panadería del Centro",
  email: "centro@example.com",
  phone: "5550000000",
  is_active: true,
  created_at: "2026-10-18T12:00:00Z",
};
const consent: ContactConsent = {
  id: "consent-1",
  customer_id: customer.id,
  customer_name: customer.name,
  channel: "whatsapp",
  purpose: "transactional",
  enabled: true,
  contact_current: true,
  source: "owner_recorded",
  version: 4,
  updated_at: "2026-10-18T12:00:00Z",
};
const mount = () =>
  render(
    <MemoryRouter>
      <CrmView />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?") ? json([customer]) : json(overview()),
  );
});

it("creates an estimated opportunity only for a selected real customer", async () => {
  mount();
  await screen.findByText("El próximo pedido empieza aquí");
  await screen.findByRole("option", { name: customer.name });
  fireEvent.click(screen.getByRole("button", { name: "Nueva oportunidad" }));
  expect(
    screen.getByRole("button", { name: "Guardar oportunidad" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Cliente registrado"), {
    target: { value: customer.id },
  });
  fireEvent.change(screen.getByLabelText("¿Qué necesita el cliente?"), {
    target: { value: "Pedido de aniversario" },
  });
  fireEvent.change(screen.getByLabelText("Valor estimado en MXN"), {
    target: { value: "1250.50" },
  });
  fireEvent.change(screen.getByLabelText("Siguiente acción"), {
    target: { value: "Confirmar sabores" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar oportunidad" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/crm/opportunities" && init?.method === "POST",
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(
    ([url, init]) =>
      url === "/api/v1/crm/opportunities" && init?.method === "POST",
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    customer_id: customer.id,
    title: "Pedido de aniversario",
    estimated_amount: "1250.50",
    next_action: "Confirmar sabores",
    note: null,
    due_at: null,
  });
  expect(init!.headers).toHaveProperty("Idempotency-Key");
  expect(
    await screen.findByText(/Su valor es estimado y no modifica tus ventas/),
  ).toBeVisible();
});

it("requires explicit customer permission and sends channel and purpose separately", async () => {
  mount();
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Cliente registrado"), {
    target: { value: customer.id },
  });
  const confirm = screen.getByRole("checkbox", {
    name: /Confirmo que este cliente/,
  });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  expect(
    screen.getByRole("button", { name: "Registrar permiso" }),
  ).toBeDisabled();
  fireEvent.click(confirm);
  fireEvent.click(screen.getByRole("button", { name: "Registrar permiso" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/crm/consents" && init?.method === "PUT",
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(
    ([url, init]) => url === "/api/v1/crm/consents" && init?.method === "PUT",
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    customer_id: customer.id,
    channel: "whatsapp",
    purpose: "transactional",
    enabled: true,
    expected_version: 0,
  });
  expect(await screen.findByText(/no se enviaron mensajes/)).toBeVisible();
});

it("withdraws only the selected channel and purpose after confirmation", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([customer])
      : json({ ...overview(), consents: [consent] }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Retirar permiso whatsapp transactional",
    }),
  );
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar retiro" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(1),
  );
  const [, init] = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT",
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    customer_id: customer.id,
    channel: "whatsapp",
    purpose: "transactional",
    enabled: false,
    expected_version: 4,
  });
});

it("requires a new authorization when the contact address changed", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([customer])
      : json({
          ...overview(),
          consents: [{ ...consent, contact_current: false }],
        }),
  );
  mount();
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Cliente registrado"), {
    target: { value: customer.id },
  });
  const confirm = screen.getByRole("checkbox", {
    name: /Confirmo que este cliente/,
  });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  expect(await screen.findByText(/Contacto cambió/)).toBeVisible();
  fireEvent.click(confirm);
  fireEvent.click(screen.getByRole("button", { name: "Registrar permiso" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT",
  )!;
  expect(JSON.parse(init!.body as string)).toMatchObject({
    expected_version: 4,
    enabled: true,
  });
});

it("keeps the same idempotency key when retrying an uncertain creation", async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === "POST") throw new TypeError("Network error");
    return String(url).includes("/customers?")
      ? json([customer])
      : json(overview());
  });
  mount();
  await screen.findByRole("option", { name: customer.name });
  fireEvent.click(screen.getByRole("button", { name: "Nueva oportunidad" }));
  fireEvent.change(screen.getByLabelText("Cliente registrado"), {
    target: { value: customer.id },
  });
  fireEvent.change(screen.getByLabelText("¿Qué necesita el cliente?"), {
    target: { value: "Cotizar pan" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar oportunidad" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Guardar oportunidad" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(2),
  );
  const calls = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(calls[0][1]!.headers).toEqual(calls[1][1]!.headers);
});

it("edits the next action with optimistic version protection", async () => {
  const opportunity = {
    id: "opportunity-1",
    customer_id: customer.id,
    customer_name: customer.name,
    title: "Pedido para evento",
    stage: "contacted",
    estimated_amount: "1200.00",
    assigned_user_id: null,
    next_action: "Preguntar fecha",
    due_at: null,
    note: null,
    version: 5,
    created_at: "2026-10-18T12:00:00Z",
    updated_at: "2026-10-18T12:00:00Z",
  };
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([customer])
      : json({ ...overview(), opportunities: [opportunity] }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Editar seguimiento de Pedido para evento",
    }),
  );
  fireEvent.change(screen.getByLabelText("Siguiente acción"), {
    target: { value: "Confirmar entrega" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar seguimiento" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PATCH",
  )!;
  expect(JSON.parse(init!.body as string)).toMatchObject({
    expected_version: 5,
    next_action: "Confirmar entrega",
    estimated_amount: "1200.00",
  });
});
