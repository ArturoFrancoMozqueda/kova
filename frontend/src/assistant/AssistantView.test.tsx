import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined), state: { status: "authenticated", tenantId: "tenant-a", tenantName: "Negocio de prueba", sessionMode: "online", user: { id: "user-a", role: "owner" } } }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth }));
import AssistantView from "./AssistantView";

const proposal = { id: "proposal-a", kind: "proposal", status: "pending_approval", shared: false, can_edit: true, data: { fingerprint: "a".repeat(64), steps: [{ action: "business_profile", values: { public_name: "Mi negocio" }, before: null }] } };
function mount() { return render(<MemoryRouter><AssistantView /></MemoryRouter>); }
describe("tenant assistant review and privacy", () => {
  beforeEach(() => {
    auth.state.user.role = "owner"; auth.state.sessionMode = "online";
    window.sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.split("/assistant")[1];
      const data = path === "/capabilities" ? { enabled: true, inference_ready: false, configuration: true, documents: false, email: false, role: "owner" }
        : path === "/preferences" ? { chat_consent: false, document_consent: false, email_opt_in: false, frequency: "weekly" }
        : path === "/usage" ? { tenant_used: 0, tenant_limit: 8000, user_used: 0, user_limit: 6000, reset_at: "2026-10-07T00:00:00Z" }
        : path === "/proposals" && init?.method === "POST" ? proposal
        : path === "/proposals/proposal-a/confirm" ? { ...proposal, status: "completed" }
        : [];
      return new Response(JSON.stringify(data), { status: 200 });
    }));
  });
  it("does not transmit a query or grant consent on opening", async () => {
    mount();
    expect(document.title).toBe("Asistente · Kova");
    await screen.findByRole("button", { name: "Aceptar y habilitar consultas" });
    expect(vi.mocked(fetch).mock.calls.every(([,init]) => init?.method === "GET")).toBe(true);
    expect(window.localStorage.getItem("assistant-conversation")).toBeNull();
  });
  it("recovers failed capability loading without a permanent loading state", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let failed = false;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/capabilities") && !failed) {
        failed = true;
        return new Response(JSON.stringify({ detail: "Servicio temporalmente no disponible." }), { status: 503 });
      }
      return original(...args);
    });
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("Cargando el asistente…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Volver a cargar" }));
    await screen.findByRole("button", { name: "Aceptar y habilitar consultas" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("hides unavailable configuration and uploads while keeping follow-up usable", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith("/capabilities")
      ? new Response(JSON.stringify({ enabled: true, inference_ready: false, local_answers_ready: true, configuration: false, documents: false, email: false }))
      : original(...args));
    mount();
    await screen.findByRole("button", { name: "Preferencias" });
    expect(screen.queryByRole("button", { name: "Configurar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archivos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Seguimiento" })).toBeVisible();
  });
  it("does not describe an unconfigured inference budget as exhausted capacity", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith("/usage")
      ? new Response(JSON.stringify({ tenant_used: 0, tenant_limit: 0, user_used: 0, user_limit: 0, limit_kind: "provider_monthly", reset_at: "2026-12-01T00:00:00Z" }))
      : original(...args));
    mount();
    await screen.findByRole("button", { name: "Aceptar y habilitar consultas" });
    expect(screen.queryByText(/capacidad mensual compartida/i)).toBeNull();
  });
  it("requires a separate explicit confirmation after preparing a configuration", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Configurar" }));
    fireEvent.change(screen.getByLabelText("Nombre comercial"), { target: { value: "Mi negocio" } });
    fireEvent.click(screen.getByRole("button", { name: "Preparar vista previa" }));
    await screen.findByRole("button", { name: "Aplicar configuración" });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/confirm"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar configuración" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/confirm"))).toBe(true));
    const [,init] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/confirm"))!;
    expect(JSON.parse(String(init?.body))).toEqual({ fingerprint: "a".repeat(64) });
    expect(new Headers(init?.headers).get("X-Kova-Expected-Tenant")).toBe("tenant-a");
  });
  it("recovers a failed poll without resending the question or losing its explanation", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let runReads = 0;
    let posts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = String(input).split("/assistant")[1];
      if (path === "/runs/recovered-run" && ++runReads === 1) {
        return new Response(JSON.stringify({ detail: "Consulta temporalmente no disponible." }), { status: 503 });
      }
      let result: unknown;
      if (path === "/capabilities") result = { enabled: true, inference_ready: true };
      else if (path === "/preferences") result = { chat_consent: true };
      else if (path === "/conversations" && init?.method === "POST") result = { id: "recovered-chat", data: {} };
      else if (path === "/conversations/recovered-chat/messages") {
        posts++;
        result = { id: "recovered-run", status: "queued", data: {} };
      } else if (path === "/runs/recovered-run") result = { id: "recovered-run", status: "completed", data: {} };
      else if (path === "/conversations/recovered-chat") result = { messages: runReads > 1 ? [{ id: "answer", data: { role: "assistant", run_id: "recovered-run", content: "Consulta recuperada con sus fuentes." } }] : [] };
      else return original(input, init);
      return new Response(JSON.stringify(result));
    });
    mount();
    const field = await screen.findByRole("textbox", { name: "Tu pregunta" });
    fireEvent.change(field, { target: { value: "Revisa mis ventas" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    await screen.findByRole("button", { name: "Volver a cargar" }, { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Volver a cargar" }));
    await screen.findByText("Consulta recuperada con sus fuentes.");
    expect(posts).toBe(1);
    expect(screen.queryByText("Preparando tu consulta…")).toBeNull();
  });
  it("refreshes real follow-up when opening its section", async () => {
    mount();
    const section = await screen.findByRole("button", { name: "Seguimiento" });
    const initial = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/tasks")).length;
    fireEvent.click(section);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/tasks")).length).toBeGreaterThan(initial));
    expect(screen.getByText("Pendientes y seguimiento")).toBeVisible();
  });
  it.each([false, true])("keeps the completed explanation and evidence (quota refresh failure: %s)", async quotaRefreshFails => {
    let completed = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.split("/assistant")[1];
      if (path === "/runs/new-run") completed = true;
      if (path === "/usage" && completed && quotaRefreshFails) return new Response(JSON.stringify({ detail: "No pudimos actualizar la cuota." }), { status: 503 });
      // Real conversation reads resolve after React processes the terminal run.
      if (path === "/conversations/new-chat" && completed) await new Promise(resolve => setTimeout(resolve, 20));
      const data = path === "/capabilities" ? { enabled: true, inference_ready: true }
        : path === "/preferences" ? { chat_consent: true }
        : path === "/usage" ? { tenant_used: 0, tenant_limit: 8000, reset_at: "2026-10-08T00:00:00Z" }
        : path === "/conversations" ? init?.method === "POST" ? { id: "new-chat", data: {} } : [{ id: "old-chat", data: { title: "Anterior" } }]
        : path === "/conversations/old-chat" ? { messages: [{ id: "old-message", data: { role: "assistant", content: "Respuesta anterior" } }] }
        : path === "/conversations/new-chat/messages" ? { id: "new-run", status: "queued", data: {} }
        : path === "/conversations/new-chat" ? { messages: [
          { id: "new-message", data: { role: "user", content: "Revisa mis ventas" } },
          ...(completed ? [{ id: "new-answer", data: { role: "assistant", content: "Hay ventas completadas; revisa los productos que contribuyeron al resultado." } }] : []),
        ] }
        : path === "/runs/new-run" ? { id: "new-run", status: "completed", data: { metrics: { net_sales: "125.00", order_count: 2, gross_sales: "125.00", refund_total: "0.00", start_date: "2026-10-01", end_date: "2026-10-06" } } }
        : [];
      return new Response(JSON.stringify(data));
    }));
    render(<MemoryRouter initialEntries={["/assistant?conversation=old-chat"]}><AssistantView /></MemoryRouter>);
    await screen.findByText("Respuesta anterior");
    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
    await screen.findByText("¿Qué quieres resolver hoy?");
    fireEvent.change(screen.getByRole("textbox", { name: "Tu pregunta" }), { target: { value: "Revisa mis ventas" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    await waitFor(() => expect(screen.getByText("Venta neta")).toBeVisible(), { timeout: 4000 });
    await screen.findByText("Hay ventas completadas; revisa los productos que contribuyeron al resultado.");
    expect(screen.queryByText("Respuesta anterior")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/conversations/old-chat"))).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/capabilities"))).toHaveLength(1);
  });
  it.each(["cashier", "offline"])("does not load private context in %s mode", async mode => {
    if (mode === "offline") auth.state.sessionMode = "offline";
    else auth.state.user.role = "cashier";
    mount();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
