import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  CATALOG_CREATE_PERMISSION,
  CATALOG_DELETE_PERMISSION,
  CATALOG_UPDATE_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney, formatMoneyDelta } from "../orders/format";
import { applyPreset } from "../onboarding/api";
import type { PresetName } from "../onboarding/api";
import {
  createCategory,
  createModifierGroup,
  createModifierOption,
  createProduct,
  deactivateCategory,
  deactivateModifierGroup,
  deactivateModifierOption,
  deactivateProduct,
  deleteProductImage,
  listCategories,
  listModifierGroups,
  listProducts,
  setProductModifierGroups,
  updateCategory,
  updateProduct,
  uploadProductImage,
  ApiError,
} from "./api";
import type { Category, ModifierGroup, Product } from "./types";
import { ProductStoryCard } from "./ProductStoryCard";
import { compressImage } from "./compressImage";
import { productImageSrc, productImageSrcSet } from "./imageUrl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  Plus,
  Pencil,
  Trash2,
  Package,
  FolderOpen,
  Layers,
  ChevronDown,
  ChevronUp,
  Tag,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Loader2,
  BarChart2,
  Search,
  ImagePlus,
  X as XIcon,
} from "lucide-react";
import { trackFunnelEventOnce } from "@/telemetry/funnel";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: Category[]; products: Product[]; modifierGroups: ModifierGroup[] };

type Modal =
  | null
  | { type: "category-create" }
  | { type: "category-edit"; category: Category }
  | { type: "product-create"; defaultTrackInventory?: boolean }
  | { type: "product-edit"; product: Product };

type ProductSort = "name_asc" | "price_desc" | "price_asc" | "stock_first";

export default function CatalogView() {
  useDocumentTitle(copy.documentTitles.catalog);
  const canCreate = usePermission(CATALOG_CREATE_PERMISSION);
  const canUpdate = usePermission(CATALOG_UPDATE_PERMISSION);
  const canDelete = usePermission(CATALOG_DELETE_PERMISSION);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [searchParams] = useSearchParams();
  const handledSetupParam = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const [showModifiers, setShowModifiers] = useState(false);
  const [presetApplying, setPresetApplying] = useState(false);
  const [storyProduct, setStoryProduct] = useState<Product | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productSort, setProductSort] = useState<ProductSort>("name_asc");

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const [categories, products, modifierGroups] = await Promise.all([
        listCategories(), listProducts(), listModifierGroups(),
      ]);
      setLoadState({ status: "ready", categories, products, modifierGroups });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canCreate || loadState.status !== "ready" || modal) return;
    const setupParam = searchParams.get("new") === "product"
      ? "new=product"
      : searchParams.get("inventory") === "activate"
        ? "inventory=activate"
        : null;
    if (!setupParam || handledSetupParam.current === setupParam) return;
    handledSetupParam.current = setupParam;
    setModal({
      type: "product-create",
      defaultTrackInventory: setupParam === "inventory=activate",
    });
  }, [canCreate, loadState.status, modal, searchParams]);

  const showNotice = (msg: string, variant: "success" | "error" = "success") => {
    toast(msg, variant);
  };

  const showCatalogError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 402) {
      toast(copy.catalog.billingRequired, {
        variant: "error",
        durationMs: 8000,
        action: {
          label: copy.catalog.billingRequiredCta,
          onAction: () => navigate("/settings/billing"),
        },
      });
      return;
    }
    showNotice(copy.catalog.operationError, "error");
  };

  const handleApplyPreset = async (preset: PresetName) => {
    setPresetApplying(true);
    try {
      const result = await applyPreset(preset);
      if (result.skipped) {
        showNotice(copy.onboarding.presetSkipped);
      } else {
        showNotice(copy.onboarding.presetApplied(result.products_created));
        await load();
      }
    } catch (error) {
      showCatalogError(error);
    } finally {
      setPresetApplying(false);
    }
  };

  const visibleProducts = useMemo(() => {
    if (loadState.status !== "ready") return [];
    const query = productSearch.trim().toLowerCase();
    const filtered = loadState.products.filter((product) => {
      const matchesCategory = selectedCategoryId ? product.category_id === selectedCategoryId : true;
      const matchesSearch = query
        ? [product.name, product.sku ?? "", product.description ?? ""]
            .some((value) => value.toLowerCase().includes(query))
        : true;
      return matchesCategory && matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      if (productSort === "price_desc") return Number(b.price_amount) - Number(a.price_amount);
      if (productSort === "price_asc") return Number(a.price_amount) - Number(b.price_amount);
      if (productSort === "stock_first") {
        if (a.track_inventory !== b.track_inventory) return a.track_inventory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "es-MX");
    });
  }, [loadState, productSearch, productSort, selectedCategoryId]);

  /* ---- Loading state ---- */
  if (loadState.status === "loading") {
    return (
      <main className="flex-1 p-6 space-y-6" aria-busy="true">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <Card>
            <CardContent className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  /* ---- Error state ---- */
  if (loadState.status === "error") {
    return (
      <main className="flex-1 p-6">
        <Card className="max-w-md mx-auto">
          <CardContent className="p-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <p className="text-sm text-muted-foreground" role="alert">{copy.catalog.loadError}</p>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {copy.catalog.retry}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { categories } = loadState;
  const activeProducts = loadState.products.filter((product) => product.is_active);
  const trackedProducts = activeProducts.filter((product) => product.track_inventory);
  const setupNext = activeProducts.length === 0
    ? copy.catalog.setupNextProducts
    : trackedProducts.length === 0
      ? copy.catalog.setupNextInventory
      : copy.catalog.setupNextDone;

  return (
    <main className="flex-1 p-6 space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{copy.catalog.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.catalog.setupIntro}</p>
          </div>
        </div>
      </div>

      {/* Preset banner — shown only when catalog is empty and user can create */}
      {activeProducts.length === 0 && canCreate && (
        <div className="rounded-xl border border-primary/20 bg-primary/3 p-5 animate-fade-in">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">{copy.onboarding.presetTitle}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{copy.onboarding.presetSubtitle}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              { preset: "cafe" as PresetName, label: copy.onboarding.presetCafe, desc: copy.onboarding.presetCafeDesc },
              { preset: "bakery" as PresetName, label: copy.onboarding.presetBakery, desc: copy.onboarding.presetBakeryDesc },
              { preset: "retail" as PresetName, label: copy.onboarding.presetRetail, desc: copy.onboarding.presetRetailDesc },
            ] as const).map(({ preset, label, desc }) => (
              <button
                key={preset}
                type="button"
                disabled={presetApplying}
                onClick={() => void handleApplyPreset(preset)}
                className="flex flex-col rounded-xl border-2 border-border bg-background p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm disabled:opacity-60"
              >
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </button>
            ))}
            {/* Blank / dismiss */}
            <div className="flex flex-col rounded-xl border-2 border-dashed border-border bg-background p-4 text-left">
              <p className="font-semibold text-sm text-muted-foreground">{copy.onboarding.presetBlank}</p>
              <p className="text-xs text-muted-foreground mt-1">{copy.onboarding.presetBlankDesc}</p>
            </div>
          </div>
          {presetApplying && (
            <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.onboarding.presetApplying}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {[
          copy.catalog.activeProducts(activeProducts.length),
          copy.catalog.activeCategories(categories.length),
          copy.catalog.inventoryTracked(trackedProducts.length),
          setupNext,
        ].map((item, index) => (
          <div key={item} className="rounded-lg border bg-card p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {index === 3 ? copy.catalog.setupNext : copy.catalog.title}
            </p>
            <p className="mt-2 text-sm font-semibold leading-6">{item}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* ---- Categories sidebar ---- */}
        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              {copy.catalog.categories}
            </CardTitle>
            {canCreate && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={copy.catalog.newCategory}
                onClick={() => setModal({ type: "category-create" })}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-1">
            {/* All products filter */}
            <button
              type="button"
              role="option"
              aria-selected={selectedCategoryId === null}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left",
                selectedCategoryId === null
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => setSelectedCategoryId(null)}
            >
              <Layers className="h-4 w-4" />
              {copy.catalog.allProducts}
            </button>

            {categories.map((cat) => (
              <div
                key={cat.id}
                className={cn(
                  "group flex items-center rounded-md transition-colors",
                  selectedCategoryId === cat.id
                    ? "bg-primary/10"
                    : "hover:bg-accent",
                )}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedCategoryId === cat.id}
                  className={cn(
                    "flex-1 text-left px-3 py-2 text-sm font-medium transition-colors truncate",
                    selectedCategoryId === cat.id
                      ? "text-primary"
                      : "text-muted-foreground hover:text-accent-foreground",
                  )}
                  onClick={() => setSelectedCategoryId(cat.id)}
                >
                  {cat.name}
                </button>
                <div className="flex items-center gap-0.5 pr-1 opacity-100 lg:opacity-60 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 lg:h-8 lg:w-8"
                      aria-label={`Editar ${cat.name}`}
                      onClick={() => setModal({ type: "category-edit", category: cat })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 lg:h-8 lg:w-8 text-destructive hover:text-destructive"
                      aria-label={`Desactivar ${cat.name}`}
                      onClick={async () => {
                        setPending(true);
                        try {
                          await deactivateCategory(cat.id);
                          showNotice(copy.catalog.categoryDeactivated);
                          if (selectedCategoryId === cat.id) setSelectedCategoryId(null);
                          await load();
                        } catch (error) {
                          showCatalogError(error);
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {categories.length === 0 && !modal && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                {copy.catalog.emptyCategories}
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---- Products grid ---- */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="h-4 w-4 text-muted-foreground" />
              {copy.catalog.products}
            </CardTitle>
            {canCreate && (
              <Button
                size="sm"
                onClick={() => setModal({ type: "product-create" })}
              >
                <Plus className="h-4 w-4" />
                {copy.catalog.newProduct}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Label className="sr-only" htmlFor="catalog-product-search">
                  {copy.catalog.searchProducts}
                </Label>
                <Input
                  id="catalog-product-search"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder={copy.catalog.searchProductsPlaceholder}
                  className="pl-9"
                />
              </div>
              <div>
                <Label className="sr-only" htmlFor="catalog-product-sort">
                  {copy.catalog.sortProducts}
                </Label>
                <Select
                  id="catalog-product-sort"
                  value={productSort}
                  onChange={(event) => setProductSort(event.target.value as ProductSort)}
                  aria-label={copy.catalog.sortProducts}
                >
                  <option value="name_asc">{copy.catalog.sortNameAsc}</option>
                  <option value="price_desc">{copy.catalog.sortPriceDesc}</option>
                  <option value="price_asc">{copy.catalog.sortPriceAsc}</option>
                  <option value="stock_first">{copy.catalog.sortInventoryFirst}</option>
                </Select>
              </div>
            </div>
            {visibleProducts.length === 0 && !modal ? (
              <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-lg border border-[color:var(--kova-border)] bg-[color:var(--kova-mist)]/40 px-6 py-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-[color:var(--kova-blue)]">
                  <Package className="h-6 w-6" />
                </div>
                <p className="text-base font-semibold">{copy.catalog.emptyProductsTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{copy.catalog.emptyProductsBody}</p>
                {canCreate ? (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button size="sm" onClick={() => setModal({ type: "product-create" })}>
                      <Plus className="h-4 w-4" />
                      {copy.catalog.newProduct}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={presetApplying}
                      onClick={() => void handleApplyPreset("cafe")}
                    >
                      <Sparkles className="h-4 w-4" />
                      {copy.catalog.emptyProductsPreset}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleProducts.map((product) => (
                  <div
                    key={product.id}
                    className={cn(
                      "group relative rounded-lg border bg-card p-4 transition-all hover:shadow-md",
                      canUpdate && "cursor-pointer",
                    )}
                    onClick={canUpdate ? () => setModal({ type: "product-edit", product }) : undefined}
                  >
                    <div className="mb-3 flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-[color:var(--kova-mist)]">
                      {product.image_url ? (
                        <img
                          src={productImageSrc(product.image_url, 400)}
                          srcSet={productImageSrcSet(product.image_url)}
                          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
                          alt={copy.catalog.productImageAlt(product.name)}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <Package className="h-8 w-8 text-muted-foreground/60" />
                      )}
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm truncate">{product.name}</h3>
                        {product.sku && (
                          <p className="text-xs text-muted-foreground mt-0.5">{product.sku}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-100 lg:opacity-60 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 lg:h-8 lg:w-8"
                          aria-label={copy.productStory.storyButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStoryProduct(product);
                          }}
                        >
                          <BarChart2 className="h-4 w-4" />
                        </Button>
                        {canUpdate && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 lg:h-8 lg:w-8"
                            aria-label={`Editar ${product.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setModal({ type: "product-edit", product });
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3">
                      <span className="text-lg font-bold text-primary">
                        {formatMoney(product.price_amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- Modifier Groups section ---- */}
      {canCreate && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-muted-foreground" />
              {copy.catalog.modifiers}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowModifiers((v) => !v)}
            >
              {showModifiers ? (
                <><ChevronUp className="h-4 w-4 mr-1" />{copy.catalog.cancel}</>
              ) : (
                <><ChevronDown className="h-4 w-4 mr-1" />{copy.catalog.modifiers}</>
              )}
            </Button>
          </CardHeader>
          {showModifiers && loadState.status === "ready" && (
            <CardContent>
              <ModifierGroupsPanel
                groups={loadState.modifierGroups}
                canEdit={canCreate}
                canDelete={canDelete}
                onReload={load}
                onNotice={(msg) => showNotice(msg)}
                onError={(error) => showCatalogError(error)}
              />
            </CardContent>
          )}
        </Card>
      )}

      {/* ---- Category Dialog ---- */}
      <Dialog
        open={modal?.type === "category-create" || modal?.type === "category-edit"}
        onClose={() => setModal(null)}
      >
        <DialogHeader>
          <DialogTitle>
            {modal?.type === "category-edit" ? copy.catalog.editCategory : copy.catalog.newCategory}
          </DialogTitle>
          <DialogDescription>
            {modal?.type === "category-edit"
              ? copy.catalog.categoryEditDescription
              : copy.catalog.categoryCreateDescription}
          </DialogDescription>
        </DialogHeader>
        {(modal?.type === "category-create" || modal?.type === "category-edit") && (
          <CategoryForm
            initial={modal.type === "category-edit" ? modal.category : undefined}
            pending={pending}
            onCancel={() => setModal(null)}
            onSubmit={async (values) => {
              setPending(true);
              try {
                if (modal.type === "category-create") {
                  await createCategory(values);
                  showNotice(copy.catalog.categoryCreated);
                } else {
                  await updateCategory(modal.category.id, values);
                  showNotice(copy.catalog.categoryUpdated);
                }
                setModal(null);
                await load();
              } catch (error) {
                showCatalogError(error);
              } finally {
                setPending(false);
              }
            }}
          />
        )}
      </Dialog>

      {/* ---- Product Story Dialog ---- */}
      {storyProduct && (
        <ProductStoryCard
          product={storyProduct}
          open
          onClose={() => setStoryProduct(null)}
        />
      )}

      {/* ---- Product Dialog ---- */}
      <Dialog
        open={modal?.type === "product-create" || modal?.type === "product-edit"}
        onClose={() => setModal(null)}
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {modal?.type === "product-edit" ? copy.catalog.editProduct : copy.catalog.newProduct}
          </DialogTitle>
          <DialogDescription>
            {modal?.type === "product-edit"
              ? copy.catalog.productEditDescription
              : copy.catalog.productCreateDescription}
          </DialogDescription>
        </DialogHeader>
        {(modal?.type === "product-create" || modal?.type === "product-edit") && (
          <ProductForm
            initial={modal.type === "product-edit" ? modal.product : undefined}
            defaultTrackInventory={modal.type === "product-create" ? modal.defaultTrackInventory : undefined}
            categories={categories}
            availableModifierGroups={loadState.status === "ready" ? loadState.modifierGroups : []}
            defaultCategoryId={selectedCategoryId}
            pending={pending}
            onCancel={() => setModal(null)}
            onSubmit={async (values) => {
              setPending(true);
              try {
                let productId: string;
                if (modal.type === "product-create") {
                  const product = await createProduct(values);
                  productId = product.id;
                  await setProductModifierGroups(product.id, values.modifier_group_ids);
                  trackFunnelEventOnce("first_product", "first_product_created", {
                    product_id: product.id,
                  });
                  showNotice(copy.catalog.productCreated);
                } else {
                  await updateProduct(modal.product.id, values);
                  productId = modal.product.id;
                  await setProductModifierGroups(modal.product.id, values.modifier_group_ids);
                  showNotice(copy.catalog.productUpdated);
                }
                if (values.image_remove && modal.type === "product-edit") {
                  try {
                    await deleteProductImage(productId);
                  } catch {
                    showNotice(copy.catalog.productImageUploadError, "error");
                  }
                }
                if (values.image_file) {
                  try {
                    await uploadProductImage(productId, values.image_file);
                  } catch {
                    showNotice(copy.catalog.productImageUploadError, "error");
                  }
                }
                setModal(null);
                await load();
              } catch (error) {
                showCatalogError(error);
              } finally {
                setPending(false);
              }
            }}
            onDeactivate={
              canDelete && modal.type === "product-edit"
                ? async () => {
                    setPending(true);
                    try {
                      await deactivateProduct(modal.product.id);
                      showNotice(copy.catalog.productDeactivated);
                      setModal(null);
                      await load();
                    } catch (error) {
                      showCatalogError(error);
                    } finally {
                      setPending(false);
                    }
                  }
                : undefined
            }
          />
        )}
      </Dialog>
    </main>
  );
}

/* ======================================================================
   ModifierGroupsPanel
   ====================================================================== */

function ModifierGroupsPanel({
  groups,
  canEdit,
  canDelete,
  onReload,
  onNotice,
  onError,
}: {
  groups: ModifierGroup[];
  canEdit: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotice: (msg: string) => void;
  onError: (error: unknown) => void;
}) {
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newOptions, setNewOptions] = useState<Record<string, { name: string; delta: string }>>({});

  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setAddingGroup(true);
    try {
      await createModifierGroup({ name: newGroupName.trim(), is_required: newGroupRequired, min_selections: newGroupRequired ? 1 : 0 });
      onNotice(copy.catalog.modifierGroupCreated);
      setNewGroupName("");
      setNewGroupRequired(false);
      await onReload();
    } catch (error) {
      onError(error);
    } finally {
      setAddingGroup(false);
    }
  };

  const handleAddOption = async (groupId: string) => {
    const o = newOptions[groupId];
    if (!o?.name.trim()) return;
    try {
      await createModifierOption(groupId, { name: o.name.trim(), price_delta: o.delta || "0" });
      onNotice(copy.catalog.optionAdded);
      setNewOptions((prev) => ({ ...prev, [groupId]: { name: "", delta: "" } }));
      await onReload();
    } catch (error) {
      onError(error);
    }
  };

  return (
    <div className="space-y-4">
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {copy.catalog.noModifierGroups}
        </p>
      )}

      {groups.map((group) => (
        <div key={group.id} className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{group.name}</span>
              {group.is_required && (
                <Badge variant="warning">{copy.catalog.required}</Badge>
              )}
            </div>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={async () => {
                  try {
                    await deactivateModifierGroup(group.id);
                    onNotice(copy.catalog.modifierGroupDeactivated);
                    await onReload();
                  } catch (error) {
                    onError(error);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Options list */}
          <div className="space-y-1.5">
            {group.options.map((opt) => (
              <div
                key={opt.id}
                className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted/50 group/opt"
              >
                <span className="flex-1">{opt.name}</span>
                {parseFloat(opt.price_delta) > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {formatMoneyDelta(opt.price_delta)}
                  </span>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 lg:h-7 lg:w-7 opacity-100 lg:opacity-60 lg:group-hover/opt:opacity-100 lg:focus-within:opacity-100 transition-opacity text-destructive hover:text-destructive"
                    onClick={async () => {
                      try {
                        await deactivateModifierOption(group.id, opt.id);
                        onNotice(copy.catalog.optionDeactivated);
                        await onReload();
                      } catch (error) {
                        onError(error);
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Add option inline */}
          {canEdit && (
            <div className="flex items-center gap-2 pt-1">
              <Input
                type="text"
                placeholder={copy.catalog.optionName}
                value={newOptions[group.id]?.name ?? ""}
                onChange={(e) =>
                  setNewOptions((prev) => ({
                    ...prev,
                    [group.id]: { ...prev[group.id], name: e.target.value, delta: prev[group.id]?.delta ?? "" },
                  }))
                }
                className="flex-1"
              />
              <Input
                type="number"
                inputMode="decimal"
                placeholder={copy.catalog.priceDelta}
                step="0.01"
                min="0"
                value={newOptions[group.id]?.delta ?? ""}
                onChange={(e) =>
                  setNewOptions((prev) => ({
                    ...prev,
                    [group.id]: { ...prev[group.id], delta: e.target.value, name: prev[group.id]?.name ?? "" },
                  }))
                }
                className="w-28"
              />
              <Button variant="outline" size="sm" onClick={() => void handleAddOption(group.id)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {copy.catalog.newOption}
              </Button>
            </div>
          )}
        </div>
      ))}

      {/* Create new modifier group form */}
      {canEdit && (
        <form onSubmit={(e) => void handleCreateGroup(e)} className="flex items-center gap-3 pt-2">
          <Input
            type="text"
            placeholder={copy.catalog.modifierGroupName}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="flex-1"
          />
          <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
            <input
              type="checkbox"
              checked={newGroupRequired}
              onChange={(e) => setNewGroupRequired(e.target.checked)}
              className="rounded border-input"
            />
            {copy.catalog.required}
          </label>
          <Button type="submit" size="sm" disabled={addingGroup || !newGroupName.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            {copy.catalog.newModifierGroup}
          </Button>
        </form>
      )}
    </div>
  );
}

/* ======================================================================
   CategoryForm (renders inside Dialog)
   ====================================================================== */

type CategoryFormValues = {
  name: string;
  description: string | null;
  sort_order: number;
};

function CategoryForm({
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  initial?: Category;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      sort_order: Number(sortOrder),
    });
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Formulario de categoría" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cat-name">{copy.catalog.categoryName}</Label>
        <Input
          id="cat-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cat-desc">{copy.catalog.categoryDescription}</Label>
        <Input
          id="cat-desc"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cat-sort">{copy.catalog.sortOrder}</Label>
        <Input
          id="cat-sort"
          type="number"
          inputMode="numeric"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          min={0}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {copy.catalog.cancel}
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {copy.catalog.saveCategory}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ======================================================================
   ProductForm (renders inside Dialog)
   ====================================================================== */

type ProductFormValues = {
  name: string;
  description: string | null;
  sku: string | null;
  price_amount: string;
  category_id: string | null;
  track_inventory: boolean;
  low_stock_threshold: number | null;
  modifier_group_ids: string[];
  image_file: File | null;
  image_remove: boolean;
};

const PRODUCT_IMAGE_ALLOWED = ["image/png", "image/jpeg", "image/webp"];

function ProductForm({
  initial,
  defaultTrackInventory = false,
  categories,
  availableModifierGroups,
  defaultCategoryId,
  pending,
  onCancel,
  onSubmit,
  onDeactivate,
}: {
  initial?: Product;
  defaultTrackInventory?: boolean;
  categories: Category[];
  availableModifierGroups: ModifierGroup[];
  defaultCategoryId: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  onDeactivate?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [price, setPrice] = useState(initial?.price_amount ?? "");
  const [categoryId, setCategoryId] = useState(
    initial?.category_id ?? defaultCategoryId ?? "",
  );
  const [trackInventory, setTrackInventory] = useState(initial?.track_inventory ?? defaultTrackInventory);
  const [threshold, setThreshold] = useState(
    initial?.low_stock_threshold != null ? String(initial.low_stock_threshold) : defaultTrackInventory ? "5" : "",
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    initial?.modifier_groups?.map((g) => g.id) ?? [],
  );
  const { toast } = useToast();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initial?.image_url ?? null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  };

  const handleImagePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!PRODUCT_IMAGE_ALLOWED.includes(file.type)) {
      toast(copy.catalog.productImageInvalidType, "error");
      return;
    }
    let prepared = file;
    try {
      prepared = await compressImage(file);
    } catch {
      // fall back to original; backend still enforces a size cap
    }
    setImageFile(prepared);
    setImagePreview(URL.createObjectURL(prepared));
    setImageRemoved(false);
  };

  const handleImageRemove = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(true);
  };

  const priceNum = Number(price);
  const priceError =
    price.trim() === ""
      ? null
      : Number.isNaN(priceNum)
        ? copy.catalog.productPriceInvalid
        : priceNum < 0
          ? copy.catalog.productPriceNegative
          : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (price.trim() === "" || Number.isNaN(priceNum) || priceNum < 0) {
      return;
    }
    if (/<[^>]+>/.test(name)) {
      return;
    }
    void onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      sku: sku.trim() || null,
      price_amount: price,
      category_id: categoryId || null,
      track_inventory: trackInventory,
      low_stock_threshold: trackInventory && threshold ? Number(threshold) : null,
      modifier_group_ids: selectedGroupIds,
      image_file: imageFile,
      image_remove: imageRemoved && !imageFile,
    });
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Formulario de producto" className="space-y-4">
      <div className="space-y-2">
        <Label>{copy.catalog.productImage}</Label>
        <div className="flex items-start gap-3">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-[color:var(--kova-mist)]">
            {imagePreview ? (
              <img src={imagePreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground/60" />
            )}
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="mr-1 h-4 w-4" />
                {copy.catalog.productImageUpload}
              </Button>
              {imagePreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleImageRemove}
                >
                  <XIcon className="mr-1 h-4 w-4" />
                  {copy.catalog.productImageRemove}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{copy.catalog.productImageHint}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleImagePick}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="prod-name">{copy.catalog.productName}</Label>
          <Input
            id="prod-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={160}
            autoFocus
            aria-invalid={/<[^>]+>/.test(name) ? "true" : undefined}
            aria-describedby={/<[^>]+>/.test(name) ? "prod-name-error" : undefined}
          />
          {/<[^>]+>/.test(name) && (
            <p id="prod-name-error" className="text-xs text-destructive">
              {copy.catalog.productNameNoHtml}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="prod-price">{copy.catalog.productPrice}</Label>
          <Input
            id="prod-price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/^-/, ""))}
            aria-invalid={priceError ? "true" : undefined}
            aria-describedby={priceError ? "prod-price-error" : undefined}
            required
          />
          {priceError && (
            <p id="prod-price-error" className="text-xs text-destructive">
              {priceError}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="prod-cat">{copy.catalog.productCategory}</Label>
          <Select
            id="prod-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">&mdash;</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="prod-sku">{copy.catalog.productSku}</Label>
          <Input
            id="prod-sku"
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            maxLength={100}
            aria-describedby="prod-sku-help"
          />
          {!sku.trim() && (
            <p id="prod-sku-help" className="text-xs text-muted-foreground">
              {copy.catalog.productSkuAutoHint}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="prod-desc">{copy.catalog.productDescription}</Label>
          <Input
            id="prod-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
          />
        </div>
      </div>

      {/* Track inventory */}
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={trackInventory}
            onChange={(e) => setTrackInventory(e.target.checked)}
            className="rounded border-input"
          />
          {copy.catalog.trackInventory}
        </label>
        {trackInventory && (
          <div className="space-y-2 pl-6">
            <Label htmlFor="prod-threshold">{copy.catalog.lowStockThreshold}</Label>
            <Input
              id="prod-threshold"
              type="number"
              inputMode="numeric"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-32"
            />
          </div>
        )}
      </div>

      {/* Modifier groups */}
      {availableModifierGroups.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{copy.catalog.assignedModifierGroups}</legend>
          <div className="space-y-1.5 rounded-md border p-3">
            {availableModifierGroups.map((group) => (
              <label
                key={group.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedGroupIds.includes(group.id)}
                  onChange={() => toggleGroup(group.id)}
                  className="rounded border-input"
                />
                <span>{group.name}</span>
                {group.is_required && (
                  <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                    {copy.catalog.required}
                  </Badge>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <DialogFooter>
        {onDeactivate && (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void onDeactivate()}
            className="mr-auto"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {copy.catalog.deactivate}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          {copy.catalog.cancel}
        </Button>
        <Button type="submit" disabled={pending || !name.trim() || !price}>
          {copy.catalog.saveProduct}
        </Button>
      </DialogFooter>
    </form>
  );
}
