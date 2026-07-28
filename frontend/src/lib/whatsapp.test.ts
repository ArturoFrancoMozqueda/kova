import { describe, expect, it } from "vitest";
import { WHATSAPP_PHONE, isWhatsAppEnabled, whatsAppLink } from "./whatsapp";

describe("whatsapp channel config", () => {
  it("keeps the phone in digits-only E.164 (no '+', spaces, or dashes)", () => {
    // wa.me solo acepta dígitos; un "+52 1 55..." pegado tal cual rompería el
    // link en silencio. Vacío = canal apagado, también válido.
    expect(WHATSAPP_PHONE).toMatch(/^\d*$/);
  });

  it("is enabled exactly when a phone is configured", () => {
    expect(isWhatsAppEnabled()).toBe(WHATSAPP_PHONE.length > 0);
  });

  it("builds a wa.me link with the message URL-encoded", () => {
    const link = whatsAppLink("Hola, ¿Kova sirve para mi negocio?");
    expect(link).toBe(
      `https://wa.me/${WHATSAPP_PHONE}?text=Hola%2C%20%C2%BFKova%20sirve%20para%20mi%20negocio%3F`,
    );
  });
});
