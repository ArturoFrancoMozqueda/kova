/**
 * Canal de soporte oficial durante la beta controlada de Kova.
 *
 * Fuente única de verdad: cuando exista un buzón del dominio (p. ej. soporte@kova.mx),
 * cambiar solo este valor y toda la app (landing, legales, footer) queda actualizada.
 */
export const SUPPORT_EMAIL = "posprojectsupport@gmail.com";

/** Enlace `mailto:` listo para usar en `href`. */
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

// Verified against the public Kova landing contact link on 2026-07-29.
export const SUPPORT_WHATSAPP =
  "https://wa.me/524434053710?text=Hola%2C%20vengo%20de%20kovasuite.com%20y%20quiero%20saber%20si%20Kova%20sirve%20para%20mi%20negocio.";
