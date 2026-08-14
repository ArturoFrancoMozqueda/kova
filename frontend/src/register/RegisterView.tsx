import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CustomerOrderCheckoutRegister } from "@/customerOrders/CustomerOrderCheckoutRegister";
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
import { getReceipt } from "../orders/api";
import { ReceiptTemplate } from "../orders/ReceiptTemplate";
import { TicketPaper } from "@/components/ui/ticket";
import type { Order, Receipt } from "../orders/types";
import { claimOfflineSale, queueOfflineSale } from "../offline/queue";
import { syncOfflineSales } from "../offline/sync";
import { triggerSync } from "../offline/syncWorker";
import { readCatalogCache, saveCatalogCache } from "../offline/catalogCache";
import type { OfflineReceiptSnapshot, OfflineSaleQueueItem } from "../offline/types";
import { ModifierSelectionModal } from "./ModifierSelectionModal";
import type { SelectedModifier } from "./ModifierSelectionModal";
import { getOpenShift } from "@/shifts/api";
import type { Shift } from "@/shifts/types";
import { useToast } from "@/components/ui/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOTION_MS } from "@/lib/motion";
import { usePresenceKeys } from "@/lib/usePresence";
import { handleRadioGroupKeyDown } from "@/lib/radiogroup";
import { trapTabKey } from "@/lib/focusTrap";
import { formatTenantName } from "@/lib/formatTenantName";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ViewLayout } from "@/components/ui/view-layout";
import { RegisterPaymentMethodSelector, RegisterProductCard } from "./RegisterPresentation";
import { ViewEmpty } from "@/components/ui/view-states";
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
  X,
  ChevronUp,
  Printer,
  CloudOff,
} from "lucide-react";
import { trackFunnelEventOnce, trackSaleValidationBlocked } from "@/telemetry/funnel";
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

/** Cart identity: same product with the same modifier set is the same line. */
function cartKeyFor(productId: string, selectedModifiers: readonly SelectedModifier[]): string {
  return [productId, ...selectedModifiers.map((modifier) => modifier.optionId).sort()].join(":");
}

// Module-level so its identity is stable for usePresenceKeys.
function cartLineKey(item: CartItem): string {
  return cartKeyFor(item.product.id, item.selectedModifiers);
}

/**
 * Re-inserts an undone cart line where it used to be. A plain
 * `{ ...cart, [key]: line }` appends, so undoing a line from the middle of the
 * cart silently moved it to the bottom — invisible before, obvious now that the
 * row collapses in place and would reappear somewhere else.
 *
 * Lines added after the removal keep their own, later position.
 */
function restoreCartLine(
  cart: Record<string, CartItem>,
  keyOrderBeforeRemoval: readonly string[],
  cartKey: string,
  line: CartItem,
): Record<string, CartItem> {
  if (cart[cartKey]) return cart;
  const restored: Record<string, CartItem> = {};
  for (const key of keyOrderBeforeRemoval) {
    if (key === cartKey) {
      restored[cartKey] = line;
      continue;
    }
    const existing = cart[key];
    if (existing) restored[key] = existing;
  }
  for (const [key, value] of Object.entries(cart)) {
    if (!(key in restored)) restored[key] = value;
  }
  return restored;
}

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

function RegularRegisterView() {
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
  const [cashTenderedTouched, setCashTenderedTouched] = useState(false);
  const [cashSubmitAttempted, setCashSubmitAttempted] = useState(false);
  const [reference, setReference] = useState("");
  const [splitPaymentsEnabled, setSplitPaymentsEnabled] = useState(false);
  const [splitPayments, setSplitPayments] = useState<PaymentDraft[]>([
    createPaymentDraft("cash"),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [pendingReceipt, setPendingReceipt] = useState<{
    clientUuid: string;
    snapshot: OfflineReceiptSnapshot;
  } | null>(null);
  // The completed-sale response has no receipt number / business name / timestamp,
  // so a synced sale fetches the official receipt. A queued sale uses the local
  // immutable snapshot stored with its idempotent queue row.
  const [saleReceipt, setSaleReceipt] = useState<Receipt | null>(null);
  const activeSaleClientUuidRef = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const skuInputRef = useRef<HTMLInputElement | null>(null);
  const cashTenderedRef = useRef<HTMLInputElement | null>(null);
  const cashValidationTrackedRef = useRef(false);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const successPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const successOverlayRef = useRef<HTMLDivElement | null>(null);

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
  const saleResultVisible = completedOrder !== null || pendingReceipt !== null;
  const isPendingSync = pendingReceipt !== null;
  const displayedSaleTotal =
    completedOrder?.total_amount ?? pendingReceipt?.snapshot.total_amount ?? "0.00";

  const resetCashInteraction = useCallback(() => {
    setCashTenderedTouched(false);
    setCashSubmitAttempted(false);
    cashValidationTrackedRef.current = false;
  }, []);

  const resetSale = useCallback(() => {
    setCart({});
    setPaymentMethod("cash");
    setCashTendered("");
    resetCashInteraction();
    setReference("");
    setSplitPaymentsEnabled(false);
    setSplitPayments([createPaymentDraft("cash")]);
    setCompletedOrder(null);
    setPendingReceipt(null);
    activeSaleClientUuidRef.current = null;
  }, [resetCashInteraction]);

  const selectPaymentMethod = useCallback((next: PaymentMethod) => {
    if (next !== paymentMethod) {
      setCashTendered("");
      resetCashInteraction();
    }
    setPaymentMethod(next);
  }, [paymentMethod, resetCashInteraction]);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    // Cache-first: paint the tenant's cached catalog immediately so the
    // register is usable while the network fetch runs. The cached paint
    // deliberately omits `fromCache` — the offline notice only appears once
    // the fetch actually fails, so opening online never flashes it.
    let paintedFromCache = false;
    if (tenantId) {
      const cached = await readCatalogCache(tenantId).catch(() => undefined);
      if (cached) {
        paintedFromCache = true;
        setLoadState({
          status: "ready",
          products: cached.products.filter((product) => product.is_active),
          categories: cached.categories,
        });
      }
    }
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
      // Offline / fetch failed. Keep (or fall back to) the cached catalog so
      // the cashier can still open the register and queue sales without
      // connectivity — now the notice is warranted.
      if (paintedFromCache) {
        setLoadState((prev) =>
          prev.status === "ready" ? { ...prev, fromCache: true } : prev,
        );
        return;
      }
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
    if (!saleResultVisible) return;
    // Remember where focus was so it returns there when the overlay closes
    // (same guard as the Dialog primitive uses).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    successPrimaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resetSale();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [resetSale, saleResultVisible]);

  // Fetch the printable receipt for the completed sale so the cashier can print
  // it in one tap without leaving the register. Non-blocking: the sale is already
  // done; if the fetch fails the success card simply omits the receipt/print.
  useEffect(() => {
    if (!completedOrder) {
      setSaleReceipt(null);
      return;
    }
    let cancelled = false;
    void getReceipt(completedOrder.id)
      .then((receipt) => {
        if (!cancelled) setSaleReceipt(receipt);
      })
      .catch(() => {
        if (!cancelled) setSaleReceipt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [completedOrder]);

  // Map the fetched receipt to ReceiptTemplate props (same shape OrderDetail uses).
  // A fresh sale has no refunds/void, so those are omitted.
  const receiptProps = useMemo(() => {
    if (saleReceipt) {
      return {
        businessName: formatTenantName(saleReceipt.tenant_name),
        receiptNumber: saleReceipt.receipt_number,
        createdAt: saleReceipt.created_at,
        items: saleReceipt.items,
        subtotalAmount: saleReceipt.subtotal_amount,
        totalAmount: saleReceipt.total_amount,
        payments: saleReceipt.payments,
        totalTendered: saleReceipt.total_tendered,
        totalChange: saleReceipt.total_change,
      };
    }
    if (!pendingReceipt) return null;
    const snapshot = pendingReceipt.snapshot;
    return {
      businessName: snapshot.business_name,
      receiptNumber: copy.register.localReceiptNumber(
        pendingReceipt.clientUuid.split("-")[0].toUpperCase(),
      ),
      createdAt: snapshot.created_at,
      items: snapshot.items,
      subtotalAmount: snapshot.subtotal_amount,
      totalAmount: snapshot.total_amount,
      payments: snapshot.payments,
      totalTendered: snapshot.total_tendered,
      totalChange: snapshot.total_change,
      pendingSync: true,
    };
  }, [pendingReceipt, saleReceipt]);

  // Best-effort refresh of the open-shift state. Leaves state at `undefined`
  // (unknown) on failure so we never block cash just because the check failed.
  const refreshShift = useCallback(() => {
    getOpenShift()
      .then((shift) => setOpenShift(shift ?? null))
      .catch(() => setOpenShift(undefined));
  }, []);

  useEffect(() => {
    void load();
    if (tenantId) void triggerSync(tenantId);
    // Best-effort: stock badges are informational; register still works if this fails
    listStock()
      .then((items) => setStockMap(new Map(items.map((i) => [i.product_id, i]))))
      .catch(() => undefined);
    refreshShift();
  }, [load, refreshShift, tenantId]);

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
      selectPaymentMethod("bank_transfer");
    }
  }, [hasOpenShift, splitPaymentsEnabled, paymentMethod, selectPaymentMethod]);

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
    else {
      setCartSheetOpen(false);
      setCashTendered("");
      resetCashInteraction();
    }
  }, [cartItems.length, resetCashInteraction]);
  const totalCents = useMemo(
    () =>
      cartItems.reduce(
        (sum, item) => sum + moneyToCents(item.effectiveUnitPrice) * item.quantity,
        0,
      ),
    [cartItems],
  );
  const totalAmount = centsToMoney(totalCents);
  // Total units, not lines. Drives the two cart count badges (mobile sheet
  // header, desktop card header) and their kv-count-pop keys.
  const cartUnitCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems],
  );
  // Rows to render, including any that have already left `cart` and are still
  // animating out. Totals and the unit count deliberately stay on cartItems, so
  // the money on screen is always the real money.
  const cartRows = usePresenceKeys(cartItems, cartLineKey, MOTION_MS.modalExit);
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
  const hasCashTendered = cashTendered.trim().length > 0;
  const cashPaymentNeedsAmount =
    !splitPaymentsEnabled &&
    paymentMethod === "cash" &&
    cartItems.length > 0 &&
    !cashBlocked &&
    !cashIsValid;
  const showCashValidationError =
    cashPaymentNeedsAmount &&
    (hasCashTendered || cashTenderedTouched || cashSubmitAttempted);

  const reportCashValidationBlocked = useCallback(() => {
    if (cashValidationTrackedRef.current) return;
    cashValidationTrackedRef.current = true;
    void trackSaleValidationBlocked("cash_tendered", "insufficient_cash");
  }, []);

  const updateCashTenderedFromInteraction = (nextValue: string) => {
    const sanitized = nextValue.replace(/^-/, "");
    setCashTendered(sanitized);
    if (sanitized.trim() && moneyToCents(sanitized) < totalCents) {
      reportCashValidationBlocked();
    }
  };

  const revealCashValidationAfterAttempt = useCallback(() => {
    if (!cashPaymentNeedsAmount) return;
    setCashSubmitAttempted(true);
    reportCashValidationBlocked();
  }, [cashPaymentNeedsAmount, reportCashValidationBlocked]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (saleResultVisible || isEditableTarget(event.target)) return;
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
          selectPaymentMethod(event.key === "1" ? "cash" : event.key === "2" ? "bank_transfer" : "manual_card");
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        if (canSubmitSale) {
          event.preventDefault();
          formRef.current?.requestSubmit();
        } else if (cashPaymentNeedsAmount) {
          event.preventDefault();
          revealCashValidationAfterAttempt();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSubmitSale, cashPaymentNeedsAmount, revealCashValidationAfterAttempt, saleResultVisible, selectPaymentMethod]);

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
    const cartKey = cartKeyFor(product.id, selectedModifiers);
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
      const keyOrderBeforeRemoval = Object.keys(current);
      const next = { ...current };
      delete next[cartKey];
      toast(copy.register.itemRemoved(removed.product.name), {
        variant: "info",
        action: {
          label: copy.register.undo,
          onAction: () => {
            setCart((c) => restoreCartLine(c, keyOrderBeforeRemoval, cartKey, removed));
          },
        },
      });
      return next;
    });
  };

  const toggleSplitPayments = (enabled: boolean) => {
    setCashTendered("");
    resetCashInteraction();
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
    if (!canSubmitSale) {
      if (submitting) return;
      if (!canCreateOrders) {
        void trackSaleValidationBlocked("permission", "permission_denied");
      } else if (cartItems.length === 0) {
        void trackSaleValidationBlocked("cart", "empty_cart");
      } else if (cashBlocked) {
        void trackSaleValidationBlocked("open_shift", "cash_requires_shift");
      } else if (splitPaymentsEnabled && !splitCashIsValid) {
        void trackSaleValidationBlocked("cash_tendered", "insufficient_cash");
      } else if (splitPaymentsEnabled && !splitTotalMatches) {
        void trackSaleValidationBlocked("payment_total", "split_mismatch");
      } else if (!cashIsValid) {
        revealCashValidationAfterAttempt();
      }
      return;
    }

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

    const cashSettlement = sale.payments.reduce(
      (totals, payment) => {
        if (payment.method !== "cash") return totals;
        const amountCents = moneyToCents(payment.amount);
        const tenderedCentsForPayment = moneyToCents(
          "amount_tendered" in payment ? payment.amount_tendered : payment.amount,
        );
        return {
          tenderedCents: totals.tenderedCents + tenderedCentsForPayment,
          changeCents: totals.changeCents + Math.max(0, tenderedCentsForPayment - amountCents),
        };
      },
      { tenderedCents: 0, changeCents: 0 },
    );
    const receiptSnapshot: OfflineReceiptSnapshot = {
      business_name: tenantName,
      created_at: new Date().toISOString(),
      items: cartItems.map((item) => ({
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price_amount: item.product.price_amount,
        line_total_amount: centsToMoney(
          moneyToCents(item.effectiveUnitPrice) * item.quantity,
        ),
        modifiers: item.selectedModifiers.map((modifier) => ({
          modifier_group_name: modifier.groupName,
          modifier_option_name: modifier.optionName,
          price_delta_amount: modifier.priceDelta,
        })),
      })),
      subtotal_amount: totalAmount,
      total_amount: totalAmount,
      payments: sale.payments.map((payment) => ({
        method: payment.method,
        amount_amount: payment.amount,
      })),
      total_tendered: centsToMoney(cashSettlement.tenderedCents),
      total_change: centsToMoney(cashSettlement.changeCents),
    };

    let queueItem: OfflineSaleQueueItem;
    try {
      if (!tenantId) throw new Error("Authenticated tenant required");
      queueItem = await queueOfflineSale(tenantId, sale, openShift?.id, receiptSnapshot);
    } catch {
      toast(copy.register.saleError, "error");
      setSubmitting(false);
      return;
    }

    activeSaleClientUuidRef.current = queueItem.client_uuid;
    setCompletedOrder(null);
    setPendingReceipt({ clientUuid: queueItem.client_uuid, snapshot: receiptSnapshot });

    setCart({});
    setCashTendered("");
    resetCashInteraction();
    setReference("");
    setSplitPaymentsEnabled(false);
    setSplitPayments([createPaymentDraft("cash")]);
    setSubmitting(false);

    void claimOfflineSale(tenantId!, queueItem.client_uuid, `register:${crypto.randomUUID()}`)
      .then((claimed) => claimed ? syncOfflineSales(tenantId!, [claimed]) : [])
      .then((results) => {
        const result = results[0];
        if (!result) return;
        if (result.status === "synced" && result.order) {
          trackFunnelEventOnce("first_sale", "first_sale_completed");
          if (activeSaleClientUuidRef.current !== queueItem.client_uuid) return;
          setPendingReceipt(null);
          setCompletedOrder(result.order as Order);
          // Toast is retained as the accessible status announcement
          // (aria-live region) for screen readers — visual de-duplication with
          // the success card is left for a future polish pass.
          toast(copy.register.saleComplete, "success");
        } else if (activeSaleClientUuidRef.current === queueItem.client_uuid) {
          toast(copy.register.saleQueued, "warning");
        }
      })
      .catch(() => {
        if (activeSaleClientUuidRef.current === queueItem.client_uuid) {
          toast(copy.register.saleQueued, "warning");
        }
      });
  };

  if (loadState.status === "loading") {
    return (
      <ViewLayout width="wide">
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
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
      </ViewLayout>
    );
  }

  if (loadState.status === "error") {
    return (
      <ViewLayout width="wide">
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
      </ViewLayout>
    );
  }

  return (
    <ViewLayout width="wide" className="pb-40 lg:pb-10 animate-fade-in">
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
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm xl:hidden"
          onClick={() => setCartSheetOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Product Grid */}
        <Card className="overflow-hidden border-kova-border/90">
          <CardHeader className="border-b bg-white p-5 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                {copy.register.catalog}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{copy.register.itemCount(loadState.products.length)}</Badge>
                {canManageCatalog ? (
                  <Link
                    to="/catalog"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    {copy.register.manageCatalog}
                  </Link>
                ) : null}
              </div>
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
                className="h-11 w-full rounded-kova-md border border-kova-border bg-kova-mist/30 py-2 pl-9 pr-9 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-kova-blue focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue/20"
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
                    <span className="text-primary font-semibold tabular-nums">{formatMoney(p.price_amount)}</span>
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
                    "rounded-full px-3 py-2 text-xs font-medium transition-colors duration-quick ease-standard",
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
                      "rounded-full px-3 py-2 text-xs font-medium transition-colors duration-quick ease-standard",
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
          <CardContent className="p-4 sm:p-5">
            {/* Screen-reader announcement of the filtered result count — the
                product grid changes without a navigation, so without this a SR
                user gets no feedback when filtering by category or SKU. */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {(selectedCategory || skuQuery)
                ? copy.register.itemCount(filteredProducts.length)
                : ""}
            </div>
            {filteredProducts.length === 0 ? (
              <ViewEmpty
                bare
                icon={<ShoppingBag className="h-6 w-6" />}
                title={copy.register.catalogPlaceholder}
                body={copy.register.catalogPlaceholderBody}
                primaryCta={
                  canManageCatalog
                    ? { label: copy.register.createFirstProduct, to: "/catalog?new=product" }
                    : undefined
                }
                secondaryCta={
                  canManageCatalog
                    ? { label: copy.register.loadCafePreset, to: "/catalog" }
                    : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {filteredProducts.map((product) => {
                  const stock = stockMap.get(product.id);
                  const isOut = stock?.track_inventory && stock.available_quantity === 0;
                  const isLow = stock?.is_low_stock && !isOut;
                  return (
                    <RegisterProductCard
                      key={product.id}
                      ariaLabel={
                        isOut
                          ? `${product.name} — sin stock. Actualiza inventario para vender.`
                          : `${copy.register.add} ${product.name}`
                      }
                      disabled={isOut}
                      onDisabledSelect={() => toast(copy.register.outOfStockBlocked(product.name), "warning")}
                      name={product.name}
                      price={product.price_amount}
                      status={isOut
                        ? { label: copy.inventoryView.outBadge, tone: "muted" }
                        : isLow
                          ? { label: copy.inventoryView.lowBadge, tone: "warning" }
                          : undefined}
                      image={product.image_url ? (
                        <div className="aspect-square w-12 shrink-0 overflow-hidden rounded-lg bg-muted/50 sm:w-full">
                          <img
                            src={productImageSrc(product.image_url, 400)}
                            srcSet={productImageSrcSet(product.image_url)}
                            sizes="(max-width: 640px) 48px, (max-width: 1024px) 33vw, 200px"
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full"
                            style={productImageStyle(product)}
                          />
                        </div>
                      ) : undefined}
                      onAdd={() => addProduct(product)}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cart + Payment — bottom sheet on mobile, sidebar on desktop */}
        <div
          ref={paymentSectionRef}
          data-open={cartSheetOpen ? "true" : "false"}
          className={cn(
            // Desktop: normal sidebar column. transform-none rather than
            // translate-y-0, which would still emit a transform and make this a
            // containing block for anything absolutely positioned inside it.
            "xl:sticky xl:top-4 xl:bottom-auto xl:inset-x-auto xl:z-auto xl:h-auto xl:max-h-none xl:overflow-visible xl:bg-transparent xl:border-0 xl:rounded-none xl:shadow-none xl:transform-none xl:transition-none xl:flex-none xl:block",
            // Mobile: full-height fixed sheet, translated down to leave only the
            // 5rem handle (h-20 below) visible above the bottom nav. Timing and
            // easing live in .kv-cart-sheet, which needs the asymmetry.
            "fixed inset-x-0 bottom-14 z-40 flex h-[calc(100dvh-7rem)] flex-col",
            "overflow-hidden",
            "bg-card border-t border-kova-border rounded-t-2xl",
            "shadow-kova-hero",
            "kv-cart-sheet scroll-mt-4",
            cartSheetOpen ? "translate-y-0" : "translate-y-[calc(100%-5rem)]",
          )}
        >
          {/* Peek handle — mobile only */}
          <button
            type="button"
            onClick={() => setCartSheetOpen((v) => !v)}
            aria-expanded={cartSheetOpen}
            aria-label={cartSheetOpen ? copy.register.collapseCart : copy.register.expandCart}
            className="xl:hidden relative flex items-center justify-between w-full h-20 px-4 border-b border-kova-border bg-card shrink-0"
          >
            <span className="absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-kova-border" aria-hidden="true" />
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart className="h-6 w-6 text-kova-ink" />
                {cartUnitCount > 0 && (
                  // The mobile locus: with the sheet collapsed this badge is the
                  // only part of the cart on screen.
                  <span
                    key={cartUnitCount}
                    className="kv-count-pop absolute -top-1.5 -right-2 min-w-[20px] h-5 rounded-full bg-kova-blue text-white text-[11px] font-bold flex items-center justify-center px-1.5 tabular-nums"
                  >
                    {cartUnitCount}
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
          <div className="flex-1 overflow-y-auto overscroll-contain xl:overflow-visible xl:flex-none">
            <div className="space-y-4 p-3 xl:p-0">
          <Card aria-label={copy.register.cart} className="xl:block">
            <CardHeader className="hidden border-b pb-3 xl:block">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  {copy.register.cart}
                </CardTitle>
                {cartUnitCount > 0 && (
                  <Badge key={cartUnitCount} variant="secondary" className="kv-count-pop">
                    {cartUnitCount}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {/* Branches on cartRows, not cartItems: a row that is animating out
                  has already left `cart`, so keying the empty state off cartItems
                  would render "carrito vacío" underneath the last ghost row. */}
              {cartRows.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <ShoppingCart className="h-10 w-10 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">{copy.register.cartPlaceholder}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cartRows.map(({ key: cartKey, item, state }) => {
                    return (
                      // The grid wrapper is what collapses on removal; the inner
                      // row keeps its own look untouched.
                      <div key={cartKey} className="kv-row-collapse" data-state={state}>
                        <div className="flex items-start gap-3 rounded-lg border bg-background p-3 animate-fade-in">
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
                              className="flex h-11 w-11 items-center justify-center rounded-md border border-kova-border hover:bg-kova-mist active:scale-95 transition-[background-color,transform] duration-press ease-standard"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            {/* key restarts kv-count-pop, so the changed line is
                                the locus of the feedback on desktop. */}
                            <span
                              key={item.quantity}
                              className="kv-count-pop w-8 text-center text-sm font-semibold tabular-nums"
                            >
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(cartKey, item.quantity + 1)}
                              aria-label={copy.register.increaseQuantity}
                              className="flex h-11 w-11 items-center justify-center rounded-md border border-kova-border hover:bg-kova-mist active:scale-95 transition-[background-color,transform] duration-press ease-standard"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <p className="text-sm font-bold tabular-nums">
                              {formatMoney(centsToMoney(moneyToCents(item.effectiveUnitPrice) * item.quantity))}
                            </p>
                            <button
                              type="button"
                              onClick={() => removeItem(cartKey)}
                              aria-label={copy.register.removeItem(item.product.name)}
                              className="flex h-9 w-9 items-center justify-center rounded-md text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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
                  <span className="text-sm font-medium text-muted-foreground">{copy.register.total}</span>
                  <span className="text-3xl font-bold tabular-nums text-kova-ink">{formatMoney(totalAmount)}</span>
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
                        <span className="font-semibold tabular-nums">{formatMoney(centsToMoney(splitPaymentTotalCents))}</span>
                      </div>
                      {!splitTotalMatches && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {splitRemainingCents > 0 ? copy.register.remaining : copy.register.splitOver}
                          </span>
                          <span className="font-semibold text-destructive tabular-nums">
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
                      <RegisterPaymentMethodSelector
                        label={copy.register.paymentMethod}
                        labelledBy="paymentMethodLabel"
                        value={paymentMethod}
                        options={paymentMethodOptions.map(({ value, label, icon }) => ({
                          value,
                          label,
                          icon,
                          disabled: value === "cash" && hasOpenShift === false,
                          onDisabledSelect: () => toast(copy.register.cashRequiresShift, "warning"),
                        }))}
                        onChange={selectPaymentMethod}
                        onKeyDown={(e) =>
                          handleRadioGroupKeyDown(
                            e,
                            paymentMethodOptions.map(({ value }) => ({
                              value,
                              disabled: value === "cash" && hasOpenShift === false,
                            })),
                            paymentMethod,
                            selectPaymentMethod,
                          )
                        }
                      />
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
                          onChange={(event) => updateCashTenderedFromInteraction(event.target.value)}
                          onBlur={() => {
                            setCashTenderedTouched(true);
                            if (cashPaymentNeedsAmount) reportCashValidationBlocked();
                          }}
                          aria-invalid={showCashValidationError || undefined}
                          aria-describedby={
                            showCashValidationError
                              ? "cashTendered-error"
                              : hasCashTendered
                                ? "cashTendered-status"
                                : "cashTendered-help"
                          }
                        />
                        {/* Quick cash: common MXN bills + exact amount, so the
                            cashier taps instead of typing the tendered amount. */}
                        <div className="flex flex-wrap gap-2">
                          {[50, 100, 200, 500].map((bill) => (
                            <button
                              key={bill}
                              type="button"
                              onClick={() => updateCashTenderedFromInteraction(String(bill))}
                              className="rounded-lg border bg-background px-3 py-1.5 text-sm font-medium tabular-nums hover:border-primary/40 hover:bg-muted/30 transition-colors"
                            >
                              {formatMoney(bill)}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => updateCashTenderedFromInteraction(totalAmount)}
                            className="rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:border-primary/40 hover:bg-muted/30 transition-colors"
                          >
                            {copy.register.exactCash}
                          </button>
                        </div>
                        {(() => {
                          if (showCashValidationError) {
                            const shortfallCents = totalCents - tenderedCents;
                            return (
                              <div className="flex justify-between rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm">
                                <span className="text-destructive">{copy.register.cashShortfall}</span>
                                <span className="font-bold text-destructive tabular-nums">{formatMoney(centsToMoney(shortfallCents))}</span>
                              </div>
                            );
                          }
                          if (!hasCashTendered) {
                            return (
                              <p
                                id="cashTendered-help"
                                className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"
                              >
                                {copy.register.cashTenderedHint}
                              </p>
                            );
                          }
                          return (
                            <div id="cashTendered-status" className="flex justify-between rounded-lg bg-muted/50 p-3 text-sm">
                              <span className="text-muted-foreground">{copy.register.changeDue}</span>
                              <span className="font-bold text-primary tabular-nums">{formatMoney(centsToMoney(changeDueCents))}</span>
                            </div>
                          );
                        })()}
                        {showCashValidationError && (
                          <p id="cashTendered-error" className="flex items-center gap-1.5 text-xs text-destructive">
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
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- checkbox is nested and labelled by the visible spans; static analysis can't see the expression text */}
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

                {/* Submit — kova-growth: cobrar es la accion que lleva al
                    estado de exito, que ya usa ese mismo verde. */}
                <Button
                  type="submit"
                  disabled={!canSubmitSale && !cashPaymentNeedsAmount}
                  aria-disabled={!canSubmitSale}
                  onClick={(event) => {
                    if (canSubmitSale) return;
                    event.preventDefault();
                    revealCashValidationAfterAttempt();
                  }}
                  size="xl"
                  className={cn(
                    "w-full bg-kova-growth text-white hover:bg-kova-growth/90",
                    !canSubmitSale && cashPaymentNeedsAmount && "cursor-not-allowed opacity-50",
                  )}
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
          {saleResultVisible && (
            <Card
              className={cn(
                "hidden animate-fade-in xl:block",
                isPendingSync
                  ? "border-warning/40 bg-warning/10"
                  : "border-kova-growth/30 bg-kova-growth/5",
              )}
            >
              <CardContent className="p-4">
                <div className="mb-3 flex items-start gap-3">
                  <div
                    className={cn(
                      // Same two beats as the mobile overlay, so the moment reads
                      // the same on both.
                      "flex h-9 w-9 items-center justify-center rounded-lg kv-success-badge",
                      isPendingSync
                        ? "bg-warning/20 text-warning-foreground"
                        : "bg-kova-growth/15 text-kova-growth",
                    )}
                  >
                    {isPendingSync ? (
                      <CloudOff className="h-5 w-5" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5" />
                    )}
                  </div>
                  <div className="kv-success-headline">
                    <p
                      className={cn(
                        "font-semibold",
                        isPendingSync ? "text-warning-foreground" : "text-kova-growth",
                      )}
                    >
                      {isPendingSync
                        ? copy.register.offlineSaleSavedTitle
                        : copy.register.saleComplete}
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-kova-ink">
                      {formatMoney(displayedSaleTotal)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isPendingSync
                        ? copy.register.offlineSaleSavedSubtitle
                        : copy.register.saleSuccessSubtitle}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {receiptProps && (
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="h-3.5 w-3.5" />
                      {copy.register.printReceipt}
                    </Button>
                  )}
                  {completedOrder && (
                    <Link to={`/orders/${completedOrder.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {copy.register.openOrder}
                    </Link>
                  )}
                  <Button size="sm" onClick={resetSale}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {copy.register.newSale}
                  </Button>
                </div>
                {/* On-screen preview for desktop. A separate print-only copy below
                    stays independent from viewport-specific success layouts. */}
                {receiptProps && (
                  <TicketPaper className="mt-4">
                    <ReceiptTemplate {...receiptProps} />
                  </TicketPaper>
                )}
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
      {saleResultVisible && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keydown implements the APG modal focus trap for this dialog
        <div
          ref={successOverlayRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sale-success-title"
          className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in lg:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          // Container-scoped trap (APG modal pattern): on desktop this overlay
          // is display:none, so focus never lands inside it and the handler
          // never fires there.
          onKeyDown={(e) => {
            if (successOverlayRef.current) trapTabKey(e, successOverlayRef.current);
          }}
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
          <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 pb-4">
            <div
              className={cn(
                // scale-in (from .97) is invisible on a 96px circle; this arrives
                // from .6 with a one-shot ring. Transform on the badge is safe —
                // it is a sibling of the receipt, never an ancestor.
                "flex h-24 w-24 items-center justify-center rounded-full kv-success-badge",
                isPendingSync ? "bg-warning/20" : "bg-kova-growth/15",
              )}
            >
              {isPendingSync ? (
                <CloudOff className="h-14 w-14 text-warning-foreground" strokeWidth={2.25} />
              ) : (
                <CheckCircle2 className="h-14 w-14 text-kova-growth" strokeWidth={2.25} />
              )}
            </div>
            <div className="text-center space-y-1 kv-success-headline">
              <h2 id="sale-success-title" className="text-2xl font-bold tracking-tight text-kova-ink">
                {isPendingSync
                  ? copy.register.offlineSaleSavedTitle
                  : copy.register.saleSuccessTitle}
              </h2>
              <p className="text-sm text-kova-muted">
                {isPendingSync
                  ? copy.register.offlineSaleSavedSubtitle
                  : copy.register.saleSuccessSubtitle}
              </p>
              <p className="pt-3 text-4xl font-bold tabular-nums tracking-tight text-kova-ink">
                {formatMoney(displayedSaleTotal)}
              </p>
            </div>
            {/* On-screen receipt preview for the mobile success state. */}
            {receiptProps && (
              // kv-tkt-reveal is the opt-in for the band-by-band print-in. It
              // lives here, not on ReceiptTemplate, so the order-detail receipt
              // and the settings preview stay still.
              <TicketPaper className="w-full max-w-xs kv-tkt-reveal">
                <ReceiptTemplate {...receiptProps} />
              </TicketPaper>
            )}
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
            {receiptProps && (
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4" />
                {copy.register.printReceipt}
              </Button>
            )}
            {completedOrder && (
              <Link
                to={`/orders/${completedOrder.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}
              >
                <ExternalLink className="h-4 w-4" />
                {copy.register.openOrder}
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Keep the printable receipt outside the desktop/mobile success variants.
          The mobile dialog is `lg:hidden`, which also made its receipt disappear
          from desktop print previews. */}
      {receiptProps && (
        <div className="print-only" aria-hidden="true">
          <ReceiptTemplate {...receiptProps} className="print-receipt-root" />
        </div>
      )}

    </ViewLayout>
  );
}

export default function RegisterView() {
  const [searchParams] = useSearchParams();
  const customerOrderId = searchParams.get("customerOrderId");

  if (customerOrderId) {
    return <CustomerOrderCheckoutRegister orderId={customerOrderId} />;
  }

  return <RegularRegisterView />;
}
