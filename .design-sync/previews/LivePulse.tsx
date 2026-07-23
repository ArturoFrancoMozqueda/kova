import { Card, CardContent, LivePulse } from "pos-frontend";

export function Standalone() {
  return (
    <div className="p-6">
      <LivePulse label="En vivo" />
    </div>
  );
}

export function InCardHeader() {
  return (
    <div className="max-w-sm p-6">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-semibold text-kova-ink">Ventas de hoy</p>
            <p className="text-2xl font-bold tabular-nums text-kova-ink">$8,420.00</p>
          </div>
          <LivePulse label="En vivo" />
        </CardContent>
      </Card>
    </div>
  );
}
