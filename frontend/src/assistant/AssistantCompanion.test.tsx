import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ state: { status: "authenticated", tenantId: "tenant-a", tenantName: "Mi tienda", sessionMode: "online", user: { id: "user-a", role: "owner" } } }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => auth }));
import { AssistantCompanion } from "./AssistantCompanion";

let consent = false;
let ready = false;
let localReady = false;
function LocationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="Ubicación">{location.pathname}{location.search}</output><button onClick={() => navigate("/reports?period=month")}>Ir a análisis</button></>;
}
function Host({ enabled = true }: { enabled?: boolean }) {
  return <MemoryRouter initialEntries={["/catalog?search=private-name"]}><LocationControls /><AssistantCompanion enabled={enabled} /></MemoryRouter>;
}
describe("floating Kova companion", () => {
  beforeEach(() => {
    consent = false; ready = false; localReady = false;
    auth.state.tenantId = "tenant-a"; auth.state.user.id = "user-a"; auth.state.user.role = "owner"; auth.state.sessionMode = "online";
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.split("/assistant")[1];
      const data = path === "/capabilities" ? { enabled: true, inference_ready: ready, local_answers_ready: localReady, provider_name: "Groq" }
        : path === "/preferences" ? init?.method === "PUT" ? JSON.parse(String(init.body)) : { chat_consent: consent, chat_provider: "groq", document_consent: false, email_opt_in: false, frequency: "weekly" }
        : path === "/usage" ? { tenant_used: 0, tenant_limit: 8000, user_used: 0, user_limit: 6000, reset_at: "2026-10-07T00:00:00Z" }
        : path === "/conversations" ? { id: "chat-a", data: {} }
        : path === "/conversations/chat-a/messages" ? { id: "run-a", status: "queued", data: {} }
        : path === "/conversations/chat-a" ? { messages: [{ id: "message-a", data: { role: "user", content: "Revisa mis ventas" } }] }
        : path === "/runs/run-a" ? { id: "run-a", status: "queued", data: {} }
        : {};
      return new Response(JSON.stringify(data), { status: 200 });
    }));
  });
  it("opens a logo button without navigating, granting consent or starting inference", async () => {
    render(<Host />);
    const trigger = screen.getByRole("button", { name: "Abrir asistente Kova" });
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    await screen.findByRole("button", { name: "Aceptar y habilitar consultas" });
    expect(screen.getByRole("dialog", { name: "Asistente Kova" })).toHaveAttribute("aria-modal", "false");
    expect(screen.getByLabelText("Ubicación")).toHaveTextContent("/catalog?search=private-name");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(screen.getByText(/La IA aún no está conectada/)).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it("keeps the question across pages and changes only its presentation context", async () => {
    consent = true; ready = true;
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    const field = await screen.findByRole("textbox", { name: "Tu pregunta" });
    fireEvent.change(field, { target: { value: "Mi pregunta privada" } });
    fireEvent.click(screen.getByRole("button", { name: "Ir a análisis" }));
    expect(screen.getByLabelText("Ubicación")).toHaveTextContent("/reports?period=month");
    expect(field).toHaveValue("Mi pregunta privada");
    expect(screen.getByText("Mi tienda · Análisis")).toBeVisible();
    expect(screen.getByRole("button", { name: "Revisa mis ventas de este mes" })).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("names the recipient and submits explicit consent for that provider", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    expect(await screen.findByText(/enviaremos a Groq tu pregunta/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y habilitar consultas" }));
    await waitFor(() => {
      const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ chat_consent: true, chat_provider: "groq" });
    });
  });
  it("sends only an explicit question with captured tenant scope and a durable continuation link", async () => {
    consent = true; ready = true;
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Tu pregunta" }), { target: { value: "Revisa mis ventas" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar pregunta" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Abrir asistente completo" })).toHaveAttribute("href", "/assistant?conversation=chat-a&run=run-a"));
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/messages"))!;
    expect(JSON.parse(String(init?.body))).toEqual({ content: "Revisa mis ventas" });
    expect(new Headers(init?.headers).get("X-Kova-Expected-Tenant")).toBe("tenant-a");
    expect(new Headers(init?.headers).get("X-Kova-Expected-User")).toBe("user-a");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBeTruthy();
    expect(screen.getByLabelText("Ubicación")).toHaveTextContent("/catalog?search=private-name");
    expect(window.localStorage.getItem("assistant-conversation")).toBeNull();
  });
  it("offers and submits a supported catalog question without inference", async () => {
    consent = true; localReady = true;
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    const question = await screen.findByRole("button", { name: "¿Cómo importar mi catálogo?" });
    fireEvent.click(question);
    expect(screen.getByRole("textbox", { name: "Tu pregunta" })).toHaveValue("¿Cómo importar mi catálogo?");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Enviar pregunta" }));
    await waitFor(() => {
      const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/messages"));
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({ content: "¿Cómo importar mi catálogo?" });
    });
  });
  it("allows direct questions when inference is unavailable", async () => {
    consent = true; localReady = true;
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Tu pregunta" }), { target: { value: "Cuánto vendí hoy" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar pregunta" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/messages"))).toBe(true));
  });
  it("clears private draft and aborts old requests when tenant changes", async () => {
    consent = true; ready = true;
    const view = render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Tu pregunta" }), { target: { value: "Privado del primer negocio" } });
    const [, oldRequest] = vi.mocked(fetch).mock.calls[0];
    auth.state.tenantId = "tenant-b";
    view.rerender(<Host />);
    expect(oldRequest?.signal?.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    expect(await screen.findByRole("textbox", { name: "Tu pregunta" })).toHaveValue("");
  });
  it.each(["modal", "tour"])("yields to %s overlays", async kind => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir asistente Kova" }));
    await screen.findByRole("button", { name: "Aceptar y habilitar consultas" });
    const modal = document.createElement("div");
    modal.setAttribute(kind === "modal" ? "aria-modal" : "aria-labelledby", kind === "modal" ? "true" : "first-use-tour-title");
    await act(async () => { document.body.appendChild(modal); });
    try {
      await waitFor(() => expect(screen.queryByRole("button", { name: "Abrir asistente Kova" })).toBeNull());
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally { await act(async () => { modal.remove(); }); }
    await screen.findByRole("button", { name: "Abrir asistente Kova" });
  });
  it.each(["disabled", "cashier", "offline"])("does not load private data when %s", mode => {
    if (mode === "cashier") auth.state.user.role = "cashier";
    if (mode === "offline") auth.state.sessionMode = "offline";
    render(<Host enabled={mode !== "disabled"} />);
    expect(screen.queryByRole("button", { name: "Abrir asistente Kova" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
