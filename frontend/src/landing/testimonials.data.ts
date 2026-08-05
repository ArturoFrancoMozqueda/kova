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
  business: string;
  outcome: string;
  // Nombre de la persona y ciudad: opcionales, pero suben mucho la
  // credibilidad — agrégalos en cuanto el cliente dé permiso.
  name?: string;
  city?: string;
};

export const TESTIMONIALS: readonly Testimonial[] = [
  {
    quote: "Kova me ha ayudado mucho a leer mejor mi negocio y potenciarlo con ventas inteligentes",
    business: "Sweet Home",
    outcome: "Decidir con datos",
  },
  {
    // Extracto fiel de la cita autorizada: conserva la ventaja comprobable sin
    // presentar multi-sucursal como una función nativa del producto.
    quote: "Con Kova he podido llevar el control… sin depender de una misma computadora",
    business: "Café Chapatito",
    outcome: "Trabajar desde cualquier equipo",
  },
];
