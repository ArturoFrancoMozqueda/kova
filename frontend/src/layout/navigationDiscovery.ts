type Section = { to: string; label: string };

// Task vocabulary helps an owner find the existing destination. Visibility is
// decided by AppShell's role, feature and capability filters before searching.
const sectionDetails: Record<string, { description: string; keywords: string; task?: boolean }> = {
  "/pedidos/nuevo": { description: "Abre el formulario para preparar un pedido nuevo.", keywords: "crear nuevo nueva pedido pedidos encargo", task: true },
  "/catalog?new=product": { description: "Abre el formulario para agregar un producto al catálogo.", keywords: "crear nuevo nueva agregar producto productos", task: true },
  "/settings/employees": { description: "Administra empleados e invitaciones de tu equipo.", keywords: "empleados equipo agregar invitar permisos acceso", task: true },
  "/settings/business-profile": { description: "Actualiza el nombre, contacto y zona horaria de tu negocio.", keywords: "perfil negocio nombre contacto datos zona horaria", task: true },
  "/settings/receipt": { description: "Personaliza los datos y el papel de tus recibos.", keywords: "recibo ticket logo pie papel impresora", task: true },
  "/settings/branches": { description: "Administra sucursales y sus direcciones.", keywords: "sucursal sucursales locales ubicaciones", task: true },
  "/dashboard": { description: "Entiende tus ventas y decide qué atender.", keywords: "resumen hoy numeros negocio panel" },
  "/register": { description: "Agrega productos y cobra una venta.", keywords: "vender cobrar caja ticket efectivo tarjeta servicio servicios identificar socio canjear recompensa" },
  "/customers": { description: "Consulta clientes y su historial.", keywords: "crear nuevo nueva agregar contactos compradores historial ficha cliente" },
  "/pedidos": { description: "Prepara y entrega pedidos de clientes.", keywords: "crear nuevo nueva preparar encargos entregas pedidos" },
  "/orders": { description: "Consulta las ventas que ya registraste.", keywords: "historial ventas tickets devoluciones" },
  "/shifts": { description: "Revisa turnos abiertos y cortes de caja.", keywords: "abrir cerrar turno corte efectivo caja" },
  "/catalog": { description: "Organiza tus productos, precios y fotos.", keywords: "crear agregar editar producto foto imagen categoria menu precios" },
  "/inventory": { description: "Consulta existencias y registra ajustes.", keywords: "stock existencias inventario ajustes cantidades" },
  "/purchasing": { description: "Organiza compras y proveedores.", keywords: "comprar proveedor recepcion mercancia abastecer" },
  "/replenishment": { description: "Revisa qué productos necesitas reponer.", keywords: "reponer reposicion faltantes stock comprar productos" },
  "/reports": { description: "Entiende qué vendes y cómo se mueve tu negocio.", keywords: "analisis reportes estadisticas numeros ventas vendo mejores productos horarios" },
  "/expenses": { description: "Registra y revisa los gastos del negocio.", keywords: "gastos egresos costos dinero" },
  "/reconciliation": { description: "Compara cobros y movimientos registrados.", keywords: "conciliar conciliacion cobros diferencias dinero pagos" },
  "/operations-queue": { description: "Prioriza seguimientos y recordatorios pendientes.", keywords: "pendientes tareas hoy atender recordatorios proximas acciones" },
  "/service-cases": { description: "Atiende dudas e incidencias de tus clientes.", keywords: "soporte casos incidencias atencion postventa reclamos" },
  "/appointments": { description: "Organiza citas y sus recordatorios.", keywords: "agenda agendar calendario cita citas reservar reagendar servicio servicios recordatorios" },
  "/loyalty": { description: "Configura tarjetas, puntos y recompensas de tus clientes.", keywords: "lealtad fidelidad fidelizacion puntos clientes tarjeta tarjetas digital digitales recompensa recompensas premio premios canje canjear saldo socio socios" },
  "/inbox": { description: "Organiza conversaciones y borradores de respuesta.", keywords: "mensajes conversaciones responder bandeja atencion" },
  "/commercial-requests": { description: "Atiende lo que solicitan desde tu catálogo público.", keywords: "solicitudes interesados productos catalogo publico clientes" },
  "/followups": { description: "Da seguimiento después de una venta.", keywords: "postventa seguimiento recompra clientes tareas" },
  "/crm": { description: "Organiza oportunidades y próximas acciones comerciales.", keywords: "oportunidades prospectos interesados seguimiento comercial vender clientes" },
  "/quotes": { description: "Prepara cotizaciones para tus clientes.", keywords: "crear nuevo nueva preparar cotizar cotizaciones presupuesto propuesta precios" },
  "/automations": { description: "Configura reglas y revisa sus ejecuciones.", keywords: "automatizar automatizaciones reglas recordatorios tareas" },
  "/assistant": { description: "Consulta al asistente sobre tu negocio.", keywords: "asistente preguntas ayuda analisis negocio" },
  "/settings/public-catalog": { description: "Comparte productos con fotos y recibe solicitudes.", keywords: "compartir publicar productos catalogo publico menu digital enlace link copiar codigo qr fotos whatsapp" },
  "/settings/channels": { description: "Consulta la disponibilidad y conexión de canales.", keywords: "canales conectar whatsapp meta mensajes integracion" },
  "/settings/integrations": { description: "Guarda datos fiscales y solicitudes de factura de tus ventas.", keywords: "facturas facturacion cfdi solicitudes datos fiscales" },
  "/settings/billing": { description: "Consulta tu suscripción y sus pagos.", keywords: "suscripcion plan pago factura kova contratar" },
  "/settings": { description: "Configura tu negocio, equipo y recibos.", keywords: "ajustes configurar negocio empleados equipo recibos logo sucursales" },
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").replace(/[¿?¡!,.;:]/g, " ");
}

export function sectionDescription(path: string): string | undefined {
  return sectionDetails[path]?.description;
}

export function matchesSectionQuery(section: Section, query: string): boolean {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const details = sectionDetails[section.to];
  const searchable = normalize(`${section.label} ${details?.description ?? ""} ${details?.keywords ?? ""}`);
  return terms.every(term => searchable.includes(term));
}

/** Name matches lead; descriptions still discover destinations across closed groups. */
export function discoverSections<T extends Section>(sections: readonly T[], query: string): T[] {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const score = (section: Section) => terms.filter(term => normalize(section.label).includes(term)).length;
  return sections.filter(section => matchesSectionQuery(section, query)).sort((a, b) =>
    score(b) - score(a) || Number(sectionDetails[b.to]?.task === true) - Number(sectionDetails[a.to]?.task === true));
}
