import type { CSSProperties } from "react";
import { LivePreview } from "@/components/ui/live-preview";
import { TicketPaper } from "@/components/ui/ticket";
import { CardFace, defaultCardColor } from "@/loyaltyCard/CardFace";

/**
 * Where the business logo shows up: the app header, the printed receipt and,
 * when the owner chooses it, the loyalty card. `imageStyle` previews an
 * unsaved crop; the saved file already has the crop applied.
 */
export function LogoPlacementPreview({
  src,
  imageStyle,
  businessName,
  saved,
  unsavedTitle = "Vista previa · Sin guardar",
}: {
  src: string;
  imageStyle?: CSSProperties;
  businessName: string;
  /** The saved logo URL can be shown on the real loyalty card face. */
  saved: boolean;
  unsavedTitle?: string;
}) {
  const name = businessName.trim() || "Tu negocio";
  return (
    <LivePreview
      label="Dónde aparece tu logo"
      title={saved ? "Dónde aparece tu logo" : unsavedTitle}
      summary={`El logo aparece en el encabezado de Kova y en tus recibos impresos${saved ? ", y en la tarjeta de lealtad si eliges usarlo" : ""}.`}
      note={saved ? <p>En la tarjeta de lealtad aparece si activas “Usar el logo del negocio” en Lealtad.</p> : undefined}
    >
      <div className={saved ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
        <figure className="space-y-1.5">
          <div className="flex items-center gap-3 rounded-kova-md bg-kova-ink p-3 text-white">
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-kova-md bg-white ring-1 ring-inset ring-white/15">
              <img src={src} alt="" className="h-full w-full object-cover" style={imageStyle} />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
          </div>
          <figcaption className="text-xs text-kova-muted">Encabezado de Kova</figcaption>
        </figure>
        <figure className="space-y-1.5">
          <TicketPaper className="mx-auto w-full max-w-[12rem]">
            <div className="flex flex-col items-center gap-1.5 p-3 text-center font-mono text-[11px] text-[color:var(--ticket-ink)]">
              <span className="h-10 w-10 overflow-hidden">
                <img src={src} alt="" className="h-full w-full object-contain" style={imageStyle} />
              </span>
              <p className="text-xs font-semibold">{name}</p>
              <p className="tkt-caption text-[10px]">Recibo de venta</p>
            </div>
          </TicketPaper>
          <figcaption className="text-xs text-kova-muted">Recibo impreso</figcaption>
        </figure>
        {saved && (
          <figure className="space-y-1.5 sm:col-span-2">
            <div className="mx-auto max-w-[18rem]">
              <CardFace label="Tarjeta de lealtad con tu logo" businessName={name} appearance={{ color: defaultCardColor, use_business_logo: true, logo_url: src }}>
                <p className="text-sm font-medium">Puntos de tu cliente</p>
              </CardFace>
            </div>
            <figcaption className="text-center text-xs text-kova-muted">Tarjeta de lealtad</figcaption>
          </figure>
        )}
      </div>
    </LivePreview>
  );
}
