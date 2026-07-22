import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  ImageIcon,
  Landmark,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterPaymentMethodSelector, RegisterProductCard } from "@/register/RegisterPresentation";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";

type PaymentMethod = "cash" | "transfer" | "card";
type CategoryFilter = "all" | "hot" | "cold" | "bakery" | "food";

type ShowcaseProduct = {
  id: string;
  name: string;
  price: number;
  category: Exclude<CategoryFilter, "all">;
  image?: string;
};

const PRODUCTS: readonly ShowcaseProduct[] = [
  { id: "agua", name: "Agua mineral", price: 32, category: "cold", image: "/showcase/products/agua-mineral.png" },
  { id: "alfajores", name: "Alfajores", price: 32, category: "bakery", image: "/showcase/products/alfajores.png" },
  { id: "capuchino", name: "Capuchino mediano", price: 56, category: "hot", image: "/showcase/products/capuchino-mediano.png" },
  { id: "chocolate", name: "Chocolate frío", price: 55, category: "cold", image: "/showcase/products/chocolate-frio.png" },
  { id: "cold-brew", name: "Cold brew", price: 62, category: "cold", image: "/showcase/products/cold-brew.png" },
  { id: "concha", name: "Concha vainilla", price: 24, category: "bakery", image: "/showcase/products/concha-vainilla.png" },
  { id: "croissant", name: "Croissant mantequilla", price: 42, category: "bakery", image: "/showcase/products/croissant-mantequilla.png" },
  { id: "yogurt", name: "Yogurt con granola", price: 68, category: "food" },
];

const COMPLETE_CART: Record<string, number> = { "cold-brew": 1, capuchino: 1, yogurt: 1 };

export default function SweetHomeRegisterDemo({
  interactive = true,
  autoPlay = false,
}: {
  interactive?: boolean;
  autoPlay?: boolean;
}) {
  const [cart, setCart] = useState<Record<string, number>>(() => autoPlay
    ? { "cold-brew": 1, capuchino: 1 }
    : COMPLETE_CART);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("200");
  const [charged, setCharged] = useState(false);

  useEffect(() => {
    if (!autoPlay) return;
    setQuery("");
    setCart({ "cold-brew": 1, capuchino: 1 });
    setMethod("cash");
    setCashReceived("200");
    setCharged(false);
    const searchTimer = window.setTimeout(() => setQuery("yogurt"), 900);
    const addTimer = window.setTimeout(() => {
      setCart(COMPLETE_CART);
      setQuery("");
    }, 2200);
    const chargeTimer = window.setTimeout(() => setCharged(true), 4300);
    return () => {
      window.clearTimeout(searchTimer);
      window.clearTimeout(addTimer);
      window.clearTimeout(chargeTimer);
    };
  }, [autoPlay]);

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-MX");
    return PRODUCTS.filter((product) => {
      const categoryMatches = filter === "all" || product.category === filter;
      const queryMatches = !normalized || product.name.toLocaleLowerCase("es-MX").includes(normalized);
      return categoryMatches && queryMatches;
    });
  }, [filter, query]);

  const items = Object.entries(cart).flatMap(([productId, quantity]) => {
    const product = PRODUCTS.find((candidate) => candidate.id === productId);
    return product && quantity > 0 ? [{ product, quantity }] : [];
  });
  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const received = Number(cashReceived) || 0;
  const change = Math.max(0, received - total);

  const updateQuantity = (productId: string, delta: number) => {
    if (!interactive) return;
    setCharged(false);
    setCart((current) => {
      const nextQuantity = Math.max(0, (current[productId] ?? 0) + delta);
      const next = { ...current };
      if (nextQuantity === 0) delete next[productId];
      else next[productId] = nextQuantity;
      return next;
    });
  };

  return (
    <div className="lp-pos-container h-full min-h-0">
      <div className="lp-pos-preview h-full min-h-0 bg-background p-3 text-foreground">
        <Card className="lp-pos-main min-w-0 overflow-hidden">
          <CardHeader className="border-b p-3 pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShoppingBag className="h-4 w-4" />
                {copy.register.catalog}
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">{copy.register.itemCount(PRODUCTS.length)}</Badge>
            </div>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                readOnly={!interactive}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.register.skuSearchPlaceholder}
                className="h-9 w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {([
                ["all", "Todos"],
                ["hot", "Café caliente"],
                ["cold", "Bebidas frías"],
                ["bakery", "Pan dulce"],
                ["food", "Alimentos"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => interactive && setFilter(value)}
                  aria-pressed={filter === value}
                  className={filter === value
                    ? "rounded-full bg-primary px-3 py-1.5 text-[10px] font-medium text-primary-foreground shadow-sm"
                    : "rounded-full bg-muted px-3 py-1.5 text-[10px] font-medium text-muted-foreground"}
                >
                  {label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-3">
            <div className="lp-pos-grid">
              {visibleProducts.map((product) => (
                <div key={product.id} data-showcase-product={product.id}>
                  <RegisterProductCard
                    name={product.name}
                    price={product.price}
                    quantity={cart[product.id]}
                    ariaLabel={`Agregar ${product.name}`}
                    onAdd={() => updateQuantity(product.id, 1)}
                    image={
                      <div className="aspect-square w-12 shrink-0 overflow-hidden rounded-lg bg-muted/50 sm:w-full">
                        {product.image ? (
                          <img src={product.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></span>
                        )}
                      </div>
                    }
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="lp-pos-ticket min-w-0 space-y-3">
          <Card aria-label={copy.register.cart}>
            <CardHeader className="border-b p-3 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm"><ShoppingCart className="h-4 w-4" />{copy.register.cart}</CardTitle>
                <Badge variant="secondary" className="text-[10px]">{quantity}</Badge>
              </div>
            </CardHeader>
            <CardContent className="lp-pos-lines max-h-48 space-y-2 overflow-auto p-3">
              {items.map(({ product, quantity: lineQuantity }) => (
                <div key={product.id} className="flex items-center gap-2 rounded-lg border bg-background p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{product.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatMoney(product.price)} c/u</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label={copy.register.decreaseQuantity} onClick={() => updateQuantity(product.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-md border"><Minus className="h-3 w-3" /></button>
                    <span className="w-4 text-center text-xs font-semibold tabular-nums">{lineQuantity}</span>
                    <button type="button" aria-label={copy.register.increaseQuantity} onClick={() => updateQuantity(product.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-md border"><Plus className="h-3 w-3" /></button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-medium text-muted-foreground">{copy.register.total}</span>
                <span className="text-xl font-bold text-kova-ink tabular-nums">{formatMoney(total)}</span>
              </div>
              <RegisterPaymentMethodSelector
                compact
                label={copy.register.paymentMethod}
                value={method}
                onChange={(next) => { if (interactive) { setCharged(false); setMethod(next); } }}
                options={[
                  { value: "cash", label: copy.register.cash, icon: <Banknote className="h-3.5 w-3.5" /> },
                  { value: "transfer", label: copy.register.bankTransfer, icon: <Landmark className="h-3.5 w-3.5" /> },
                  { value: "card", label: copy.register.manualCard, icon: <CreditCard className="h-3.5 w-3.5" /> },
                ]}
              />
              {method === "cash" ? (
                <div className="lp-pos-cash space-y-1.5">
                  <label htmlFor="showcase-cash" className="text-[10px] font-medium text-muted-foreground">Efectivo recibido</label>
                  <input
                    id="showcase-cash"
                    inputMode="decimal"
                    value={cashReceived}
                    readOnly={!interactive}
                    onChange={(event) => { setCharged(false); setCashReceived(event.target.value); }}
                    className="h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <p className="text-[10px] text-muted-foreground">Cambio: <strong className="text-foreground">{formatMoney(change)}</strong></p>
                </div>
              ) : null}
              <button
                type="button"
                data-showcase-charge
                onClick={() => interactive && setCharged(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
              >
                {charged ? <><CheckCircle2 className="h-4 w-4" />Demo completada</> : `Cobrar ${formatMoney(total)}`}
              </button>
              {charged ? <p role="status" className="text-center text-[10px] font-medium text-kova-growth">Simulación local: no se registró ninguna venta.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
