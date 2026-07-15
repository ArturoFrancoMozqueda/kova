// Marco compartido de las pantallas de acceso (login, signup, recuperación,
// verificación e invitación). Antes cada vista repetía el mismo <main> con un
// gradient one-off; ahora todas comparten el fondo kova (mist + acento sky),
// la Card con la sombra del sistema y la anatomía de encabezado del resto del
// producto (h1 = text-2xl font-semibold tracking-tight).
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AuthLayout({
  title,
  subtitle,
  children,
  contentClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Extra classes para CardContent (p.ej. "text-center", "space-y-3"). */
  contentClassName?: string;
}) {
  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden bg-kova-mist p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-kova-grad-sky opacity-70"
        style={{
          maskImage: "linear-gradient(180deg, black, transparent)",
          WebkitMaskImage: "linear-gradient(180deg, black, transparent)",
        }}
      />
      <div className="relative w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            <LogoMark size={48} circuitColor="var(--kova-ink)" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground mt-1">{subtitle}</p> : null}
        </div>
        <Card className="shadow-kova-hero">
          <CardContent className={cn("p-6", contentClassName)}>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
