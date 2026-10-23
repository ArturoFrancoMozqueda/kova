import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuQuantity } from "./MenuQuantity";
import { ProductPhoto } from "./ProductPhoto";
import { menuMoney, priceInCents, type MenuProduct } from "./menu";

export function MenuProductCard({ product, quantity, disabled, cannotAdd, onQuantityChange, onDetails }: {
  product: MenuProduct;
  quantity: number;
  disabled: boolean;
  cannotAdd: boolean;
  onQuantityChange: (value: number) => void;
  onDetails: () => void;
}) {
  const available = product.availability === "available";
  return <article className={`relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white lg:grid lg:grid-cols-[112px_minmax(0,1fr)] lg:gap-x-5 lg:p-5 ${quantity > 0 ? "border-kova-blue/50" : "border-kova-border"}`}>
    <div className="relative lg:self-start">
      <button type="button" onClick={onDetails} aria-label={`Ver detalles de ${product.name}`}
        className="block w-full overflow-hidden text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kova-blue lg:rounded-xl">
        <ProductPhoto product={product} menu />
      </button>
      {!available && <span className="absolute left-1 top-1 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-kova-muted shadow-sm lg:left-2 lg:top-2 lg:text-xs">Agotado</span>}
    </div>
    <div className="flex min-w-0 flex-1 flex-col p-2 sm:p-3 lg:col-start-2 lg:p-0">
      <h3 className="min-h-12 break-words text-[13px] font-semibold leading-4 sm:text-sm sm:leading-5 lg:min-h-0 lg:text-lg lg:leading-snug">{product.name}</h3>
      {product.description && <p className="mt-1.5 hidden break-words text-sm leading-relaxed text-kova-muted lg:block">{product.description}</p>}
      <p className="mt-2 text-sm font-semibold tabular-nums sm:text-base">{menuMoney(priceInCents(product.price_amount))}</p>
      <div className="mt-auto pt-3 lg:ml-auto lg:mt-0">
        {quantity > 0 ? <>
          <Button type="button" variant="secondary" className="w-full whitespace-normal rounded-xl px-1 text-xs lg:hidden"
            aria-label={`Editar cantidad de ${product.name} (${quantity})`} disabled={disabled} onClick={onDetails}>{quantity} en pedido</Button>
          <div className="hidden lg:block"><MenuQuantity name={product.name} quantity={quantity} disabled={disabled} fullWidth onChange={onQuantityChange} /></div>
        </> : <Button type="button" variant="outline" className="w-full gap-1 rounded-xl px-1 text-xs lg:w-auto lg:gap-2 lg:px-4 lg:text-sm" aria-label={`Agregar ${product.name} al pedido`}
            disabled={disabled || !available || cannotAdd} onClick={() => onQuantityChange(1)}>Agregar<Plus aria-hidden="true" /></Button>}
      </div>
    </div>
  </article>;
}
