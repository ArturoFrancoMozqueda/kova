import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "pos-frontend";

export function SaleSummary() {
  return (
    <div className="max-w-sm p-6">
      <Card>
        <CardHeader>
          <CardTitle>Resumen del día</CardTitle>
          <CardDescription>Martes 22 de julio · Sucursal Centro</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-kova-muted">Ventas</span>
              <span className="font-semibold tabular-nums text-kova-ink">$8,420.00</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-kova-muted">Tickets</span>
              <span className="font-semibold tabular-nums text-kova-ink">37</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-kova-muted">Ticket promedio</span>
              <span className="font-semibold tabular-nums text-kova-ink">$227.57</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <Badge variant="success">Turno abierto</Badge>
          <Button size="sm" variant="outline">
            Ver reporte
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export function SimpleContent() {
  return (
    <div className="max-w-sm p-6">
      <Card className="p-5">
        <p className="text-sm text-kova-muted">
          Los cortes de caja se guardan automáticamente al cerrar el turno. Puedes consultarlos en
          Reportes.
        </p>
      </Card>
    </div>
  );
}
