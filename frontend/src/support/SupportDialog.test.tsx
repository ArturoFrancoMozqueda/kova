import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureApiRequestId, clearLatestRequestId } from "@/lib/supportContext";
import { SUPPORT_EMAIL } from "@/lib/support";
import { SupportDialog } from "./SupportDialog";

const whatsappState = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/whatsapp", () => ({
  isWhatsAppEnabled: () => whatsappState.enabled,
  whatsAppLink: (message: string) => `https://wa.me/verified?text=${encodeURIComponent(message)}`,
}));

describe("SupportDialog", () => {
  afterEach(() => {
    whatsappState.enabled = true;
    clearLatestRequestId();
    vi.restoreAllMocks();
  });

  it("offers the official channels and only an opaque technical reference", () => {
    const requestId = "91a4d81f-2c2b-4f45-89bb-aabc12345678";
    captureApiRequestId(
      "/api/v1/reports/business-story",
      new Response(null, { headers: { "x-request-id": requestId } }),
    );

    render(<SupportDialog open onClose={vi.fn()} />);

    expect(screen.getByRole("link", { name: /enviar correo/i })).toHaveAttribute(
      "href",
      expect.stringContaining(`mailto:${SUPPORT_EMAIL}`),
    );
    expect(screen.getByRole("link", { name: /whatsapp/i })).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(requestId)),
    );
    expect(screen.getByText(requestId)).toBeVisible();
    expect(screen.queryByText(/tenant|cookie|token/i)).not.toBeInTheDocument();
  });

  it("does not invent a reference when no API response has supplied one", () => {
    render(<SupportDialog open onClose={vi.fn()} />);

    expect(screen.getByText(/todavía no hay una referencia disponible/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /copiar referencia/i })).not.toBeInTheDocument();
  });

  it("does not render or invent WhatsApp when the verified channel is disabled", () => {
    whatsappState.enabled = false;

    render(<SupportDialog open onClose={vi.fn()} />);

    expect(screen.queryByRole("link", { name: /whatsapp/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /enviar correo/i })).toBeVisible();
  });

  it("copies the safe reference on demand", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    captureApiRequestId(
      "/api/v1/catalog/products",
      new Response(null, { headers: { "x-request-id": "request-123" } }),
    );
    render(<SupportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /copiar referencia/i }));

    expect(writeText).toHaveBeenCalledWith("request-123");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiada" })).toBeVisible());
  });

  it("handles a denied clipboard permission without an unhandled rejection", async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    captureApiRequestId(
      "/api/v1/catalog/products",
      new Response(null, { headers: { "x-request-id": "request-clipboard-denied" } }),
    );
    render(<SupportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /copiar referencia/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: /copiar referencia/i })).toBeVisible();
  });
});
