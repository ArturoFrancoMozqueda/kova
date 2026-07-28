/**
 * Canal de WhatsApp de Kova (conversión/contacto secundario en la landing).
 *
 * Fuente única de verdad, mismo patrón que lib/support.ts: una constante (no
 * env var) para que el prerender y el cliente vean siempre el mismo valor.
 *
 * `WHATSAPP_PHONE` va en formato E.164 SOLO dígitos, sin "+" ni espacios
 * (p. ej. "5215512345678" para un celular de CDMX). Mientras esté vacío, todo
 * el canal (botón flotante, link en FAQ, link en footer) queda apagado y no
 * se renderiza nada.
 */
export const WHATSAPP_PHONE = "";

export function isWhatsAppEnabled(): boolean {
  return WHATSAPP_PHONE.length > 0;
}

/** Link `wa.me` con mensaje pre-llenado, listo para usar en `href`. */
export function whatsAppLink(message: string): string {
  return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
}
