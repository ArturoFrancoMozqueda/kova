/**
 * Canal de soporte oficial durante la beta controlada de Kova.
 *
 * Dirección pública del dominio: Cloudflare reenvía al buzón de soporte existente.
 * Landing, legales y ayuda comparten este contacto.
 */
export const SUPPORT_EMAIL = "soporte@kovasuite.com";

/** Enlace `mailto:` listo para usar en `href`. */
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

export function supportMailto(requestId: string | null): string {
  const params = new URLSearchParams({
    subject: "Ayuda con Kova",
    body: requestId
      ? `Cuéntanos qué pasó y qué estabas intentando hacer.\n\nReferencia técnica: ${requestId}`
      : "Cuéntanos qué pasó y qué estabas intentando hacer.",
  });
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}

// Verified against the public Kova landing contact link on 2026-07-29.
export const SUPPORT_WHATSAPP =
  "https://wa.me/524434053710?text=Hola%2C%20vengo%20de%20kovasuite.com%20y%20quiero%20saber%20si%20Kova%20sirve%20para%20mi%20negocio.";
