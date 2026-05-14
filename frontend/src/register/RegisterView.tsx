import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CATALOG_CREATE_PERMISSION,
  ORDER_CREATE_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { listProducts } from "../catalog/api";
import type { Product } from "../catalog/types";
import { copy } from "../i18n/messages";
import { formatMoney } from "../orders/format";
import type { Order } from "../orders/types";
import { queueOfflineSale } from "../offline/queue";
import { syncOfflineSales } from "../offline/sync";
import { triggerSync } from "../offline/syncWorker";
import { ModifierSelectionModal } from "./ModifierSelectionModal";
import type { SelectedModifier } from "./ModifierSelectionModal";
import { useToast } from "@/components/ui/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  SplitSquareHorizontal,
  CheckCircle2,
  ExternalLink,
  RotateCcw,
  Loader2,
  LayoutGrid,
  AlertCircle,
  ShoppingBag,
  Tag,
} from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Product[] };

type CartItem = {
  product: Product;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  effectiveUnitPrice: string;
};

type PaymentMethod = "cash" | "bank_transfer" | "manual_card";

type PaymentDraft = {
  id: string;
  method: PaymentMethod;
  amount: string;
  amountTendered: string;
  reference: string;
};

let nextPaymentDraftId = 0;

function createPaymentDraft(method: PaymentMethod, amount = ""): PaymentDraft {
  nextPaymentDraftId += 1;
  return {
    id: `payment-${nextPaymentDraftId}`,
    method,
    amount,
    amountTendered: "",
    reference: "",
  };
}

function moneyToCents(value: string): number {
  const normalized = value.trim() || "0";
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(`${fraction}00`.slice(0, 2), 10);
}

function centsToMoney(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}


export default function RegisterView() {
  const { state } = useAuth();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const canManageCatalog = usePermission(CATALOG_CREATE_PERMISSION);
  const canCreateOrders = usePermission(ORDER_CREATE_PERMISSION);
  const { toast } = useToast();

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashTendered, setCashTendered] = useState("");
  const [reference, setReference] = useState("");
  const [splitPaymentsEnabled, setSplitPaymentsEnabled] = useState(false);
  const [splitPayments, setSplitPayments] = useState<PaymentDraft[]>([
    createPaymentDraft("cash"),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [modifierTarget, setModifierTarget] = useState<Product | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const products = (await listProducts()).filter((product) => product.is_active);
      setLoadState({ status: "ready", products });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
    void triggerSync();
  }, [load]);

  // Derive unique categories from products
  const categories = useMemo(() => {
    if (loadState.status !== "ready") return [];
    const catMap = new Map<string, string>();
    for (const p of loadState.products) {
      if (p.category_id) {
        // We don't have category names in the product list, use category_id
        catMap.set(p.category_id, p.category_id);
      }
    }
    return Array.from(catMap.keys());
  }, [loadState]);

  const filteredProducts = useMemo(() => {
    if (loadState.status !== "ready") return [];
    if (!selectedCategory) return loadState.products;
    return loadState.products.filter((p) => p.category_id === selectedCategory);
  }, [loadState, selectedCategory]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const totalCents = useMemo(
    () =>
      cartItems.reduce(
        (sum, item) => sum + moneyToCents(item.effectiveUnitPrice) * item.quantity,
        0,
      ),
    [cartItems],
  );
  const totalAmount = centsToMoney(totalCents);
  const tenderedCents = moneyToCents(cashTendered);
  const changeDueCents =
    paymentMethod === "cash" && tenderedCents >= totalCents ? tenderedCents - totalCents : 0;
  const cashIsValid = paymentMethod !== "cash" || tenderedCents >= totalCents;
  const splitPaymentTotalCents = useMemo(
    () => splitPayments.reduce((sum, payment) => sum + moneyToCents(payment.amount), 0),
    [splitPayments],
  );
  const splitRemainingCents = totalCents - splitPaymentTotalCents;
  const splitCashIsValid = splitPayments.every(
    (payment) =>
      payment.method !== "cash" ||
      moneyToCents(payment.amountTendered) >= moneyToCents(payment.amount),
  );
  const splitHasPayment = splitPayments.some((payment) => moneyToCents(payment.amount) > 0);
  const splitTotalMatches = splitPaymentTotalCents === totalCents;
  const splitIsValid =
    !splitPaymentsEnabled || (splitHasPayment && splitTotalMatches && splitCashIsValid);
  const canSubmitSale =
    canCreateOrders &&
    cartItems.length > 0 &&
    (splitPaymentsEnabled ? splitIsValid : cashIsValid) &&
    !submitting;

  const addProduct = (product: Product) => {
    if ((product.modifier_groups ?? []).length > 0) {
      setModifierTarget(product);
      return;
    }
    commitAddProduct(product, []);
  };

  const commitAddProduct = (product: Product, selectedModifiers: SelectedModifier[]) => {
    const deltaSum = selectedModifiers.reduce((s, m) => s + moneyToCents(m.priceDelta), 0);
    const effectiveUnitPrice = centsToMoney(moneyToCents(product.price_amount) + deltaSum);
    const cartKey = [product.id, ...selectedModifiers.map((m) => m.optionId).sort()].join(":");
    setCart((current) => {
      const existing = current[cartKey];
      return {
        ...current,
        [cartKey]: {
          product,
          quantity: existing ? existing.quantity + 1 : 1,
          selectedModifiers,
          effectiveUnitPrice,
        },
      };
    });
    setCompletedOrder(null);
  };

  const updateQuantity = (cartKey: string, quantity: number) => {
    setCart((current) => {
      if (quantity <= 0) {
        const next = { ...current };
        delete next[cartKey];
        return next;
      }
      const item = current[cartKey];
      if (!item) return current;
      return { ...current, [cartKey]: { ...item, quantity } };
    });
  };

  const removeItem = (cartKey: string) => {
    setCart((current) => {
      const next = { ...current };
      delete next[cartKey];
      return next;
    });
  };

  const toggleSplitPayments = (enabled: boolean) => {
    setSplitPaymentsEnabled(enabled);
    if (enabled) {
      setSplitPayments([
        {
          ...createPaymentDraft(paymentMethod, totalAmount),
          amountTendered: paymentMethod === "cash" ? cashTendered || totalAmount : "",
          reference: paymentMethod === "cash" ? "" : reference,
        },
      ]);
    }
  };

  const updateSplitPayment = (
    paymentId: string,
    patch: Partial<Omit<PaymentDraft, "id">>,
  ) => {
    setSplitPayments((current) =>
      current.map((payment) => (payment.id === paymentId ? { ...payment, ...patch } : payment)),
    );
  };

  const addSplitPayment = () => {
    setSplitPayments((current) => [
      ...current,
      createPaymentDraft("bank_transfer", centsToMoney(Math.max(splitRemainingCents, 0))),
    ]);
  };

  const removeSplitPayment = (paymentId: string) => {
    setSplitPayments((current) =>
      current.length === 1 ? current : current.filter((payment) => payment.id !== paymentId),
    );
  };

  const resetSale = () => {
    setCart({});
    setPaymentMethod("cash");
    setCashTendered("");
    setReference("");
    setSplitPaymentsEnabled(false);
    setSplitPayments([createPaymentDraft("cash")]);
    setCompletedOrder(null);
  };

  const submitSale = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmitSale) return;

    setSubmitting(true);

    const sale = {
      items: cartItems.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        modifier_option_ids: item.selectedModifiers.map((m) => m.optionId),
      })),
      payments: splitPaymentsEnabled
        ? splitPayments
            .filter((payment) => moneyToCents(payment.amount) > 0)
            .map((payment) => ({
              method: payment.method,
              amount: centsToMoney(moneyToCents(payment.amount)),
              ...(payment.method === "cash"
                ? { amount_tendered: centsToMoney(moneyToCents(payment.amountTendered)) }
                : { reference: payment.reference.trim() || undefined }),
            }))
        : [
            {
              method: paymentMethod,
              amount: totalAmount,
              ...(paymentMethod === "cash"
                ? { amount_tendered: centsToMoney(tenderedCents) }
                : { reference: reference.trim() || undefined }),
            },
          ],
    };

    const queueItem = await queueOfflineSale(sale);

    setCart({});
    setCashTendered("");
    setReference("");
    setSplitPaymentsEnabled(false);
    setSplitPayments([createPaymentDraft("cash")]);

    try {
      const results = await syncOfflineSales([queueItem]);
      const result = results[0];
      if (result.status === "synced" && result.order) {
        setCompletedOrder(result.order as Order);
        toast(copy.register.saleComplete, "success");
      } else {
        toast(copy.register.saleQueued, "warning");
      }
    } catch {
      toast(copy.register.saleQueued, "warning");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadState.status === "loading") {
    return (
      <main className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-8 w-24 mb-4" />
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="p-6 lg:p-8 max-w-7xl mx-auto">
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div>
              <p className="font-medium">{copy.register.loadError}</p>
              <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            </div>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">
              {copy.register.retry}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground">{tenantName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{copy.register.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {canManageCatalog && (
            <Link to="/catalog" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                <LayoutGrid className="h-4 w-4" />
                {copy.register.manageCatalog}
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Product Grid */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                {copy.register.catalog}
              </CardTitle>
              <Badge variant="secondary">{loadState.products.length} items</Badge>
            </div>
            {/* Category pills */}
            {categories.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-all",
                    !selectedCategory
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                  type="button"
                >
                  All
                </button>
                {categories.map((catId) => (
                  <button
                    key={catId}
                    onClick={() => setSelectedCategory(catId)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-all",
                      selectedCategory === catId
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                    type="button"
                  >
                    {catId.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-4">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <ShoppingBag className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="font-medium text-muted-foreground">{copy.register.catalogPlaceholder}</p>
                {canManageCatalog && (
                  <Link to="/catalog" className={cn(buttonVariants({ variant: "link" }), "mt-2")}>
                    {copy.register.manageCatalog}
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    aria-label={copy.register.add}
                    onClick={() => addProduct(product)}
                    className="group flex flex-col justify-between rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.97] min-h-[120px]"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                        {product.name}
                      </p>
                      {product.sku && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          {product.sku}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-base font-bold text-primary">
                        {formatMoney(product.price_amount)}
                      </span>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cart + Payment */}
        <div className="space-y-4">
          <Card aria-label={copy.register.cart}>
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  {copy.register.cart}
                </CardTitle>
                {cartItems.length > 0 && (
                  <Badge variant="secondary">{cartItems.reduce((s, i) => s + i.quantity, 0)}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {cartItems.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <ShoppingCart className="h-10 w-10 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">{copy.register.cartPlaceholder}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cartItems.map((item) => {
                    const cartKey = [item.product.id, ...item.selectedModifiers.map((m) => m.optionId).sort()].join(":");
                    return (
                      <div
                        key={cartKey}
                        className="flex items-start gap-3 rounded-lg border bg-background p-3 animate-fade-in"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{item.product.name}</p>
                          {item.selectedModifiers.map((m) => (
                            <p key={m.optionId} className="text-xs text-muted-foreground mt-0.5">
                              → {m.optionName}
                              {parseFloat(m.priceDelta) > 0 && ` (+${formatMoney(m.priceDelta)})`}
                            </p>
                          ))}
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatMoney(item.effectiveUnitPrice)} each
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateQuantity(cartKey, item.quantity - 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted transition-colors"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(cartKey, item.quantity + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">
                            {formatMoney(centsToMoney(moneyToCents(item.effectiveUnitPrice) * item.quantity))}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeItem(cartKey)}
                            className="text-xs text-destructive hover:underline mt-1"
                          >
                            <Trash2 className="h-3 w-3 inline" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment section */}
          <Card>
            <form onSubmit={(event) => void submitSale(event)}>
              <CardContent className="p-4 space-y-4">
                {/* Total */}
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">{copy.register.total}</span>
                  <span className="text-2xl font-bold">{formatMoney(totalAmount)}</span>
                </div>

                {!canCreateOrders && (
                  <div className="flex items-center gap-2 rounded-lg bg-warning/20 border border-warning/30 px-3 py-2 text-sm text-warning-foreground">
                    <AlertCircle className="h-4 w-4" />
                    {copy.register.permissionHidden}
                  </div>
                )}

                {/* Split toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={splitPaymentsEnabled}
                    onChange={(event) => toggleSplitPayments(event.target.checked)}
                    className="rounded border-input text-primary focus:ring-primary"
                  />
                  <SplitSquareHorizontal className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{copy.register.splitPayment}</span>
                </label>

                {splitPaymentsEnabled ? (
                  <div className="space-y-3">
                    {splitPayments.map((payment, index) => (
                      <div key={payment.id} className="rounded-lg border p-3 space-y-2 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground uppercase">
                            Payment {index + 1}
                          </span>
                          <button
                            type="button"
                            disabled={splitPayments.length === 1}
                            onClick={() => removeSplitPayment(payment.id)}
                            className="text-xs text-destructive hover:underline disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </div>
                        <Select
                          value={payment.method}
                          onChange={(event) =>
                            updateSplitPayment(payment.id, {
                              method: event.target.value as PaymentMethod,
                              amountTendered: "",
                              reference: "",
                            })
                          }
                        >
                          <option value="cash">{copy.register.cash}</option>
                          <option value="bank_transfer">{copy.register.bankTransfer}</option>
                          <option value="manual_card">{copy.register.manualCard}</option>
                        </Select>
                        <div className="space-y-1">
                          <Label htmlFor={`amount-${payment.id}`}>{copy.register.amount}</Label>
                          <Input
                            id={`amount-${payment.id}`}
                            min="0"
                            step="0.01"
                            type="number"
                            placeholder={copy.register.amount}
                            value={payment.amount}
                            onChange={(event) =>
                              updateSplitPayment(payment.id, { amount: event.target.value })
                            }
                          />
                        </div>
                        {payment.method === "cash" ? (
                          <div className="space-y-1">
                            <Label htmlFor={`cashTendered-${payment.id}`}>{copy.register.amountTendered}</Label>
                            <Input
                              id={`cashTendered-${payment.id}`}
                              min="0"
                              step="0.01"
                              type="number"
                              placeholder={copy.register.amountTendered}
                              value={payment.amountTendered}
                              onChange={(event) =>
                                updateSplitPayment(payment.id, { amountTendered: event.target.value })
                              }
                            />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Label htmlFor={`reference-${payment.id}`}>{copy.register.paymentReference}</Label>
                            <Input
                              id={`reference-${payment.id}`}
                              placeholder={copy.register.optionalReference}
                              value={payment.reference}
                              onChange={(event) =>
                                updateSplitPayment(payment.id, { reference: event.target.value })
                              }
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={addSplitPayment} className="w-full">
                      <Plus className="h-3.5 w-3.5" />
                      {copy.register.addPayment}
                    </Button>
                    <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{copy.register.paymentTotal}</span>
                        <span className="font-semibold">{formatMoney(centsToMoney(splitPaymentTotalCents))}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{copy.register.remaining}</span>
                        <span className={cn("font-semibold", splitRemainingCents !== 0 && "text-destructive")}>
                          {formatMoney(centsToMoney(Math.abs(splitRemainingCents)))}
                        </span>
                      </div>
                    </div>
                    {!splitTotalMatches && cartItems.length > 0 && (
                      <p className="flex items-center gap-1.5 text-xs text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {copy.register.splitTotalMismatch}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="paymentMethod">{copy.register.paymentMethod}</Label>
                      <Select
                        id="paymentMethod"
                        value={paymentMethod}
                        onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                      >
                        <option value="cash">{copy.register.cash}</option>
                        <option value="bank_transfer">{copy.register.bankTransfer}</option>
                        <option value="manual_card">{copy.register.manualCard}</option>
                      </Select>
                    </div>

                    {paymentMethod === "cash" ? (
                      <div className="space-y-2">
                        <Label htmlFor="cashTendered">{copy.register.amountTendered}</Label>
                        <Input
                          id="cashTendered"
                          min="0"
                          step="0.01"
                          type="number"
                          placeholder={copy.register.amountTendered}
                          value={cashTendered}
                          onChange={(event) => setCashTendered(event.target.value)}
                        />
                        <div className="flex justify-between rounded-lg bg-muted/50 p-3 text-sm">
                          <span className="text-muted-foreground">{copy.register.changeDue}</span>
                          <span className="font-bold text-primary">{formatMoney(centsToMoney(changeDueCents))}</span>
                        </div>
                        {!cashIsValid && cartItems.length > 0 && (
                          <p className="flex items-center gap-1.5 text-xs text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {copy.register.cashTooLow}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="reference">{copy.register.paymentReference}</Label>
                        <Input
                          id="reference"
                          placeholder={copy.register.optionalReference}
                          value={reference}
                          onChange={(event) => setReference(event.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  disabled={!canSubmitSale}
                  size="xl"
                  className="w-full"
                  variant={canSubmitSale ? "success" : "default"}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {copy.register.salePending}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-5 w-5" />
                      {copy.register.completeSale}
                    </>
                  )}
                </Button>
              </CardContent>
            </form>
          </Card>

          {/* Completed sale result */}
          {completedOrder && (
            <Card className="border-success/30 bg-success/5 animate-fade-in">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <span className="font-semibold text-success">{copy.register.saleComplete}</span>
                </div>
                <div className="flex gap-2">
                  <Link to={`/orders/${completedOrder.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {copy.register.openOrder}
                  </Link>
                  <Button size="sm" onClick={resetSale}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {copy.register.newSale}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {modifierTarget && (
        <ModifierSelectionModal
          productName={modifierTarget.name}
          modifierGroups={modifierTarget.modifier_groups}
          onConfirm={(selected) => {
            commitAddProduct(modifierTarget, selected);
            setModifierTarget(null);
          }}
          onCancel={() => setModifierTarget(null)}
        />
      )}
    </main>
  );
}
