// Local es-MX copy for the internal ops dashboard. Kept out of the shared
// i18n/messages.ts (which ships in the tenant bundle) since this module is
// lazy-loaded and single-user.
export const opsCopy = {
  brand: "Kova Ops",
  internalBadge: "interno",
  nav: {
    overview: "Portada",
    tenants: "Clientes",
    revenue: "Revenue",
    funnel: "Funnel",
    technical: "Técnica",
    incidents: "Incidentes",
    trace: "Trace",
  },
  status: {
    ok: "Operando",
    warning: "Atención",
    critical: "Crítico",
    degraded: "Degradado",
    not_configured: "Sin configurar",
  },
  severity: {
    critical: "Crítico",
    warning: "Atención",
    info: "Info",
  },
  triage: {
    new: "Nuevo",
    acknowledged: "Reconocido",
    investigating: "Investigando",
    resolved: "Resuelto",
    ignored: "Ignorado",
  },
  common: {
    retry: "Reintentar",
    loadError: "No se pudo cargar la información.",
    empty: "Sin datos por ahora.",
    updatedAt: "Actualizado",
    viewAll: "Ver todo",
    notConfigured: "Integración sin configurar. Agrega el token para verla aquí.",
  },
} as const;
