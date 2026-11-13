import { useState } from "react";
import { ShoppingCart, UtensilsCrossed } from "lucide-react";
import { LivePreview } from "@/components/ui/live-preview";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RegisterProductCard } from "@/register/RegisterPresentation";
import { RegisterProductPhoto } from "@/register/RegisterProductPhoto";
import { MenuProductCard } from "@/storefront/MenuProductCard";
import { formatMoney } from "@/orders/format";

type Surface = "register" | "menu";
const noop = () => undefined;

/**
 * Shows the product draft with the exact tiles used by Caja and the public
 * menu, so the owner sees how the name, price and photo crop will look before
 * saving. Stock badges depend on live inventory, so they are described in the
 * note instead of being simulated.
 */
export function ProductPreview({
  name,
  description,
  price,
  imageUrl,
  imagePositionX,
  imagePositionY,
  imageZoom,
  trackInventory,
  lowStockThreshold,
  modifierGroupNames,
  className,
}: {
  name: string;
  description: string;
  price: string;
  imageUrl: string | null;
  imagePositionX: number;
  imagePositionY: number;
  imageZoom: number;
  trackInventory: boolean;
  lowStockThreshold: string;
  modifierGroupNames: string[];
  className?: string;
}) {
  const [surface, setSurface] = useState<Surface>("register");
  const shownName = name.trim() || "Tu producto";
  const priceValue = Number(price);
  const shownPrice = price.trim() !== "" && Number.isFinite(priceValue) && priceValue >= 0 ? price : "0";
  const photo = { image_url: imageUrl, image_position_x: imagePositionX, image_position_y: imagePositionY, image_zoom: imageZoom };
  const threshold = Number(lowStockThreshold);
  const summary = `${shownName}, ${formatMoney(shownPrice)}, ${imageUrl ? "con fotografía" : "sin fotografía"}${surface === "register" ? ", como se ve en Caja" : ", como se ve en tu menú digital"}.`;
  return (
    <LivePreview
      label="Vista previa del producto"
      summary={summary}
      className={className}
      controls={
        <SegmentedControl
          ariaLabel="Dónde ver el producto"
          value={surface}
          onValueChange={setSurface}
          options={[
            { value: "register", label: "En Caja" },
            { value: "menu", label: "En tu menú" },
          ]}
        />
      }
      frame={surface === "register"
        ? { caption: "Así lo ve tu equipo en Caja", icon: <ShoppingCart className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /> }
        : { caption: "Así lo ven tus clientes", icon: <UtensilsCrossed className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /> }}
      note={<ul className="space-y-1">
        {surface === "register" && trackInventory && Number.isInteger(threshold) && threshold > 0 && <li>Caja lo marcará como “Bajo” cuando queden {threshold} o menos, y como “Agotado” al terminarse.</li>}
        {surface === "register" && modifierGroupNames.length > 0 && <li>Al tocarlo, Caja pedirá: {modifierGroupNames.join(", ")}.</li>}
        {surface === "menu" && <li>Solo aparece en tu menú digital si lo eliges en Catálogo público.</li>}
      </ul>}
    >
      <div className="p-3">
        {surface === "register" ? (
          <div className="mx-auto max-w-[11rem]">
            <RegisterProductCard
              gridTile
              ariaLabel="Producto en Caja"
              name={shownName}
              price={shownPrice}
              image={imageUrl ? <RegisterProductPhoto product={photo} /> : undefined}
            />
          </div>
        ) : (
          <div className="mx-auto max-w-[7.5rem] lg:max-w-none">
            <MenuProductCard
              product={{ id: "preview", name: shownName, description: description.trim() || null, price_amount: shownPrice, availability: "available", ...photo }}
              quantity={0}
              disabled
              cannotAdd={false}
              onQuantityChange={noop}
              onDetails={noop}
            />
          </div>
        )}
      </div>
    </LivePreview>
  );
}
