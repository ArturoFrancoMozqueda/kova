import { ArcKicker, Card, CardContent } from "pos-frontend";

export function SectionDividers() {
  return (
    <div className="max-w-md space-y-3 p-6">
      <ArcKicker label="Resumen de hoy" />
      <Card>
        <CardContent className="p-4 text-sm text-kova-muted">
          Ventas, tickets y ticket promedio del día.
        </CardContent>
      </Card>
      <ArcKicker label="Qué hacer ahora" />
      <Card>
        <CardContent className="p-4 text-sm text-kova-muted">
          Reabastece 3 productos con stock bajo.
        </CardContent>
      </Card>
    </div>
  );
}
