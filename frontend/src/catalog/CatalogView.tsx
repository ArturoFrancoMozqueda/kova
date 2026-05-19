import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  CATALOG_CREATE_PERMISSION,
  CATALOG_DELETE_PERMISSION,
  CATALOG_UPDATE_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney } from "../orders/format";
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
  listCategories,
  listModifierGroups,
  listProducts,
  setProductModifierGroups,
  updateCategory,
  updateProduct,
} from "./api";
import type { Category, ModifierGroup, Product } from "./types";
import { ProductStoryCard } from "./ProductStoryCard";

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
} from "lucide-react";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: Category[]; products: Product[]; modifierGroups: ModifierGroup[] };

type Modal =
  | null
  | { type: "category-create" }
  | { type: "category-edit"; category: Category }
  | { type: "product-create" }
  | { type: "product-edit"; product: Product };

export default function CatalogView() {
  const canCreate = usePermission(CATALOG_CREATE_PERMISSION);
  const canUpdate = usePermission(CATALOG_UPDATE_PERMISSION);
  const canDelete = usePermission(CATALOG_DELETE_PERMISSION);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  const [showModifiers, setShowModifiers] = useState(false);
  const [presetApplying, setPresetApplying] = useState(false);
  const [storyProduct, setStoryProduct] = useState<Product | null>(null);

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

  const showNotice = (msg: string, variant: "success" | "error" = "success") => {
    toast(msg, variant);
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
    } catch {
      showNotice(copy.catalog.operationError, "error");
    } finally {
      setPresetApplying(false);
    }
  };

  const visibleProducts =
    loadState.status === "ready"
      ? selectedCategoryId
        ? loadState.products.filter((p) => p.category_id === selectedCategoryId)
        : loadState.products
      : [];

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
            <button
              type="button"
              disabled={presetApplying}
              onClick={() => void handleApplyPreset("bakery").then(() => {/* no-op, user dismissed */}).catch(() => undefined)}
              className="hidden" // blank option is handled by not clicking any preset
            />
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
                <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Edit ${cat.name}`}
                      onClick={() => setModal({ type: "category-edit", category: cat })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      aria-label={`Deactivate ${cat.name}`}
                      onClick={async () => {
                        setPending(true);
                        try {
                          await deactivateCategory(cat.id);
                          showNotice(copy.catalog.categoryDeactivated);
                          if (selectedCategoryId === cat.id) setSelectedCategoryId(null);
                          await load();
                        } catch {
                          showNotice(copy.catalog.operationError, "error");
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
                      onClick={() => void handleApplyPreset("bakery")}
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm truncate">{product.name}</h3>
                        {product.sku && (
                          <p className="text-xs text-muted-foreground mt-0.5">{product.sku}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={copy.productStory.storyButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStoryProduct(product);
                          }}
                        >
                          <BarChart2 className="h-3.5 w-3.5" />
                        </Button>
                        {canUpdate && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Edit ${product.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setModal({ type: "product-edit", product });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
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
                onError={(msg) => showNotice(msg, "error")}
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
              ? "Update the category details below."
              : "Add a new category to organize your products."}
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
              } catch {
                showNotice(copy.catalog.operationError, "error");
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
            categories={categories}
            availableModifierGroups={loadState.status === "ready" ? loadState.modifierGroups : []}
            defaultCategoryId={selectedCategoryId}
            pending={pending}
            onCancel={() => setModal(null)}
            onSubmit={async (values) => {
              setPending(true);
              try {
                if (modal.type === "product-create") {
                  const product = await createProduct(values);
                  await setProductModifierGroups(product.id, values.modifier_group_ids);
                  showNotice(copy.catalog.productCreated);
                } else {
                  await updateProduct(modal.product.id, values);
                  await setProductModifierGroups(modal.product.id, values.modifier_group_ids);
                  showNotice(copy.catalog.productUpdated);
                }
                setModal(null);
                await load();
              } catch {
                showNotice(copy.catalog.operationError, "error");
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
                    } catch {
                      showNotice(copy.catalog.operationError, "error");
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
  onError: (msg: string) => void;
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
    } catch {
      onError(copy.catalog.operationError);
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
    } catch {
      onError(copy.catalog.operationError);
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
                  } catch {
                    onError(copy.catalog.operationError);
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
                    +MX${parseFloat(opt.price_delta).toFixed(2)}
                  </span>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover/opt:opacity-100 transition-opacity text-destructive hover:text-destructive"
                    onClick={async () => {
                      try {
                        await deactivateModifierOption(group.id, opt.id);
                        onNotice(copy.catalog.optionDeactivated);
                        await onReload();
                      } catch {
                        onError(copy.catalog.operationError);
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
    <form onSubmit={handleSubmit} aria-label="Category form" className="space-y-4">
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
};

function ProductForm({
  initial,
  categories,
  availableModifierGroups,
  defaultCategoryId,
  pending,
  onCancel,
  onSubmit,
  onDeactivate,
}: {
  initial?: Product;
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
  const [trackInventory, setTrackInventory] = useState(initial?.track_inventory ?? false);
  const [threshold, setThreshold] = useState(
    initial?.low_stock_threshold != null ? String(initial.low_stock_threshold) : "",
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    initial?.modifier_groups?.map((g) => g.id) ?? [],
  );

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      sku: sku.trim() || null,
      price_amount: price,
      category_id: categoryId || null,
      track_inventory: trackInventory,
      low_stock_threshold: trackInventory && threshold ? Number(threshold) : null,
      modifier_group_ids: selectedGroupIds,
    });
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Product form" className="space-y-4">
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
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prod-price">{copy.catalog.productPrice}</Label>
          <Input
            id="prod-price"
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
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
          />
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
