import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { LivePreview } from "@/components/ui/live-preview";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RegisterProductCard } from "@/register/RegisterPresentation";
import { RegisterProductPhoto } from "@/register/RegisterProductPhoto";
import { DevicePreview } from "@/components/ui/device-preview";
import { useOptionalAuth } from "@/auth/useAuth";
import { hasPlanFeature } from "@/billing/entitlements";
import { formatTenantName } from "@/lib/formatTenantName";
import { CatalogContent } from "@/storefront/StorefrontView";
import { formatMoney } from "@/orders/format";

type Surface = "register" | "menu";

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
  const auth = useOptionalAuth();
  const session = auth?.state.status === "authenticated" ? auth.state : null;
  const businessName = formatTenantName(session?.tenantName ?? "") || "Tu negocio";
  const shownName = name.trim() || "Tu producto";
  const priceValue = Number(price);
  const shownPrice = price.trim() !== "" && Number.isFinite(priceValue) && priceValue >= 0 ? price : "0";
  const photo = { image_url: imageUrl, image_position_x: imagePositionX, image_position_y: imagePositionY, image_zoom: imageZoom };
  const threshold = Number(lowStockThreshold);
  const summary = `${shownName}, ${formatMoney(shownPrice)}, ${imageUrl ? "con fotografía" : "sin fotografía"}${surface === "register" ? ", como se ve en Caja" : ", como se ve en tu menú digital"}.`;
  return (
    <LivePreview
      selfContained={surface === "menu"}
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
      frame={surface === "register" ? { caption: "Así lo ve tu equipo en Caja", icon: <ShoppingCart className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /> } : undefined}
      note={<ul className="space-y-1">
        {surface === "register" && trackInventory && Number.isInteger(threshold) && threshold > 0 && <li>Caja lo marcará como “Bajo” cuando queden {threshold} o menos, y como “Agotado” al terminarse.</li>}
        {surface === "register" && modifierGroupNames.length > 0 && <li>Al tocarlo, Caja pedirá: {modifierGroupNames.join(", ")}.</li>}
        {surface === "menu" && <li>Así lo ven tus clientes en su teléfono. Solo aparece en tu menú digital si lo eliges en Catálogo público.</li>}
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
          <DevicePreview device="phone" title="Vista previa del producto en tu menú">
            <main className="min-h-screen bg-[#FAFAF7] text-kova-ink">
              <CatalogContent token="vista-previa" preview data={{
                title: businessName, description: null, whatsapp_phone: null, checkout_available: false,
                requests_available: hasPlanFeature(session?.commercialAccess, "customer_orders"),
                products: [{ id: "preview", name: shownName, description: description.trim() || null, price_amount: shownPrice, availability: "available", ...photo }],
              }} />
            </main>
          </DevicePreview>
        )}
      </div>
    </LivePreview>
  );
}
