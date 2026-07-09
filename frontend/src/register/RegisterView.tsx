import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CATALOG_CREATE_PERMISSION,
  ORDER_CREATE_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { listProducts, listCategories } from "../catalog/api";
import type { Category, Product } from "../catalog/types";
import { listStock } from "../inventory/api";
import type { StockItem } from "../inventory/types";
import { copy } from "../i18n/messages";
import { formatMoney } from "../orders/format";
import type { Order } from "../orders/types";
import { queueOfflineSale } from "../offline/queue";
import { syncOfflineSales } from "../offline/sync";
import { triggerSync } from "../offline/syncWorker";
import { readCatalogCache, saveCatalogCache } from "../offline/catalogCache";
import { ModifierSelectionModal } from "./ModifierSelectionModal";
import type { SelectedModifier } from "./ModifierSelectionModal";
import { getOpenShift } from "@/shifts/api";
import type { Shift } from "@/shifts/types";
import { useToast } from "@/components/ui/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { handleRadioGroupKeyDown } from "@/lib/radiogroup";
import { formatTenantName } from "@/lib/formatTenantName";
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
  Banknote,
  Building2,
  CreditCard,
  Search,
  Sparkles,
  X,
  ChevronUp,
} from "lucide-react";
import { trackFunnelEventOnce } from "@/telemetry/funnel";
import { productImageSrc, productImageSrcSet, productImageStyle } from "@/catalog/imageUrl";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Product[]; categories: Category[]; fromCache?: boolean };

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "select" || tag === "textarea" || target.isContentEditable;
}

const paymentMethodOptions: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { value: "cash", label: copy.register.cash, icon: <Banknote className="h-5 w-5" /> },
  { value: "bank_transfer", label: copy.register.bankTransfer, icon: <Building2 className="h-5 w-5" /> },
  { value: "manual_card", label: copy.register.manualCard, icon: <CreditCard className="h-5 w-5" /> },
];

export default function RegisterView() {
  useDocumentTitle(copy.documentTitles.register);
  const { state } = useAuth();
  const tenantName = formatTenantName(state.status === "authenticated" ? state.tenantName : "");
  const tenantId = state.status === "authenticated" ? state.tenantId : null;
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
  const formRef = useRef<HTMLFormElement | null>(null);
  const skuInputRef = useRef<HTMLInputElement | null>(null);
  const cashTenderedRef = useRef<HTMLInputElement | null>(null);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const successPrimaryRef = useRef<HTMLButtonElement | null>(null);

  const [modifierTarget, setModifierTarget] = useState<Product | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [stockMap, setStockMap] = useState<Map<string, StockItem>>(new Map());
  // undefined = state unknown (fetch pending/failed/offline), null = no open
  // shift, Shift = open. We fail open on unknown so the register keeps working
  // offline; cash is only blocked when we KNOW there's no shift.
  const [openShift, setOpenShift] = useState<Shift | null | undefined>(undefined);
  const hasOpenShift: boolean | null =
    openShift === undefined ? null : openShift !== null;
  const [skuQuery, setSkuQuery] = useState("");
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const skuDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [skuMatches, setSkuMatches] = useState<Product[]>([]);

  const resetSale = useCallback(() => {
    setCart({});
    setPaymentMethod("cash");
    setCashTendered("");
    setReference("");
    setSplitPaymentsEnabled(false);
    setSplitPayments([createPaymentDraft("cash")]);
    setCompletedOrder(null);
  }, []);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const [allProducts, categories] = await Promise.all([
        listProducts(),
        listCategories(),
      ]);
      // Persist the full catalog so the register can open offline from a cold
      // start. Best-effort: a cache write must never block ringing a sale, and
      // its rejection must never surface (e.g. no IndexedDB in a test env).
      if (tenantId) {
        void saveCatalogCache(tenantId, allProducts, categories).catch(() => undefined);
      }
      const products = allProducts.filter((product) => product.is_active);
      setLoadState({ status: "ready", products, categories });
    } catch {
      // Offline / fetch failed. Fall back to the cached catalog so the cashier
      // can still open the register and queue sales without connectivity.
      if (tenantId) {
        const cached = await readCatalogCache(tenantId).catch(() => undefined);
        if (cached) {
          setLoadState({
            status: "ready",
            products: cached.products.filter((product) => product.is_active),
            categories: cached.categories,
            fromCache: true,
          });
          return;
        }
      }
      setLoadState({ status: "error" });
    }
  }, [tenantId]);

  // Focus the primary CTA + handle Escape on mobile success overlay.
  useEffect(() => {
    if (!completedOrder) return;
    successPrimaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resetSale();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [completedOrder, resetSale]);

  // Best-effort refresh of the open-shift state. Leaves state at `undefined`
  // (unknown) on failure so we never block cash just because the check failed.
  const refreshShift = useCallback(() => {
    getOpenShift()
      .then((shift) => setOpenShift(shift ?? null))
      .catch(() => setOpenShift(undefined));
  }, []);

  useEffect(() => {
    void load();
    void triggerSync();
    // Best-effort: stock badges are informational; register still works if this fails
    listStock()
      .then((items) => setStockMap(new Map(items.map((i) => [i.product_id, i]))))
      .catch(() => undefined);
    refreshShift();
  }, [load, refreshShift]);

  // Re-check the shift when the cashier returns to the tab: another device may
  // have opened or closed the drawer in the meantime.
  useEffect(() => {
    const onFocus = () => refreshShift();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshShift();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshShift]);

  // When we learn there's no open shift, move the single-payment selection off
  // cash so the cashier isn't stuck on a blocked method.
  useEffect(() => {
    if (hasOpenShift === false && !splitPaymentsEnabled && paymentMethod === "cash") {
      setPaymentMethod("bank_transfer");
    }
  }, [hasOpenShift, splitPaymentsEnabled, paymentMethod]);

  // Map category_id → category name for readable filter pills
  const categoryMap = useMemo<Map<string, string>>(() => {
    if (loadState.status !== "ready") return new Map();
    return new Map(loadState.categories.map((c) => [c.id, c.name]));
  }, [loadState]);

  // Unique category IDs present in the active product list
  const categoriesInUse = useMemo<string[]>(() => {
    if (loadState.status !== "ready") return [];
    const seen = new Set<string>();
    for (const p of loadState.products) {
      if (p.category_id) seen.add(p.category_id);
    }
    // Preserve the sort order from the loaded categories list
    return loadState.categories
      .filter((c) => seen.has(c.id))
      .map((c) => c.id);
  }, [loadState]);

  const filteredProducts = useMemo(() => {
    if (loadState.status !== "ready") return [];
    if (!selectedCategory) return loadState.products;
    return loadState.products.filter((p) => p.category_id === selectedCategory);
  }, [loadState, selectedCategory]);

  // SKU/barcode search: debounced, filters across ALL products (ignores category filter)
  const handleSkuChange = (value: string) => {
    setSkuQuery(value);
    if (skuDebounceRef.current) clearTimeout(skuDebounceRef.current);
    skuDebounceRef.current = setTimeout(() => {
      if (!value.trim() || loadState.status !== "ready") {
        setSkuMatches([]);
        return;
      }
      const q = value.trim().toLowerCase();
      const exactSku = loadState.products.filter(
        (p) => p.sku?.toLowerCase() === q,
      );
      if (exactSku.length === 1) {
        addProduct(exactSku[0]);
        setSkuQuery("");
        setSkuMatches([]);
        return;
      }
      const partial = loadState.products.filter(
        (p) =>
          p.sku?.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q),
      );
      setSkuMatches(partial);
    }, 150);
  };

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  // Auto-open the mobile cart sheet on the first item added; closes when cart empties.
  useEffect(() => {
    if (cartItems.length > 0) setCartSheetOpen(true);
    else setCartSheetOpen(false);
  }, [cartItems.length]);
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
  // Cash must land in an open drawer so the corte reconciles. Mirrors the
  // backend rule; this is the real enforcement for the register, which only
  // ever rings via the offline-sync path (the backend can't block there).
  const saleIncludesCash = splitPaymentsEnabled
    ? splitPayments.some(
        (payment) => payment.method === "cash" && moneyToCents(payment.amount) > 0,
      )
    : paymentMethod === "cash";
  const cashBlocked = hasOpenShift === false && saleIncludesCash;
  const canSubmitSale =
    canCreateOrders &&
    cartItems.length > 0 &&
    (splitPaymentsEnabled ? splitIsValid : cashIsValid) &&
    !cashBlocked &&
    !submitting;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (completedOrder || isEditableTarget(event.target)) return;
      if (event.key === "/" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        skuInputRef.current?.focus();
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        paymentSectionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        cashTenderedRef.current?.focus();
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "1" || event.key === "2" || event.key === "3") {
          event.preventDefault();
          setSplitPaymentsEnabled(false);
          setPaymentMethod(event.key === "1" ? "cash" : event.key === "2" ? "bank_transfer" : "manual_card");
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canSubmitSale) {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSubmitSale, completedOrder]);

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
      const removed = current[cartKey];
      if (!removed) return current;
      const next = { ...current };
      delete next[cartKey];
      toast(copy.register.itemRemoved(removed.product.name), {
        variant: "info",
        action: {
          label: copy.register.undo,
          onAction: () => {
            setCart((c) => ({ ...c, [cartKey]: removed }));
          },
        },
      });
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

    const queueItem = await queueOfflineSale(sale, openShift?.id);

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
        trackFunnelEventOnce("first_sale", "first_sale_completed", {
          order_id: result.order.id,
          total_amount: result.order.total_amount,
        });
        // Toast is retained as the accessible status announcement
        // (aria-live region) for screen readers — visual de-duplication with
        // the success card is left for a future polish pass.
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
      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
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
            <AlertCircle className="h-8 w-8 text-destructive shrink-0" />
            <div>
              <p className="font-medium">{copy.register.loadError}</p>
              <p className="text-sm text-muted-foreground">{copy.dashboard.connectionHint}</p>
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
    <main className="p-4 pb-40 sm:p-6 lg:p-8 lg:pb-8 max-w-7xl mx-auto animate-fade-in">
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

      {loadState.status === "ready" && loadState.fromCache && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-kova-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{copy.register.offlineCatalogNotice}</span>
        </div>
      )}

      {hasOpenShift === false && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground sm:text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{copy.register.noShiftWarning}</span>
          <Link to="/shifts" className="shrink-0 font-semibold text-primary hover:underline">
            {copy.register.openShift}
          </Link>
        </div>
      )}

      {/* Mobile cart sheet backdrop */}
      {cartSheetOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setCartSheetOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Product Grid */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                {copy.register.catalog}
              </CardTitle>
              <Badge variant="secondary">{copy.register.itemCount(loadState.products.length)}</Badge>
            </div>
            {/* SKU / barcode search */}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                ref={skuInputRef}
                type="text"
                value={skuQuery}
                onChange={(e) => handleSkuChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && skuMatches.length === 1) {
                    addProduct(skuMatches[0]);
                    setSkuQuery("");
                    setSkuMatches([]);
                  }
                  if (e.key === "Escape") {
                    setSkuQuery("");
                    setSkuMatches([]);
                  }
                }}
                placeholder={copy.register.skuSearchPlaceholder}
                className="w-full rounded-lg border bg-background py-2 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
              />
              {skuQuery && (
                <button
                  type="button"
                  onClick={() => { setSkuQuery(""); setSkuMatches([]); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* SKU match results */}
            {skuQuery && skuMatches.length === 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground px-1">
                {copy.register.skuNoMatch(skuQuery)}
              </p>
            )}
            {skuMatches.length > 1 && (
              <div className="mt-1.5 space-y-1 animate-fade-in">
                <p className="text-xs text-muted-foreground px-1">{copy.register.skuMultipleMatches}</p>
                {skuMatches.slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      addProduct(p);
                      setSkuQuery("");
                      setSkuMatches([]);
                      // Keep the scanner/typing flow going — return focus so
                      // the cashier can ring the next item without re-clicking.
                      skuInputRef.current?.focus();
                    }}
                    className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm hover:border-primary/40 hover:bg-muted/30 transition-colors"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-primary font-semibold">{formatMoney(p.price_amount)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Category pills — show readable names */}
            {categoriesInUse.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={cn(
                    "rounded-full px-3 py-2 text-xs font-medium transition-all",
                    !selectedCategory
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                  type="button"
                >
                  {copy.register.allCategories}
                </button>
                {categoriesInUse.map((catId) => (
                  <button
                    key={catId}
                    onClick={() => setSelectedCategory(catId)}
                    className={cn(
                      "rounded-full px-3 py-2 text-xs font-medium transition-all",
                      selectedCategory === catId
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                    type="button"
                  >
                    {categoryMap.get(catId) ?? catId}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-4">
            {/* Screen-reader announcement of the filtered result count — the
                product grid changes without a navigation, so without this a SR
                user gets no feedback when filtering by category or SKU. */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {(selectedCategory || skuQuery)
                ? copy.register.itemCount(filteredProducts.length)
                : ""}
            </div>
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <ShoppingBag className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="font-medium">{copy.register.catalogPlaceholder}</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{copy.register.catalogPlaceholderBody}</p>
                {canManageCatalog && (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Link to="/catalog?new=product" className={cn(buttonVariants({ size: "sm" }))}>
                      <Plus className="h-4 w-4" />
                      {copy.register.createFirstProduct}
                    </Link>
                    <Link to="/catalog" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      <Sparkles className="h-4 w-4" />
                      {copy.register.loadCafePreset}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {filteredProducts.map((product) => {
                  const stock = stockMap.get(product.id);
                  const isOut = stock?.track_inventory && stock.stock_on_hand === 0;
                  const isLow = stock?.is_low_stock && !isOut;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      aria-label={
                        isOut
                          ? `${product.name} — sin stock. Actualiza inventario para vender.`
                          : `${copy.register.add} ${product.name}`
                      }
                      aria-disabled={isOut ? "true" : undefined}
                      title={isOut ? "Sin stock — actualiza inventario para vender" : undefined}
                      onClick={() => {
                        if (isOut) {
                          toast(copy.register.outOfStockBlocked(product.name), "warning");
                          return;
                        }
                        addProduct(product);
                      }}
                      className={cn(
                        "group flex sm:flex-col items-stretch sm:justify-between gap-3 sm:gap-0 rounded-xl border bg-card p-3 text-left transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.97]",
                        isOut && "opacity-60 cursor-not-allowed hover:border-border hover:shadow-none active:scale-100",
                      )}
                    >
                      <div className="flex sm:block items-center gap-3 sm:gap-0 sm:space-y-2 flex-1 min-w-0">
                        <div className="aspect-square w-16 sm:w-full shrink-0 overflow-hidden rounded-lg bg-muted/50 transition-transform group-hover:scale-[1.03]">
                          {product.image_url ? (
                            <img
                              src={productImageSrc(product.image_url, 400)}
                              srcSet={productImageSrcSet(product.image_url)}
                              sizes="(max-width: 640px) 64px, (max-width: 1024px) 33vw, 200px"
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full"
                              style={productImageStyle(product)}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                              <ShoppingBag className="h-7 w-7" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div className="flex items-start justify-between gap-1 flex-1 min-w-0">
                          <p className="font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors flex-1 min-w-0">
                            {product.name}
                          </p>
                          {isOut && (
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 bg-muted text-muted-foreground">
                              {copy.inventoryView.outBadge}
                            </span>
                          )}
                          {isLow && (
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 bg-warning/15 text-warning-foreground">
                              {copy.inventoryView.lowBadge}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:justify-between sm:mt-3 shrink-0">
                        <span className="text-base font-bold text-primary tabular-nums">
                          {formatMoney(product.price_amount)}
                        </span>
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary opacity-60 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cart + Payment — bottom sheet on mobile, sidebar on desktop */}
        <div
          ref={paymentSectionRef}
          className={cn(
            // Desktop: normal sidebar column
            "lg:relative lg:bottom-auto lg:inset-x-auto lg:z-auto lg:max-h-none lg:overflow-visible lg:bg-transparent lg:border-0 lg:rounded-none lg:shadow-none lg:translate-y-0 lg:transition-none lg:flex-none lg:block",
            // Mobile: fixed bottom sheet above bottom nav
            "fixed inset-x-0 bottom-14 z-40 flex flex-col",
            "overflow-hidden",
            "bg-card border-t border-kova-border rounded-t-2xl",
            "shadow-[0_-12px_40px_-12px_rgba(15,17,23,0.25)]",
            "transition-[max-height] duration-300 ease-out",
            "scroll-mt-4",
            cartSheetOpen ? "max-h-[calc(100dvh-7rem)]" : "max-h-20",
          )}
        >
          {/* Peek handle — mobile only */}
          <button
            type="button"
            onClick={() => setCartSheetOpen((v) => !v)}
            aria-expanded={cartSheetOpen}
            aria-label={cartSheetOpen ? copy.register.collapseCart : copy.register.expandCart}
            className="lg:hidden relative flex items-center justify-between w-full h-20 px-4 border-b border-kova-border bg-card shrink-0"
          >
            <span className="absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-kova-border" aria-hidden="true" />
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart className="h-6 w-6 text-kova-ink" />
                {cartItems.length > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[20px] h-5 rounded-full bg-kova-blue text-white text-[11px] font-bold flex items-center justify-center px-1.5 tabular-nums">
                    {cartItems.reduce((s, i) => s + i.quantity, 0)}
                  </span>
                )}
              </div>
              <span className="text-sm text-kova-muted">
                {cartItems.length === 0 ? copy.register.cartPlaceholder : copy.register.cart}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tabular-nums text-kova-ink">{formatMoney(totalAmount)}</span>
              <ChevronUp className={cn("h-5 w-5 text-kova-muted transition-transform", cartSheetOpen && "rotate-180")} aria-hidden="true" />
            </div>
          </button>

          {/* Scrollable content (cart + payment) — fills sheet on mobile, normal stack on desktop */}
          <div className="flex-1 overflow-y-auto overscroll-contain lg:overflow-visible lg:flex-none">
            <div className="space-y-4 p-3 lg:p-0">
          <Card aria-label={copy.register.cart} className="lg:block">
            <CardHeader className="hidden lg:block pb-3 border-b">
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
                            {copy.register.unitPrice(formatMoney(item.effectiveUnitPrice))}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateQuantity(cartKey, item.quantity - 1)}
                            aria-label={copy.register.decreaseQuantity}
                            className="flex h-11 w-11 items-center justify-center rounded-md border border-kova-border hover:bg-kova-mist active:scale-95 transition-all"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-8 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(cartKey, item.quantity + 1)}
                            aria-label={copy.register.increaseQuantity}
                            className="flex h-11 w-11 items-center justify-center rounded-md border border-kova-border hover:bg-kova-mist active:scale-95 transition-all"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">
                            {formatMoney(centsToMoney(moneyToCents(item.effectiveUnitPrice) * item.quantity))}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeItem(cartKey)}
                            aria-label={copy.register.removeItem(item.product.name)}
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
            <form ref={formRef} onSubmit={(event) => void submitSale(event)}>
              <CardContent className="p-4 space-y-4">
                {/* Total */}
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">{copy.register.total}</span>
                  <span className="text-2xl font-bold">{formatMoney(totalAmount)}</span>
                </div>

                {!canCreateOrders && (
                  <div className="flex items-center gap-2 rounded-lg bg-warning/20 border border-warning/30 px-3 py-2 text-sm text-warning-foreground">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {copy.register.permissionHidden}
                  </div>
                )}

                {cartItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm">
                    <p className="font-medium text-foreground">{copy.register.paymentEmptyTitle}</p>
                    <p className="mt-1 text-muted-foreground">{copy.register.paymentEmptyBody}</p>
                  </div>
                ) : splitPaymentsEnabled ? (
                  <div className="space-y-3">
                    {splitPayments.map((payment, index) => (
                      <div key={payment.id} className="rounded-lg border p-3 space-y-2 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground uppercase">
                            {copy.register.paymentNumber(index + 1)}
                          </span>
                          <button
                            type="button"
                            disabled={splitPayments.length === 1}
                            onClick={() => removeSplitPayment(payment.id)}
                            className="text-xs text-destructive hover:underline disabled:opacity-40"
                          >
                            {copy.register.removePayment}
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
                          <option value="cash" disabled={hasOpenShift === false}>
                            {copy.register.cash}
                          </option>
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
                            inputMode="decimal"
                            placeholder={copy.register.amount}
                            value={payment.amount}
                            onChange={(event) =>
                              updateSplitPayment(payment.id, {
                                amount: event.target.value.replace(/^-/, ""),
                              })
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
                              inputMode="decimal"
                              placeholder={copy.register.amountTendered}
                              value={payment.amountTendered}
                              onChange={(event) =>
                                updateSplitPayment(payment.id, {
                                  amountTendered: event.target.value.replace(/^-/, ""),
                                })
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
                      {!splitTotalMatches && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {splitRemainingCents > 0 ? copy.register.remaining : copy.register.splitOver}
                          </span>
                          <span className="font-semibold text-destructive">
                            {formatMoney(centsToMoney(Math.abs(splitRemainingCents)))}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Live payment status — tells the cashier why they can or can't charge yet. */}
                    {cartItems.length > 0 &&
                      (!splitTotalMatches ? (
                        <p className="flex items-center gap-1.5 text-xs text-destructive">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          {copy.register.splitTotalMismatch}
                        </p>
                      ) : !splitCashIsValid ? (
                        <p className="flex items-center gap-1.5 text-xs text-destructive">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          {copy.register.splitCashShort}
                        </p>
                      ) : splitHasPayment ? (
                        <p className="flex items-center gap-1.5 text-xs text-kova-growth">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          {copy.register.splitBalanced}
                        </p>
                      ) : null)}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Payment method button group */}
                    <div>
                      <Label id="paymentMethodLabel" className="mb-2 block">{copy.register.paymentMethod}</Label>
                      <div
                        className="grid grid-cols-3 gap-2"
                        role="radiogroup"
                        aria-labelledby="paymentMethodLabel"
                        onKeyDown={(e) =>
                          handleRadioGroupKeyDown(
                            e,
                            paymentMethodOptions.map(({ value }) => ({
                              value,
                              disabled: value === "cash" && hasOpenShift === false,
                            })),
                            paymentMethod,
                            setPaymentMethod,
                          )
                        }
                      >
                        {paymentMethodOptions.map(({ value, label, icon }) => {
                          const isCashDisabled = value === "cash" && hasOpenShift === false;
                          return (
                            <button
                              key={value}
                              type="button"
                              role="radio"
                              data-radio-value={value}
                              tabIndex={paymentMethod === value ? 0 : -1}
                              aria-checked={paymentMethod === value}
                              aria-disabled={isCashDisabled}
                              onClick={() =>
                                isCashDisabled
                                  ? toast(copy.register.cashRequiresShift, "warning")
                                  : setPaymentMethod(value)
                              }
                              className={cn(
                                "flex min-h-[60px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-xs font-medium transition-all",
                                isCashDisabled
                                  ? "cursor-not-allowed border-kova-border bg-muted/40 text-muted-foreground/50"
                                  : paymentMethod === value
                                    ? "border-kova-blue bg-kova-blue/5 text-kova-blue shadow-sm"
                                    : "border-kova-border text-kova-muted hover:border-kova-blue/40 hover:text-kova-ink",
                              )}
                            >
                              {icon}
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {paymentMethod === "cash" && (
                      <div className="space-y-2">
                        <Label htmlFor="cashTendered">{copy.register.amountTendered}</Label>
                        <Input
                          ref={cashTenderedRef}
                          id="cashTendered"
                          min="0"
                          step="0.01"
                          type="number"
                          inputMode="decimal"
                          placeholder={copy.register.amountTendered}
                          value={cashTendered}
                          onChange={(event) =>
                            setCashTendered(event.target.value.replace(/^-/, ""))
                          }
                        />
                        {/* Quick cash: common MXN bills + exact amount, so the
                            cashier taps instead of typing the tendered amount. */}
                        <div className="flex flex-wrap gap-2">
                          {[50, 100, 200, 500].map((bill) => (
                            <button
                              key={bill}
                              type="button"
                              onClick={() => setCashTendered(String(bill))}
                              className="rounded-lg border bg-background px-3 py-1.5 text-sm font-medium tabular-nums hover:border-primary/40 hover:bg-muted/30 transition-colors"
                            >
                              {formatMoney(bill)}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setCashTendered(totalAmount)}
                            className="rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:border-primary/40 hover:bg-muted/30 transition-colors"
                          >
                            {copy.register.exactCash}
                          </button>
                        </div>
                        {(() => {
                          const shortfallCents =
                            tenderedCents > 0 && tenderedCents < totalCents
                              ? totalCents - tenderedCents
                              : 0;
                          if (shortfallCents > 0) {
                            return (
                              <div className="flex justify-between rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm">
                                <span className="text-destructive">{copy.register.cashShortfall}</span>
                                <span className="font-bold text-destructive">{formatMoney(centsToMoney(shortfallCents))}</span>
                              </div>
                            );
                          }
                          return (
                            <div className="flex justify-between rounded-lg bg-muted/50 p-3 text-sm">
                              <span className="text-muted-foreground">{copy.register.changeDue}</span>
                              <span className="font-bold text-primary">{formatMoney(centsToMoney(changeDueCents))}</span>
                            </div>
                          );
                        })()}
                        {!cashIsValid && cartItems.length > 0 && (
                          <p className="flex items-center gap-1.5 text-xs text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {copy.register.cashTooLow}
                          </p>
                        )}
                      </div>
                    )}

                    {(paymentMethod === "bank_transfer" || paymentMethod === "manual_card") && (
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

                {/* Advanced options — split payment lives behind a disclosure */}
                {cartItems.length > 0 && (
                  <details
                    className="rounded-[var(--radius-md)] border border-[color:var(--kova-border)] px-3 py-2 text-sm [&[open]>summary]:mb-2"
                    open={splitPaymentsEnabled}
                  >
                    <summary className="cursor-pointer list-none text-sm font-medium text-[color:var(--kova-muted)] hover:text-[color:var(--kova-ink)] [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-2">
                        <SplitSquareHorizontal className="h-4 w-4" />
                        {copy.register.advancedOptions}
                      </span>
                    </summary>
                    <label className="flex items-start gap-2 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={splitPaymentsEnabled}
                        onChange={(event) => toggleSplitPayments(event.target.checked)}
                        className="mt-0.5 rounded border-input text-primary focus:ring-primary"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium">{copy.register.splitPayment}</span>
                        <span className="block text-xs text-muted-foreground">{copy.register.splitPaymentHint}</span>
                      </span>
                    </label>
                  </details>
                )}

                {/* Cash is blocked without an open drawer — tell the cashier
                    why the charge button is disabled and how to unblock it. */}
                {cashBlocked && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive sm:text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">{copy.register.cashRequiresShift}</span>
                    <Link to="/shifts" className="shrink-0 font-semibold text-primary hover:underline">
                      {copy.register.openShift}
                    </Link>
                  </div>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  disabled={!canSubmitSale}
                  size="xl"
                  className="w-full"
                  variant="default"
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

          {/* Completed sale result (desktop card) */}
          {completedOrder && (
            <Card className="hidden lg:block border-success/30 bg-success/5 animate-fade-in">
              <CardContent className="p-4">
                <div className="mb-3 flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/15 text-success">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-success">{copy.register.saleComplete}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-kova-ink">
                      {formatMoney(completedOrder.total_amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">{copy.register.saleSuccessSubtitle}</p>
                  </div>
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

      {/* Mobile full-screen success state */}
      {completedOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sale-success-title"
          className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in lg:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex justify-end p-3">
            <button
              type="button"
              onClick={resetSale}
              aria-label={copy.register.close ?? "Cerrar"}
              className="flex h-11 w-11 items-center justify-center rounded-full text-kova-muted hover:bg-kova-mist transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-4">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-kova-growth/15 animate-scale-in">
              <CheckCircle2 className="h-14 w-14 text-kova-growth" strokeWidth={2.25} />
            </div>
            <div className="text-center space-y-1">
              <h2 id="sale-success-title" className="text-2xl font-bold tracking-tight text-kova-ink">
                {copy.register.saleSuccessTitle}
              </h2>
              <p className="text-sm text-kova-muted">{copy.register.saleSuccessSubtitle}</p>
              <p className="pt-3 text-4xl font-bold tabular-nums tracking-tight text-kova-ink">
                {formatMoney(completedOrder.total_amount)}
              </p>
            </div>
          </div>
          <div className="px-6 pb-6 space-y-2">
            <Button
              ref={successPrimaryRef}
              size="xl"
              className="w-full"
              onClick={resetSale}
            >
              <RotateCcw className="h-5 w-5" />
              {copy.register.newSale}
            </Button>
            <Link
              to={`/orders/${completedOrder.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}
            >
              <ExternalLink className="h-4 w-4" />
              {copy.register.openOrder}
            </Link>
          </div>
        </div>
      )}

    </main>
  );
}
