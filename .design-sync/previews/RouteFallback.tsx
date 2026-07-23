import { RouteFallback, ShellRouteFallback } from "pos-frontend";

export function FullScreen() {
  return (
    // Clamp the component's min-h-screen so the centered spinner is visible
    // inside the preview cell.
    <div className="rf-clamp">
      <style>{".rf-clamp [role=status] { min-height: 240px !important; }"}</style>
      <RouteFallback label="Cargando" />
    </div>
  );
}

export function InsideShell() {
  return (
    <div className="max-w-3xl">
      <ShellRouteFallback label="Cargando vista" />
    </div>
  );
}
