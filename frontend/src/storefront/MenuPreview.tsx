import { ArrowUpRight, UtensilsCrossed } from "lucide-react";
import { LivePreview } from "@/components/ui/live-preview";
import { MenuProductCard } from "./MenuProductCard";
import type { MenuProduct } from "./menu";

export type MenuPreviewProduct = Omit<MenuProduct, "availability" | "description"> & {
  description?: string | null;
};

const noop = () => undefined;

/**
 * Renders the public menu from the unsaved publication draft with the same
 * product cards customers see. Availability depends on live inventory when the
 * menu opens, so every card is shown as available here and the note says so.
 */
export function MenuPreview({
  title,
  description,
  whatsappPhone,
  enabled,
  products,
  className,
}: {
  title: string;
  description: string | null;
  whatsappPhone: string | null;
  enabled: boolean;
  products: MenuPreviewProduct[];
  className?: string;
}) {
  const shownTitle = title.trim() || "Nombre de tu menú";
  const validWhatsapp = !!whatsappPhone && /^[1-9][0-9]{9,14}$/.test(whatsappPhone.trim());
  const count = products.length;
  const summary = `${enabled ? "Menú marcado para publicar" : "Menú sin publicar"} con el título ${shownTitle}, ${count} ${count === 1 ? "producto" : "productos"}${validWhatsapp ? " y botón para consultar por WhatsApp" : ""}.`;
  return (
    <LivePreview
      label="Vista previa del menú público"
      className={className}
      summary={summary}
      frame={{ caption: "Así lo ven tus clientes", icon: <UtensilsCrossed className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /> }}
      note={<>
        {!enabled && <p className="mb-1 font-medium text-kova-ink">Aún no está publicado: tus clientes no lo verán hasta que actives “Publicar catálogo” y guardes.</p>}
        <p>La disponibilidad de cada producto se toma de tu inventario cuando el cliente abre el menú.</p>
      </>}
    >
      <div className="border-b border-kova-border bg-white px-4 py-4">
        <p className="break-words text-xl font-semibold tracking-tight text-kova-ink">{shownTitle}</p>
        {description?.trim() && <p className="mt-1 break-words text-sm leading-relaxed text-kova-muted">{description.trim()}</p>}
        {validWhatsapp && <span className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-full border border-kova-border px-4 text-xs font-medium">
          Consultar por WhatsApp<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>}
      </div>
      <div className="max-h-[28rem] overflow-hidden px-3 py-3">
        <p className="mb-2 text-sm font-semibold">Nuestro menú <span className="font-normal text-kova-muted">· {count} {count === 1 ? "producto" : "productos"}</span></p>
        {count === 0 ? (
          <div className="rounded-2xl border border-dashed border-kova-border bg-white p-5 text-sm text-kova-muted">
            Marca los productos que quieres mostrar y aparecerán aquí.
          </div>
        ) : (
          <div className="grid grid-cols-3 items-stretch gap-2 lg:grid-cols-1">
            {products.slice(0, 6).map(product => (
              <MenuProductCard
                key={product.id}
                product={{ ...product, description: product.description ?? null, availability: "available" }}
                quantity={0}
                disabled
                cannotAdd={false}
                onQuantityChange={noop}
                onDetails={noop}
              />
            ))}
          </div>
        )}
        {count > 6 && <p className="mt-2 text-center text-xs text-kova-muted">y {count - 6} más</p>}
      </div>
    </LivePreview>
  );
}
