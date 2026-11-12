import { copy } from "@/i18n/messages";

// Prices are resolved from the public server catalog at runtime. Static SEO
// must not retain an old offer after a server-side commercial rollout.
export const LANDING_SEO = {
  faq: copy.landing.faq.items.filter(({ q }) => q !== copy.landing.faq.plansQuestion && q !== "¿Qué pasa cuando termina la prueba?").map(({ q, a }) => ({ q, a })),
} as const;
