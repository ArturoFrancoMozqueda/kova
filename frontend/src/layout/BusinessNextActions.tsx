import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

type Action = { to: string; label: string };
type Journey = { paths: string[]; actions: Action[] };

// Destinations are existing screens, so labels describe the task available there.
// Access is inherited from the shell's permission and feature filtered navigation.
const journeys: Journey[] = [
  { paths: ["/catalog"], actions: [
    { to: "/inventory", label: "Revisar existencias" },
    { to: "/purchasing", label: "Preparar compra" },
  ] },
  { paths: ["/settings/public-catalog"], actions: [
    { to: "/commercial-requests", label: "Atender solicitudes" },
    { to: "/catalog", label: "Editar productos y fotos" },
  ] },
  { paths: ["/inventory"], actions: [
    { to: "/replenishment", label: "Planear reposición" },
    { to: "/purchasing", label: "Preparar compra" },
  ] },
  { paths: ["/replenishment"], actions: [
    { to: "/purchasing", label: "Preparar compra" },
    { to: "/inventory", label: "Revisar existencias" },
  ] },
  { paths: ["/purchasing"], actions: [
    { to: "/inventory", label: "Revisar existencias" },
    { to: "/register", label: "Cobrar una venta" },
  ] },
  { paths: ["/commercial-requests", "/crm", "/quotes"], actions: [
    { to: "/pedidos", label: "Revisar pedidos" },
    { to: "/customers", label: "Gestionar clientes" },
  ] },
  { paths: ["/orders", "/pedidos"], actions: [
    { to: "/service-cases", label: "Atender incidencias" },
    { to: "/reports", label: "Revisar resultados" },
  ] },
  { paths: ["/service-cases", "/followups", "/inbox", "/appointments", "/loyalty", "/customers"], actions: [
    { to: "/operations-queue", label: "Atender pendientes" },
    { to: "/customers", label: "Gestionar clientes" },
  ] },
  { paths: ["/reports", "/expenses", "/reconciliation"], actions: [
    { to: "/operations-queue", label: "Atender pendientes" },
  ] },
];

export function BusinessNextActions({ pathname, destinations, canCreateCustomerOrders = false }: {
  pathname: string; destinations: readonly { to: string }[]; canCreateCustomerOrders?: boolean;
}) {
  const journey = journeys.find(item => item.paths.includes(pathname));
  const allowed = new Set(destinations.map(item => item.to));
  const actions = journey?.actions.filter(action => allowed.has(action.to)
    && pathname !== action.to && !pathname.startsWith(`${action.to}/`)).slice(0, 2).map(action => action.to === "/pedidos" && canCreateCustomerOrders
      ? { to: "/pedidos/nuevo", label: "Crear pedido" } : action) ?? [];
  if (!actions.length) return null;

  return (
    <nav aria-label="Continúa tu operación" className="mx-4 mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-kova-border bg-white px-4 py-2 print:hidden sm:mx-6">
      <p className="text-xs font-medium text-kova-muted">Continúa tu operación</p>
      <div className="flex flex-wrap gap-x-5">
        {actions.map(action => (
          <Link key={action.to} to={action.to} className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-kova-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue">
            {action.label}<ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          </Link>
        ))}
      </div>
    </nav>
  );
}
