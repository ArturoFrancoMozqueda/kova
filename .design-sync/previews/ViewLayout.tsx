import { Card, CardContent, CardHeader, CardTitle, ViewHeader, ViewLayout } from "pos-frontend";

export function StandardView() {
  return (
    <ViewLayout width="standard" className="bg-background">
      <div className="space-y-6">
        <ViewHeader
          eyebrow="Operación"
          title="Turnos"
          meta="Corte actual iniciado a las 9:00 a. m."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Efectivo en caja</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-kova-ink">$3,150.00</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ventas del turno</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-kova-ink">$5,270.00</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </ViewLayout>
  );
}
