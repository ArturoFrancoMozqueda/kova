import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import WhatsAppSignupPanel from "./WhatsAppSignupPanel";
import type { SignupResult } from "./embeddedSignup";

const sdk = vi.hoisted(() => ({ prepare: vi.fn(), launch: vi.fn() }));
vi.mock("./embeddedSignup", () => ({ loadMetaSdk: sdk.prepare, launchMetaSignup: sdk.launch }));
const identity = { tenantId: "tenant-a", userId: "owner-a", branchId: "branch-a" };
const fetchMock = vi.fn<typeof fetch>();
const connected = vi.fn();
const available = { available: true, can_manage: true, app_id: "123", config_id: "456",
  graph_version: "v25.0", state: "not_started" };
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200,
  headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  sdk.prepare.mockResolvedValue({}); sdk.launch.mockReturnValue(vi.fn());
  fetchMock.mockImplementation(async () => json(available));
});

it("prepares in Kova and opens Meta only on the next explicit click", async () => {
  fetchMock.mockImplementation(async (input) => String(input).endsWith("/start")
    ? json({ session_id: "session-a", nonce: "synthetic-nonce", expires_at: new Date(Date.now() + 600_000).toISOString() })
    : json(available));
  render(<WhatsAppSignupPanel identity={identity} onConnected={connected} />);
  fireEvent.click(await screen.findByRole("button", { name: "Conectar WhatsApp" }));
  const authorize = await screen.findByRole("button", { name: "Autorizar en Meta" });
  expect(sdk.launch).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/start"))?.[1]?.method).toBe("POST");
  fireEvent.click(authorize);
  expect(sdk.launch).toHaveBeenCalledTimes(1);
  const finish = sdk.launch.mock.calls[0][2] as (value: SignupResult) => void;
  finish({ code: "synthetic-code", waba_id: "987", phone_number_id: "654", event: "FINISH" });
  await waitFor(() => expect(connected).toHaveBeenCalledTimes(1));
  const submit = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/finish"));
  expect(JSON.parse(String(submit?.[1]?.body))).toEqual({ session_id: "session-a", nonce: "synthetic-nonce",
    code: "synthetic-code", waba_id: "987", phone_number_id: "654", event: "FINISH" });
  expect(submit?.[1]?.headers).toMatchObject({ "X-Kova-Expected-Tenant": identity.tenantId,
    "X-Kova-Expected-User": identity.userId, "X-Kova-Branch": identity.branchId });
  expect(screen.queryByText(/synthetic-code|synthetic-nonce|session-a/)).not.toBeInTheDocument();
});

it("keeps managers and uncertain registrations away from another signup", async () => {
  fetchMock.mockResolvedValue(json({ ...available, can_manage: false }));
  const view = render(<WhatsAppSignupPanel identity={identity} onConnected={connected} />);
  expect(await screen.findByText("El dueño del negocio debe autorizar esta conexión.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Conectar WhatsApp" })).not.toBeInTheDocument();
  view.unmount();
  fetchMock.mockImplementation(async () => json({ ...available, state: "review_required" }));
  render(<WhatsAppSignupPanel identity={identity} onConnected={connected} />);
  expect(await screen.findByRole("link", { name: "Solicitar revisión" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Conectar WhatsApp" })).not.toBeInTheDocument();
  expect(sdk.prepare).not.toHaveBeenCalled();
});
