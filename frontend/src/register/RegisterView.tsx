import { LotPicker } from "@/inventory/LotControls";
import { allocationValid, proposeLots, type LotAllocation } from "@/inventory/lots";
import { LotQueueError, availableLots, readLocalLots, refreshLocalLots, type CachedLotStock } from "@/offline/lotStock";
import { calculateSalePricing, cachedTaxRate, cacheTaxRate } from "./pricing";
import { getActiveBranchId } from "@/branches/activeBranch";
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
import { centsToMoney, moneyToCents } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewHeader } from "@/components/ui/view-header";
import { RegisterPaymentMethodSelector, RegisterProductCard } from "./RegisterPresentation";
import { exactSkuMatches, skuSearchMatches } from "./skuSearch";
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
import { getReceiptSettings } from "@/settings/api";
import {
  cacheReceiptPaperWidth,
  normalizeReceiptPaperWidth,
  readCachedReceiptPaperWidth,
  type ReceiptPaperWidth,
} from "@/lib/receiptPaper";

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
  const [lotCache, setLotCache] = useState<CachedLotStock | undefined>();
  const [lotSelections, setLotSelections] = useState<Record<string, LotAllocation[]>>({});
  const [lotError, setLotError] = useState("");
  const [lotRefresh, setLotRefresh] = useState(0);
  const tenantId = state.status === "authenticated" ? state.tenantId : null;
  const [paperWidthMm, setPaperWidthMm] = useState<ReceiptPaperWidth>(() =>
    tenantId ? readCachedReceiptPaperWidth(tenantId) : 80,
  );
  const canManageCatalog = usePermission(CATALOG_CREATE_PERMISSION);
  const canCreateOrders = usePermission(ORDER_CREATE_PERMISSION);
  const { toast } = useToast();

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [discount, setDiscount] = useState("0.00");
  const [taxRate, setTaxRate] = useState(() => cachedTaxRate(tenantId));
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashTendered, setCashTendered] = useState("");
  const [cashTenderedTouched, setCashTenderedTouched] = useState(false);
  const [cashSubmitAttempted, setCashSubmitAttempted] = useState(false);
  const [reference, setReference] = useState("");
  const [splitPaymentsEnabled, setSplitPaymentsEnabled] = useState(false);
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const [splitPayments, setSplitPayments] = useState<PaymentDraft[]>([
    createPaymentDraft("cash"),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // Undo actions belong to the cart that created them, never to the next sale.
  const cartGenerationRef = useRef(0);
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
  const lotBranchId = tenantId ? getActiveBranchId(tenantId, state.status === "authenticated" ? state.user.id : "") : null;
  const usesLots = loadState.status === "ready" && loadState.products.some(product => product.track_lots);
  useEffect(() => {
    let alive = true;
    setLotCache(undefined); setLotError("");
    if (!tenantId || !lotBranchId || !usesLots) return;
    const load = async () => {
      const cached = await readLocalLots(tenantId, lotBranchId);
      if (alive) setLotCache(cached);
      if (!navigator.onLine) return;
      try { const fresh = await refreshLocalLots(tenantId, lotBranchId); if (alive) setLotCache(fresh); }
      catch (err) { if (alive) setLotError(err instanceof Error ? err.message : "No pudimos actualizar los lotes."); }
    };
    void load();
    return () => { alive = false; };
  }, [tenantId, lotBranchId, usesLots, lotRefresh]);
  const [stockMap, setStockMap] = useState<Map<string, StockItem>>(new Map());
  // undefined = state unknown (fetch pending/failed/offline), null = no open
  // shift, Shift = open. Unknown blocks only cash so sales cannot be omitted
  // from drawer reconciliation; non-cash methods remain available offline.
  const [openShift, setOpenShift] = useState<Shift | null | undefined>(undefined);
  const [shiftCheckFailed, setShiftCheckFailed] = useState(false);
  const hasOpenShift: boolean | null =
    openShift === undefined ? null : openShift !== null;
  const [skuQuery, setSkuQuery] = useState("");
  const [skuSearchPending, setSkuSearchPending] = useState(false);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [isCartSheetModal, setIsCartSheetModal] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth < 1280,
  );
  const previousCartLineCountRef = useRef(0);
  const suppressNextCartAutoOpenRef = useRef(false);
  const shiftRequestRef = useRef(0);
  const stockRequestRef = useRef(0);
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

  useEffect(() => {
    if (!tenantId) {
      setPaperWidthMm(80);
      return;
    }
    setPaperWidthMm(readCachedReceiptPaperWidth(tenantId));
    setTaxRate(cachedTaxRate(tenantId));
    let cancelled = false;
    void getReceiptSettings()
      .then((settings) => {
        if (cancelled) return;
        const rate = settings.default_tax_rate ?? "0.00";
        setTaxRate(rate);
        cacheTaxRate(tenantId, rate);
        const width = normalizeReceiptPaperWidth(settings.paper_width_mm);
        setPaperWidthMm(width);
        cacheReceiptPaperWidth(tenantId, width);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsCartSheetModal(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!cartSheetOpen || !isCartSheetModal) return;
    const sheet = paymentSectionRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => sheet?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCartSheetOpen(false);
        return;
      }
      if (sheet) trapTabKey(event, sheet);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [cartSheetOpen, isCartSheetModal]);

  const resetSale = useCallback(() => {
    if (submittingRef.current) return;
    cartGenerationRef.current += 1;
    setCart({});
    setLotSelections({});
    setLotRefresh(value => value + 1);
    setDiscount("0.00");
    setCustomerId("");
    setCustomerQuery("");
    setTaxRate(cachedTaxRate(tenantId));
    setPaymentMethod("cash");
    setCashTendered("");
    resetCashInteraction();
    setReference("");
    setSplitPaymentsEnabled(false);
    setAdvancedOptionsOpen(false);
    setSplitPayments([createPaymentDraft("cash")]);
    setCompletedOrder(null);
    setPendingReceipt(null);
    activeSaleClientUuidRef.current = null;
    submittingRef.current = false;
  }, [resetCashInteraction, tenantId]);

  useEffect(() => {
    setCustomerId("");
    setCustomers([]);
    if (!tenantId || !navigator.onLine) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/v1/customers?q=${encodeURIComponent(customerQuery)}`, { signal: controller.signal })
        .then(async (response) => response.ok ? response.json() : null)
        .then((result) => { if (result) setCustomers(result.items ?? result); })
        .catch(() => undefined);
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [customerQuery, tenantId]);

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
    // The cart sheet restores its prior focus when it closes. Wait for that
    // cleanup before focusing the sale confirmation so it cannot steal focus.
    if (!saleResultVisible || (isCartSheetModal && cartSheetOpen)) return;
    // Remember where focus was so it returns there when the overlay closes
    // (same guard as the Dialog primitive uses).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (isCartSheetModal) successPrimaryRef.current?.focus();
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
  }, [cartSheetOpen, isCartSheetModal, resetSale, saleResultVisible]);

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
        discountAmount: saleReceipt.discount_amount,
        taxRate: saleReceipt.tax_rate,
        taxAmount: saleReceipt.tax_amount,
        subtotalAmount: saleReceipt.subtotal_amount,
        totalAmount: saleReceipt.total_amount,
        payments: saleReceipt.payments,
        totalTendered: saleReceipt.total_tendered,
        totalChange: saleReceipt.total_change,
        paperWidthMm: saleReceipt.paper_width_mm ?? paperWidthMm,
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
      paperWidthMm: snapshot.paper_width_mm ?? paperWidthMm,
      items: snapshot.items,
      discountAmount: snapshot.discount_amount,
      taxRate: snapshot.tax_rate,
      taxAmount: snapshot.tax_amount,
      subtotalAmount: snapshot.subtotal_amount,
      totalAmount: snapshot.total_amount,
      payments: snapshot.payments,
      totalTendered: snapshot.total_tendered,
      totalChange: snapshot.total_change,
      pendingSync: true,
    };
  }, [paperWidthMm, pendingReceipt, saleReceipt]);

  const refreshStock = useCallback(() => {
    const requestId = ++stockRequestRef.current;
    return listStock()
      .then((items) => {
        if (requestId === stockRequestRef.current) {
          setStockMap(new Map(items.map((item) => [item.product_id, item])));
        }
      })
      .catch(() => undefined);
  }, []);

  // Never let an older focus/visibility request overwrite a newer result. A
  // failed refresh preserves a previously known shift; an initial unknown state
  // blocks cash so a sale cannot silently fall outside the drawer reconciliation.
  const refreshShift = useCallback(() => {
    const requestId = ++shiftRequestRef.current;
    getOpenShift()
      .then((shift) => {
        if (requestId !== shiftRequestRef.current) return;
        setOpenShift(shift ?? null);
        setShiftCheckFailed(false);
      })
      .catch(() => {
        if (requestId === shiftRequestRef.current) setShiftCheckFailed(true);
      });
  }, []);

  useEffect(() => {
    void load();
    if (tenantId) void triggerSync(tenantId);
    void refreshStock();
    refreshShift();
  }, [load, refreshShift, refreshStock, tenantId]);

  // Re-check the shift when the cashier returns to the tab: another device may
  // have opened or closed the drawer in the meantime.
  useEffect(() => {
    const onFocus = () => {
      refreshShift();
      void refreshStock();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshShift();
        void refreshStock();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshShift, refreshStock]);

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

  const clearSkuTimer = () => {
    if (skuDebounceRef.current) clearTimeout(skuDebounceRef.current);
    skuDebounceRef.current = null;
  };

  const clearSkuSearch = () => {
    clearSkuTimer();
    setSkuQuery("");
    setSkuMatches([]);
    setSkuSearchPending(false);
  };

  const resolveSkuQuery = (value: string, addSingleMatch: boolean) => {
    if (!value.trim() || loadState.status !== "ready") {
      setSkuMatches([]);
      setSkuSearchPending(false);
      return;
    }
    const matches = skuSearchMatches(loadState.products, value);
    if (addSingleMatch && matches.length === 1) {
      suppressNextCartAutoOpenRef.current = true;
      addProduct(matches[0]);
      clearSkuSearch();
      // Keyboard-wedge scanners send the next code immediately. Keep the
      // input ready even after React commits the cart update.
      window.requestAnimationFrame(() => skuInputRef.current?.focus());
      return;
    }
    setSkuMatches(matches);
    setSkuSearchPending(false);
  };

  // SKU/barcode search: debounced for typing, immediate on scanner Enter.
  // It always searches the complete catalog, independent of category filters.
  const handleSkuChange = (value: string) => {
    setSkuQuery(value);
    clearSkuTimer();
    setSkuSearchPending(Boolean(value.trim()));
    skuDebounceRef.current = setTimeout(() => {
      skuDebounceRef.current = null;
      const exact = loadState.status === "ready" ? exactSkuMatches(loadState.products, value) : [];
      resolveSkuQuery(value, exact.length === 1);
    }, 150);
  };

  const submitSkuQuery = () => {
    clearSkuTimer();
    resolveSkuQuery(skuQuery, true);
  };

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  // Auto-open only on the transition from an empty cart to its first line.
  // Subsequent line changes respect a cashier who deliberately collapsed it.
  useEffect(() => {
    const previousCount = previousCartLineCountRef.current;
    if (previousCount === 0 && cartItems.length > 0 && !suppressNextCartAutoOpenRef.current) {
      setCartSheetOpen(true);
    }
    suppressNextCartAutoOpenRef.current = false;
    if (cartItems.length === 0) {
      setCartSheetOpen(false);
      setCashTendered("");
      resetCashInteraction();
    }
    previousCartLineCountRef.current = cartItems.length;
  }, [cartItems.length, resetCashInteraction]);
  const pricing = useMemo(() => calculateSalePricing(
    cartItems.map((item) => moneyToCents(item.effectiveUnitPrice) * item.quantity), discount, taxRate,
  ), [cartItems, discount, taxRate]);
  const totalCents = pricing.total;
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
  const cashBlocked = hasOpenShift !== true && saleIncludesCash;
  const canSubmitSale =
    canCreateOrders &&
    pricing.valid &&
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
    window.requestAnimationFrame(() => cashTenderedRef.current?.focus());
  }, [cashPaymentNeedsAmount, reportCashValidationBlocked]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (submittingRef.current || modifierTarget || saleResultVisible || isEditableTarget(event.target)) return;
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
  }, [canSubmitSale, cashPaymentNeedsAmount, modifierTarget, revealCashValidationAfterAttempt, saleResultVisible, selectPaymentMethod]);

  const quantityInCart = (productId: string, currentCart = cart) =>
    Object.values(currentCart)
      .filter((item) => item.product.id === productId)
      .reduce((sum, item) => sum + item.quantity, 0);

  const canAddProductUnit = (product: Product, currentCart = cart) => {
    const stock = stockMap.get(product.id);
    return !stock?.track_inventory || quantityInCart(product.id, currentCart) < stock.available_quantity;
  };

  const reportStockBlocked = (product: Product) => {
    toast(copy.register.outOfStockBlocked(product.name), "warning");
  };

  const addProduct = (product: Product) => {
    if (submittingRef.current) return;
    if (!canAddProductUnit(product)) {
      reportStockBlocked(product);
      return;
    }
    if ((product.modifier_groups ?? []).length > 0) {
      setModifierTarget(product);
      return;
    }
    commitAddProduct(product, []);
  };

  const commitAddProduct = (product: Product, selectedModifiers: SelectedModifier[]) => {
    if (submittingRef.current) return;
    if (!canAddProductUnit(product)) {
      reportStockBlocked(product);
      return;
    }
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
    if (submittingRef.current) return;
    const currentItem = cart[cartKey];
    if (currentItem && quantity > currentItem.quantity) {
      const stock = stockMap.get(currentItem.product.id);
      const otherLinesQuantity = quantityInCart(currentItem.product.id) - currentItem.quantity;
      if (stock?.track_inventory && otherLinesQuantity + quantity > stock.available_quantity) {
        reportStockBlocked(currentItem.product);
        return;
      }
    }
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
    if (submittingRef.current) return;
    const removed = cart[cartKey];
    if (!removed) return;
    const keyOrderBeforeRemoval = Object.keys(cart);
    const cartGeneration = cartGenerationRef.current;
    setCart((current) => {
      if (!current[cartKey]) return current;
      const next = { ...current };
      delete next[cartKey];
      return next;
    });
    toast(copy.register.itemRemoved(removed.product.name), {
      variant: "info",
      action: {
        label: copy.register.undo,
        onAction: () => {
          if (submittingRef.current || cartGenerationRef.current !== cartGeneration) return;
          setCart((current) => restoreCartLine(current, keyOrderBeforeRemoval, cartKey, removed));
        },
      },
    });
  };

  const toggleSplitPayments = (enabled: boolean) => {
    setCashTendered("");
    resetCashInteraction();
    setSplitPaymentsEnabled(enabled);
    if (enabled) setAdvancedOptionsOpen(true);
    if (enabled) {
      setSplitPayments([
        {
          ...createPaymentDraft(paymentMethod, totalAmount),
          amountTendered: paymentMethod === "cash" ? cashTendered : "",
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

  const adjustKnownStockForCart = (cartSnapshot: Record<string, CartItem>, direction: -1 | 1) => {
    const quantities = new Map<string, number>();
    for (const item of Object.values(cartSnapshot)) {
      quantities.set(item.product.id, (quantities.get(item.product.id) ?? 0) + item.quantity);
    }
    setStockMap((current) => {
      const next = new Map(current);
      for (const [productId, quantity] of quantities) {
        const stock = next.get(productId);
        if (!stock?.track_inventory) continue;
        const available = stock.available_quantity + direction * quantity;
        const onHand = stock.stock_on_hand + direction * quantity;
        next.set(productId, {
          ...stock,
          available_quantity: available,
          stock_on_hand: onHand,
          is_low_stock: stock.low_stock_threshold !== null && available <= stock.low_stock_threshold,
        });
      }
      return next;
    });
  };

  const submitSale = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
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

    const lotPools: Record<string, LotAllocation[]> = {};
    for (const item of cartItems) {
      if (!item.product.track_lots || lotPools[item.product.id]) continue;
      const quantity = quantityInCart(item.product.id);
      const rows = lotCache && lotCache.tenant_id === tenantId && lotCache.branch_id === lotBranchId ? availableLots(lotCache).filter(lot => lot.product_id === item.product.id) : [];
      const parts = lotSelections[item.product.id] ?? proposeLots(rows, quantity);
      if (!allocationValid(parts, quantity)) { toast("Carga los lotes y asigna todas las unidades antes de cobrar.", "error"); return; }
      lotPools[item.product.id] = parts.map(part => ({ ...part }));
    }
    const takeLots = (productId: string, quantity: number) => {
      const result: LotAllocation[] = [];
      const pool = lotPools[productId];
      while (quantity > 0 && pool?.length) {
        const take = Math.min(quantity, pool[0].quantity);
        result.push({ lot_id: pool[0].lot_id, quantity: take }); quantity -= take; pool[0].quantity -= take;
        if (!pool[0].quantity) pool.shift();
      }
      return result;
    };
    submittingRef.current = true;
    setSubmitting(true);
    clearSkuSearch();
    const submittedCart = cart;

    const sale = {
      discount_amount: centsToMoney(pricing.discount),
      tax_rate: taxRate || "0.00",
      ...(customerId ? { customer_id: customerId } : {}),
      items: cartItems.map((item) => ({
        product_id: item.product.id,
        ...(item.product.track_lots ? { lot_allocations: takeLots(item.product.id, item.quantity) } : {}),
        unit_price_amount: item.effectiveUnitPrice,
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
      paper_width_mm: paperWidthMm,
      items: cartItems.map((item, index) => ({
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price_amount: item.effectiveUnitPrice,
        line_total_amount: centsToMoney(pricing.allocated[index]),
        modifiers: item.selectedModifiers.map((modifier) => ({
          modifier_group_name: modifier.groupName,
          modifier_option_name: modifier.optionName,
          price_delta_amount: modifier.priceDelta,
        })),
      })),
      subtotal_amount: centsToMoney(pricing.subtotal),
      discount_amount: centsToMoney(pricing.discount),
      tax_rate: taxRate || "0.00",
      tax_amount: centsToMoney(pricing.tax),
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
      queueItem = await queueOfflineSale(tenantId, sale, openShift?.id, receiptSnapshot, getActiveBranchId(tenantId, state.status === "authenticated" ? state.user.id : ""));
    } catch (err) {
      toast(err instanceof LotQueueError ? err.message : copy.register.saleError, "error");
      setLotRefresh(value => value + 1);
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    activeSaleClientUuidRef.current = queueItem.client_uuid;
    cartGenerationRef.current += 1;
    setCompletedOrder(null);
    setPendingReceipt({ clientUuid: queueItem.client_uuid, snapshot: receiptSnapshot });
    adjustKnownStockForCart(submittedCart, -1);

    setCart({});
    setCashTendered("");
    resetCashInteraction();
    setReference("");
    setSplitPaymentsEnabled(false);
    setAdvancedOptionsOpen(false);
    setSplitPayments([createPaymentDraft("cash")]);
    submittingRef.current = false;
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
          void refreshStock();
          // Toast is retained as the accessible status announcement
          // (aria-live region) for screen readers — visual de-duplication with
          // the success card is left for a future polish pass.
          toast(copy.register.saleComplete, "success");
        } else if (result.status === "failed" && activeSaleClientUuidRef.current === queueItem.client_uuid) {
          activeSaleClientUuidRef.current = null;
          setPendingReceipt(null);
          setCompletedOrder(null);
          if (submittedCart && Object.values(submittedCart).some(item => item.product.track_lots)) {
            toast("La venta cobrada conserva sus lotes en Sincronización. Concilia el conflicto y reintenta desde ahí.", "warning");
          } else {
            setCart(submittedCart);
            adjustKnownStockForCart(submittedCart, 1);
          }
          setLotRefresh(value => value + 1);
          toast(copy.register.saleRejected, "error");
          void refreshStock();
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
      <ViewLayout width="wide" className="space-y-6" aria-busy="true">
        <ViewHeader title={copy.register.title} meta={copy.register.loading} />
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
    <ViewLayout width="wide" className="pb-40 xl:pb-10 animate-fade-in">
      <div className="mb-6">
        <ViewHeader title={copy.register.title} />
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
      {hasOpenShift === null && shiftCheckFailed && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground sm:text-sm" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{copy.register.cashShiftUnknown}</span>
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

      <fieldset
        disabled={submitting}
        aria-busy={submitting}
        className="min-w-0 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]"
      >
        {/* Product Grid */}
        <Card className="overflow-hidden border-kova-border/90">
          <CardHeader className="border-b bg-white p-5 pb-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
                <ShoppingBag className="h-4 w-4" />
                {copy.register.catalog}
              </h2>
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
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitSkuQuery();
                  }
                  if (e.key === "Escape") {
                    clearSkuSearch();
                  }
                }}
                placeholder={copy.register.skuSearchPlaceholder}
                className="h-11 w-full rounded-kova-md border border-kova-border bg-kova-mist/30 py-2 pl-9 pr-9 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-kova-blue focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue/20"
              />
              {skuQuery && (
                <button
                  type="button"
                  onClick={clearSkuSearch}
                  aria-label={copy.register.clearSkuSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* SKU match results */}
            {skuQuery && !skuSearchPending && skuMatches.length === 0 && (
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
                      clearSkuSearch();
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
                  const isOut = stock?.track_inventory && stock.available_quantity <= quantityInCart(product.id);
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
          role={isCartSheetModal && cartSheetOpen ? "dialog" : undefined}
          aria-modal={isCartSheetModal && cartSheetOpen ? "true" : undefined}
          aria-label={isCartSheetModal && cartSheetOpen ? copy.register.cartSheetTitle : undefined}
          tabIndex={isCartSheetModal && cartSheetOpen ? -1 : undefined}
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
                <h2 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
                  <ShoppingCart className="h-4 w-4" />
                  {copy.register.cart}
                </h2>
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
              {[...new Map(cartItems.filter(item => item.product.track_lots).map(item => [item.product.id, item.product])).values()].map(product => {
                const quantity = quantityInCart(product.id);
                const rows = lotCache && lotCache.tenant_id === tenantId && lotCache.branch_id === lotBranchId ? availableLots(lotCache).filter(lot => lot.product_id === product.id) : [];
                return <div key={product.id} className="mt-3"><p className="text-sm font-semibold">{product.name} · lotes</p>
                  {lotError && <p role="alert" className="text-sm text-destructive">{lotError}</p>}
                  {!lotCache && <p className="text-sm">Conéctate para cargar los lotes de esta sucursal.</p>}
                  {lotCache && <p className="text-xs text-muted-foreground">Existencias guardadas: {new Date(lotCache.snapshot.captured_at).toLocaleString("es-MX")}.</p>}
                  <LotPicker rows={rows} quantity={quantity} value={lotSelections[product.id] ?? proposeLots(rows, quantity)} onChange={parts => setLotSelections(previous => ({ ...previous, [product.id]: parts }))} />
                  <Button type="button" variant="outline" onClick={() => setLotRefresh(value => value + 1)}>Actualizar lotes</Button>
                </div>;
              })}
            </CardContent>
          </Card>

          {/* Payment section */}
          <Card>
            <form ref={formRef} onSubmit={(event) => void submitSale(event)}>
              <CardContent className="p-4 space-y-4">
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Cliente, descuento e impuesto</summary>
                  <div className="mt-3 space-y-3">
                    <Label htmlFor="sale-customer-query">Buscar cliente</Label>
                    <Input id="sale-customer-query" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Nombre, teléfono o correo" />
                    <Label htmlFor="sale-customer">Cliente de la venta</Label>
                    <Select id="sale-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                      <option value="">Público general</option>
                      {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                    </Select>
                    <Label htmlFor="sale-discount">Descuento de la venta (MXN)</Label>
                    <Input id="sale-discount" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />
                    <Label htmlFor="sale-tax">Impuesto adicional al precio (%)</Label>
                    <Input id="sale-tax" inputMode="decimal" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} />
                    <p className="text-xs text-muted-foreground">Se calcula después del descuento. Si tus precios ya incluyen impuestos, usa 0%. Esta configuración no emite una factura.</p>
                    {!pricing.valid && <p role="alert" className="text-sm text-destructive">El descuento debe estar entre 0 y el subtotal; el impuesto entre 0 y 100%, con hasta dos decimales.</p>}
                  </div>
                </details>
                {(pricing.discount > 0 || pricing.tax > 0) && <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(centsToMoney(pricing.subtotal))}</span></div>
                  <div className="flex justify-between"><span>Descuento</span><span>−{formatMoney(centsToMoney(pricing.discount))}</span></div>
                  <div className="flex justify-between"><span>Impuesto adicional ({taxRate}%)</span><span>{formatMoney(centsToMoney(pricing.tax))}</span></div>
                </div>}
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
                          <option value="cash" disabled={hasOpenShift !== true}>
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
                          disabled: value === "cash" && hasOpenShift !== true,
                          onDisabledSelect: () => toast(
                            hasOpenShift === false ? copy.register.cashRequiresShift : copy.register.cashShiftUnknown,
                            "warning",
                          ),
                        }))}
                        onChange={selectPaymentMethod}
                        onKeyDown={(e) =>
                          handleRadioGroupKeyDown(
                            e,
                            paymentMethodOptions.map(({ value }) => ({
                              value,
                              disabled: value === "cash" && hasOpenShift !== true,
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
                          aria-errormessage={showCashValidationError ? "cashTendered-error" : undefined}
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
                              className="min-h-11 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium tabular-nums hover:border-primary/40 hover:bg-muted/30 transition-colors"
                            >
                              {formatMoney(bill)}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => updateCashTenderedFromInteraction(totalAmount)}
                            className="min-h-11 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:border-primary/40 hover:bg-muted/30 transition-colors"
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
                          <p id="cashTendered-error" role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
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
                    open={splitPaymentsEnabled || advancedOptionsOpen}
                    onToggle={(event) => {
                      if (!splitPaymentsEnabled) setAdvancedOptionsOpen(event.currentTarget.open);
                    }}
                  >
                    <summary
                      onClick={(event) => {
                        if (splitPaymentsEnabled) event.preventDefault();
                      }}
                      className="cursor-pointer list-none text-sm font-medium text-[color:var(--kova-muted)] hover:text-[color:var(--kova-ink)] [&::-webkit-details-marker]:hidden"
                    >
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
                    <span className="min-w-0 flex-1">
                      {hasOpenShift === false ? copy.register.cashRequiresShift : copy.register.cashShiftUnknown}
                    </span>
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
      </fieldset>

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
          className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in xl:hidden"
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
          The mobile dialog is `xl:hidden`, which also made its receipt disappear
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
