// Testimonios REALES de clientes de Kova. Este arreglo arranca vacío a
// propósito: specs/marketing/landing_metrics.md prohíbe publicar claims no
// verificables y las reglas del frontend prohíben datos inventados en
// producción. La sección #clientes (Testimonials.tsx) no se renderiza — ni en
// el HTML prerenderizado — mientras esto esté vacío; se enciende sola al
// agregar el primer testimonio.
//
// Para publicar uno se necesita: cita textual real, nombre, negocio y ciudad,
// con permiso explícito del cliente. Si la cita incluye una cifra (pesos,
// porcentajes, horas), documenta su fuente y dueño siguiendo el proceso de
// specs/marketing/landing_metrics.md antes de publicarla.
export type Testimonial = {
  quote: string;
  name: string;
  business: string;
  city: string;
};

export const TESTIMONIALS: readonly Testimonial[] = [];
