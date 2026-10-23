import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductPhoto } from "./ProductPhoto";
import { MenuQuantity } from "./MenuQuantity";
import { menuMoney, priceInCents, type MenuProduct } from "./menu";

export function MenuProductDetails({ product, quantity, disabled, cannotAdd, onQuantityChange, onClose }: {
  product: MenuProduct | null;
  quantity: number;
  disabled: boolean;
  cannotAdd: boolean;
  onQuantityChange: (value: number) => void;
  onClose: () => void;
}) {
  return <Dialog open={product !== null} onClose={onClose}>
    {product && <>
      <DialogHeader className="pr-8"><DialogTitle className="break-words leading-snug">{product.name}</DialogTitle></DialogHeader>
      <div className="overflow-hidden rounded-2xl"><ProductPhoto product={product} /></div>
      <p className="mt-4 text-xl font-semibold tabular-nums">{menuMoney(priceInCents(product.price_amount))} <span className="text-sm font-normal text-kova-muted">MXN</span></p>
      {product.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-kova-muted">{product.description}</p>}
      {product.availability !== "available" && <p className="mt-4 text-sm text-kova-muted">Agotado por el momento.</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {quantity > 0 ? <>
          <MenuQuantity name={product.name} quantity={quantity} disabled={disabled} onChange={onQuantityChange} />
          <Button type="button" onClick={onClose}>Seguir viendo el menú</Button>
        </> : <Button type="button" className="w-full" disabled={disabled || cannotAdd || product.availability !== "available"}
          onClick={() => { onQuantityChange(1); onClose(); }}>Agregar al pedido</Button>}
      </div>
    </>}
  </Dialog>;
}
