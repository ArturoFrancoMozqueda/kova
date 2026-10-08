import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantComposer, AssistantConversation, AssistantUsage, AssistantWelcome } from "./AssistantChat";
import AnswerContent from "./AnswerContent";
import { EvidenceCards, SalesEvidence } from "./EvidenceCards";
import type { Resource } from "./api";

const message = (id: string, role: string, content: string): Resource => ({ id, kind: "message", status: "ready", shared: false, can_edit: true, branch_id: "branch-a", created_at: "", updated_at: "", data: { role, content } });
const completed: Resource = { ...message("run-a", "assistant", ""), kind: "run", status: "completed", data: { metrics: { net_sales: "125.50", order_count: 2, start_date: "2026-10-01", end_date: "2026-10-06" }, sources: [{ id: "source-a", title: "Guía de ventas", page: 1, path: "/help/sales" }] } };
afterEach(() => vi.unstubAllGlobals());

describe("provider-aware assistant quota", () => {
  it("distinguishes a temporary limit from the rolling daily token allowance", () => {
    render(<AssistantUsage usage={{ tenant_used: 200, tenant_limit: 60000, user_used: 200, user_limit: 60000, reset_at: "2026-10-08T02:00:00Z", unit: "tokens", provider: "groq", window: "rolling_24h", limit_kind: "temporary" }} />);
    expect(screen.getByText("La IA tiene una pausa temporal")).toBeInTheDocument();
    expect(screen.getByText(/60,000 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Se libera gradualmente/)).toBeInTheDocument();
    expect(screen.getByText("La ayuda y los reportes directos siguen disponibles.")).toBeInTheDocument();
  });
  it("keeps older quota payloads readable", () => {
    render(<AssistantUsage usage={{ tenant_used: 8000, tenant_limit: 9000, user_used: 8000, user_limit: 9000, reset_at: "2026-10-08T00:00:00Z" }} />);
    expect(screen.getByText(/9,000 unidades/)).toBeInTheDocument();
    expect(screen.getByText(/89% de la cuota diaria/)).toBeInTheDocument();
  });
  it("distinguishes the shared monthly pause from a business daily allowance", () => {
    render(<AssistantUsage usage={{ tenant_used: 200, tenant_limit: 60000, user_used: 200,
      user_limit: 60000, reset_at: "2026-10-09T00:00:00Z", retry_at: "2026-11-01T00:00:00Z",
      unit: "tokens", provider: "openrouter", window: "utc_day", limit_kind: "provider_monthly" }} />);
    expect(screen.getByText("La capacidad mensual compartida de IA se agotó")).toBeInTheDocument();
    expect(screen.getByText(/Cuota diaria compartida: 200/)).toBeInTheDocument();
    expect(screen.getByText("La ayuda y los reportes directos siguen disponibles.")).toBeInTheDocument();
  });
});

describe("readable and safe assistant answers", () => {
  it("renders emphasis, sections, lists and tables as semantic content", () => {
    render(<AnswerContent content={"## Lo que encontré\n\nHay **ventas completadas**.\n\n- Revisa tu catálogo\n- Compara productos\n\n| Producto | Acción |\n| --- | --- |\n| Café | Revisar |"} />);
    expect(screen.getByRole("heading", { name: "Lo que encontré" })).toBeVisible();
    expect(screen.getByText("ventas completadas").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeVisible();
  });
  it("does not execute HTML, load remote images or activate model-authored links", () => {
    const { container } = render(<AnswerContent content={'<script>alert("private")</script>\n\n<img src="https://example.com/tracker">\n\n![tracking](https://example.com/pixel)\n\n[Abre aquí](javascript:alert(1)) y [Otro enlace](https://example.com)'} />);
    expect(container.querySelector("script, img, iframe, a")).toBeNull();
    expect(screen.getByText("Abre aquí")).toBeVisible();
    expect(screen.getByText("Otro enlace")).toBeVisible();
  });
  it("copies an assistant response only on an explicit click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<AssistantConversation messages={[message("m-a", "assistant", "Una **respuesta** clara.")]} run={null} busy={false} onCancel={vi.fn()} empty={null} />);
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copiar respuesta" }));
    await screen.findByRole("button", { name: "Respuesta copiada" });
    expect(writeText).toHaveBeenCalledWith("Una **respuesta** clara.");
  });
  it("shows a useful message if clipboard access fails", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<AssistantConversation messages={[message("m-a", "assistant", "Respuesta")]} run={null} busy={false} onCancel={vi.fn()} empty={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar respuesta" }));
    await screen.findByText("No pudimos copiar. Selecciona el texto para copiarlo.");
  });
  it("keeps evidence and authorized sources readable on both chat surfaces", () => {
    render(<AssistantConversation compact messages={[message("m-a", "assistant", "Revisa tus resultados.")]} run={completed} busy={false} onCancel={vi.fn()} empty={null} />);
    expect(screen.getByRole("region", { name: "Resultados de ventas" })).toHaveTextContent("$125.50");
    expect(screen.queryByText("Venta bruta")).toBeNull();
    const summary = screen.getByText("Fuentes consultadas · 1");
    fireEvent.click(summary);
    expect(screen.getByRole("link", { name: "Guía de ventas · Página 1" })).toHaveAttribute("href", "/help/sales");
  });
  it.each([false, true])("keeps saved answer evidence after reopening and avoids a duplicate live run: compact=%s", compact => {
    const saved: Resource = { ...message("saved-answer", "assistant", "Revisa tus resultados."),
      data: { ...completed.data, role: "assistant", content: "Revisa tus resultados.", run_id: completed.id } };
    const props = { compact, messages: [saved], busy: false, onCancel: vi.fn(), empty: null };
    const view = render(<AssistantConversation {...props} run={null} />);
    expect(screen.getAllByRole("region", { name: "Resultados de ventas" })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Resultados de ventas" })).toHaveTextContent("$125.50");
    fireEvent.click(screen.getByText("Fuentes consultadas · 1"));
    expect(screen.getByRole("link", { name: "Guía de ventas · Página 1" })).toBeVisible();
    view.rerender(<AssistantConversation {...props} run={completed} />);
    expect(screen.getAllByRole("region", { name: "Resultados de ventas" })).toHaveLength(1);
    expect(screen.getAllByText("Fuentes consultadas · 1")).toHaveLength(1);
  });
  it("does not present pending evidence as a completed result and can cancel", () => {
    const onCancel = vi.fn();
    render(<AssistantConversation messages={[]} run={{ ...completed, status: "running" }} busy={false} onCancel={onCancel} empty={null} />);
    expect(screen.queryByRole("region", { name: "Resultados de ventas" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Consultando los datos de tu negocio…");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("does not steal the scroll position while reading earlier messages", async () => {
    const props = { run: null, busy: false, onCancel: vi.fn(), empty: null };
    const view = render(<AssistantConversation {...props} messages={[message("m-user", "user", "Pregunta")]} />);
    const log = screen.getByRole("log");
    Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    log.scrollTop = 20;
    fireEvent.scroll(log);
    view.rerender(<AssistantConversation {...props} messages={[message("m-user", "user", "Pregunta"), message("m-answer", "assistant", "Una respuesta")]} />);
    await waitFor(() => expect(log.scrollTop).toBe(20));
    fireEvent.click(screen.getByRole("button", { name: "Ir al último mensaje" }));
    expect(log.scrollTop).toBe(1000);
  });
  it("keeps the explanation in place when its evidence finishes loading", () => {
    const messages = [message("m-answer", "assistant", "Revisa los resultados registrados.")];
    const props = { messages, busy: false, onCancel: vi.fn(), empty: null };
    const view = render(<AssistantConversation {...props} run={{ ...completed, status: "running", data: {} }} />);
    const log = screen.getByRole("log");
    Object.defineProperties(log, { scrollHeight: { configurable: true, value: 300 }, clientHeight: { configurable: true, value: 280 } });
    log.scrollTop = 0;
    fireEvent.scroll(log);
    view.rerender(<AssistantConversation {...props} run={completed} />);
    expect(log.scrollTop).toBe(0);
  });
});

describe("composer and suggestions", () => {
  it("fills a suggestion without transmitting it", () => {
    const onSuggestion = vi.fn();
    render(<AssistantWelcome onSuggestion={onSuggestion} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Revisa mis ventas de este mes" }));
    expect(onSuggestion).toHaveBeenCalledWith("Revisa mis ventas de este mes");
  });
  it("submits with Enter, preserves Shift+Enter and ignores composition input", () => {
    const onSubmit = vi.fn(event => event.preventDefault());
    render(<AssistantComposer id="question" value="Revisa mis ventas" onChange={vi.fn()} onSubmit={onSubmit} disabled={false} ready />);
    const field = screen.getByRole("textbox", { name: "Tu pregunta" });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  it.each([{ ready: false, disabled: false, value: "Pregunta" }, { ready: true, disabled: true, value: "Pregunta" }, { ready: true, disabled: false, value: "   " }])("blocks both keyboard and submit when unavailable: %j", props => {
    const onSubmit = vi.fn();
    render(<AssistantComposer id="question" {...props} onChange={vi.fn()} onSubmit={onSubmit} />);
    const field = screen.getByRole("textbox");
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.submit(field.closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Consultar" })).toBeDisabled();
  });
});

describe("real business evidence", () => {
  it("preserves zero amounts and omits metrics the backend did not return", () => {
    render(<SalesEvidence metrics={{ net_sales: "0.00", order_count: 0 }} />);
    expect(screen.getByText("$0.00")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.queryByText("Venta bruta")).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
  it("shows missing numeric evidence as missing, rather than inventing a zero", () => {
    render(<SalesEvidence metrics={{ net_sales: "unavailable" }} />);
    expect(screen.getByText("Sin dato")).toBeVisible();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
  it("keeps inventory quality limitations and the empty state", () => {
    render(<EvidenceCards cards={[{ kind: "get_inventory", data: { restock_alerts: [], inventory_valuation: { complete: false, tracked_products: 0, products_without_cost: 2 } } }]} />);
    expect(screen.getByText(/No hay productos con control de inventario/)).toBeVisible();
    expect(screen.getByText(/Faltan costos de 2 productos/)).toBeVisible();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/reports");
  });
});
