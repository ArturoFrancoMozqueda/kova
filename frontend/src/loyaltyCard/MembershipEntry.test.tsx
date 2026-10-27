import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { MembershipEntry } from "./MembershipEntry";
import { pendingMembershipKey } from "./membership";
const fetchMock = vi.fn<typeof fetch>();
const card = { business_name: "Café del Patio", branch_name: "Centro", balance: 0, adjustments_pending: false, member_code: "KV-ABCD-EFGH-JKMP-QRST", policy: { enabled: true, spend_amount: "100.00", points_per_step: 5 }, reward: null, expires_at: "2027-04-26T12:00:00Z", catalog_path: "/catalogo/patio" };
const membership = { available: true, enrolled: false, business_name: card.business_name, branch_name: card.branch_name, policy: card.policy, reward: null, csrf_token: "public-grant", card: null, card_path: "/lealtad?menu=patio" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  let enrolled = false;
  fetchMock.mockImplementation(async (_url, init) => { if (init?.method === "POST") { enrolled = true; return json({ card, card_path: membership.card_path }, 201); } return json(enrolled ? { ...membership, enrolled: true, card } : membership); });
});
afterEach(() => { document.cookie = "csrf_token=; Max-Age=0; path=/"; vi.unstubAllGlobals(); });
const mount = () => render(<MembershipEntry menuToken="patio" businessName={card.business_name} available />);
async function openForm() { fireEvent.click(await screen.findByRole("button", { name: "Tu tarjeta de lealtad" })); await screen.findByRole("textbox", { name: "¿Cómo te llamamos?" }); }
it("requires an explicit new personal card and submits only alias with both CSRF headers, without losing the menu", async () => {
  document.cookie = "csrf_token=merchant-grant; path=/";
  const { container } = mount(); await openForm();
  expect(screen.getByRole("button", { name: "Crear mi tarjeta" })).toBeDisabled();
  expect(screen.queryByRole("textbox", { name: /teléfono|correo/i })).not.toBeInTheDocument();
  expect(screen.getByText(/No se recuperan saldos de tarjetas anteriores/)).toBeVisible();
  expect((await axe(container, { runOnly: ["label", "button-name", "aria-dialog-name", "heading-order"] })).violations).toEqual([]);
  fireEvent.change(screen.getByRole("textbox", { name: "¿Cómo te llamamos?" }), { target: { value: "  Ana  " } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Quiero crear mi tarjeta personal en este dispositivo." }));
  fireEvent.click(screen.getByRole("button", { name: "Crear mi tarjeta" }));
  const link = await screen.findByRole("link", { name: "Ver mi tarjeta (abre en otra pestaña)" });
  expect(link).toHaveAttribute("href", membership.card_path); expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(init).toMatchObject({ credentials: "include", cache: "no-store", referrerPolicy: "no-referrer", body: JSON.stringify({ menu_token: "patio", name: "Ana", confirmed: true }) });
  expect(init?.headers).toMatchObject({ "X-Kova-Member-CSRF": "public-grant", "X-CSRF-Token": "merchant-grant", "Idempotency-Key": expect.any(String) });
  expect(pendingMembershipKey("patio")).toBeNull();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST")[1][1]?.headers).toEqual({ "Idempotency-Key": (init?.headers as Record<string, string>)["Idempotency-Key"] });
});
it("retries an uncertain enrollment with the same exact body and idempotency key", async () => {
  let submits = 0;
  fetchMock.mockImplementation(async (_url, init) => init?.method !== "POST" ? json(submits >= 2 ? { ...membership, enrolled: true, card } : membership) : ++submits === 1 ? json({}, 503) : json({ card, card_path: membership.card_path }, 201));
  mount(); await openForm();
  fireEvent.change(screen.getByRole("textbox", { name: "¿Cómo te llamamos?" }), { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Crear mi tarjeta" }));
  await screen.findByText(/No pudimos confirmar si tu tarjeta se creó/);
  expect(screen.getByRole("textbox", { name: "¿Cómo te llamamos?" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar crear mi tarjeta" }));
  await screen.findByRole("link", { name: /Ver mi tarjeta/ });
  const calls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(calls).toHaveLength(2); expect(calls[0][1]?.body).toBe(calls[1][1]?.body); expect(calls[0][1]?.headers).toEqual(calls[1][1]?.headers);
});
it("keeps an existing card available when new memberships are paused", async () => {
  fetchMock.mockResolvedValue(json({ ...membership, available: false, enrolled: true, card }));
  render(<MembershipEntry menuToken="patio" businessName={card.business_name} available={false} />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver mi tarjeta/ }));
  expect(await screen.findByRole("link", { name: /Ver mi tarjeta/ })).toHaveAttribute("href", membership.card_path);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("hides enrollment when the backend says it is unavailable and never invents a card", async () => {
  fetchMock.mockResolvedValue(json({ ...membership, available: false }));
  const { container } = mount();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store", referrerPolicy: "no-referrer" });
});
it("does not create a card when offline", async () => {
  mount(); await openForm(); Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  fireEvent.change(screen.getByRole("textbox", { name: "¿Cómo te llamamos?" }), { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Crear mi tarjeta" }));
  await screen.findByText("Conéctate a internet para crear tu tarjeta.");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
});

it("stores only the operation key and recovers a committed enrollment on remount without another POST", async () => {
  let committed = false;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") { committed = true; return json({}, 503); }
    return json(committed ? { ...membership, enrolled: true, card } : membership);
  });
  const first = mount(); await openForm();
  fireEvent.change(screen.getByRole("textbox", { name: "¿Cómo te llamamos?" }), { target: { value: "Ana privada" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Crear mi tarjeta" }));
  await screen.findByText(/No pudimos confirmar si tu tarjeta se creó/);
  const key = pendingMembershipKey("patio"); expect(key).toBeTruthy();
  expect(Object.values(sessionStorage)).toEqual([key]);
  expect(JSON.stringify(sessionStorage)).not.toContain("Ana privada"); expect(JSON.stringify(sessionStorage)).not.toContain("public-grant");
  first.unmount(); mount();
  fireEvent.click(await screen.findByRole("button", { name: "Ver mi tarjeta" }));
  await screen.findByRole("link", { name: /Ver mi tarjeta/ });
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toEqual({ "Idempotency-Key": key });
  expect(pendingMembershipKey("patio")).toBeNull();
});
it("blocks enrollment before POST if safe retry storage is unavailable", async () => {
  mount(); await openForm();
  const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  fireEvent.change(screen.getByRole("textbox", { name: "¿Cómo te llamamos?" }), { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Crear mi tarjeta" }));
  await screen.findByText(/Este navegador no nos permite guardar tu solicitud/);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  blocked.mockRestore();
});
it("never shows a phantom card from malformed success and keeps the operation recoverable", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? json({ card: {}, card_path: membership.card_path }, 201) : json(membership));
  mount(); await openForm();
  fireEvent.change(screen.getByRole("textbox", { name: "¿Cómo te llamamos?" }), { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Crear mi tarjeta" }));
  await screen.findByText(/No pudimos verificar si tu tarjeta se creó/);
  expect(screen.queryByRole("link", { name: /Ver mi tarjeta/ })).not.toBeInTheDocument();
  expect(pendingMembershipKey("patio")).toBeTruthy();
});
it("retains a failed recovery key and never creates a replacement customer when recovery needs the team", async () => {
  sessionStorage.setItem("kova:loyalty-enrollment:pending:patio", "pending-key");
  fetchMock.mockResolvedValue(json({}, 409)); mount();
  fireEvent.click(await screen.findByRole("button", { name: "Tu tarjeta de lealtad" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Pide ayuda al equipo");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(pendingMembershipKey("patio")).toBe("pending-key");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
});
