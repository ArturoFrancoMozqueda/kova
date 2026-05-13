import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  CATALOG_CREATE_PERMISSION,
  CATALOG_DELETE_PERMISSION,
  CATALOG_UPDATE_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney } from "../orders/format";
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
  const [notice, setNotice] = useState<string | null>(null);

  const [showModifiers, setShowModifiers] = useState(false);

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

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const visibleProducts =
    loadState.status === "ready"
      ? selectedCategoryId
        ? loadState.products.filter((p) => p.category_id === selectedCategoryId)
        : loadState.products
      : [];

  if (loadState.status === "loading") {
    return <main aria-busy="true">{copy.catalog.loading}</main>;
  }

  if (loadState.status === "error") {
    return (
      <main>
        <p role="alert">{copy.catalog.loadError}</p>
        <button type="button" onClick={() => void load()}>
          {copy.catalog.retry}
        </button>
      </main>
    );
  }

  const { categories } = loadState;

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>{copy.catalog.title}</h1>
        </div>
        {notice && <p role="status">{notice}</p>}
      </header>

      <div className="catalog-shell">
        {/* Categories sidebar */}
        <aside className="panel catalog-categories">
          <div className="panel-header">
            <h2>{copy.catalog.categories}</h2>
            {canCreate && modal?.type !== "category-create" && (
              <button type="button" onClick={() => setModal({ type: "category-create" })}>
                {copy.catalog.newCategory}
              </button>
            )}
          </div>

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
                  showNotice(copy.catalog.operationError);
                } finally {
                  setPending(false);
                }
              }}
            />
          )}

          <ul className="category-list" role="listbox" aria-label={copy.catalog.categories}>
            <li>
              <button
                type="button"
                role="option"
                aria-selected={selectedCategoryId === null}
                className={selectedCategoryId === null ? "selected" : ""}
                onClick={() => setSelectedCategoryId(null)}
              >
                {copy.catalog.allProducts}
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedCategoryId === cat.id}
                  className={selectedCategoryId === cat.id ? "selected" : ""}
                  onClick={() => setSelectedCategoryId(cat.id)}
                >
                  {cat.name}
                </button>
                {canUpdate && (
                  <button
                    type="button"
                    aria-label={`Edit ${cat.name}`}
                    onClick={() => setModal({ type: "category-edit", category: cat })}
                  >
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`Deactivate ${cat.name}`}
                    onClick={async () => {
                      setPending(true);
                      try {
                        await deactivateCategory(cat.id);
                        showNotice(copy.catalog.categoryDeactivated);
                        if (selectedCategoryId === cat.id) setSelectedCategoryId(null);
                        await load();
                      } catch {
                        showNotice(copy.catalog.operationError);
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    {copy.catalog.deactivate}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {categories.length === 0 && !modal && (
            <p className="muted">{copy.catalog.emptyCategories}</p>
          )}
        </aside>

        {/* Products main panel */}
        <section className="panel catalog-products">
          <div className="panel-header">
            <h2>{copy.catalog.products}</h2>
            {canCreate && modal?.type !== "product-create" && (
              <button type="button" onClick={() => setModal({ type: "product-create" })}>
                {copy.catalog.newProduct}
              </button>
            )}
          </div>

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
                  showNotice(copy.catalog.operationError);
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
                        showNotice(copy.catalog.operationError);
                      } finally {
                        setPending(false);
                      }
                    }
                  : undefined
              }
            />
          )}

          {visibleProducts.length === 0 && !modal && (
            <p className="muted">{copy.catalog.emptyProducts}</p>
          )}

          <ul className="product-list">
            {visibleProducts.map((product) => (
              <li key={product.id} className="data-card">
                <div>
                  <strong>{product.name}</strong>
                  {product.sku && <span className="muted"> · {product.sku}</span>}
                </div>
                <div>{formatMoney(product.price_amount)}</div>
                {canUpdate && (
                  <button
                    type="button"
                    aria-label={`Edit ${product.name}`}
                    onClick={() => setModal({ type: "product-edit", product })}
                  >
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Modifier Groups section */}
      {canCreate && (
        <section className="panel" style={{ marginTop: "1.5rem" }}>
          <div className="panel-header">
            <h2>{copy.catalog.modifiers}</h2>
            <button type="button" onClick={() => setShowModifiers((v) => !v)}>
              {showModifiers ? copy.catalog.cancel : copy.catalog.modifiers}
            </button>
          </div>
          {showModifiers && loadState.status === "ready" && (
            <ModifierGroupsPanel
              groups={loadState.modifierGroups}
              canEdit={canCreate}
              canDelete={canDelete}
              onReload={load}
              onNotice={showNotice}
            />
          )}
        </section>
      )}
    </main>
  );
}

function ModifierGroupsPanel({
  groups,
  canEdit,
  canDelete,
  onReload,
  onNotice,
}: {
  groups: ModifierGroup[];
  canEdit: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotice: (msg: string) => void;
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
      onNotice(copy.catalog.operationError);
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
      onNotice(copy.catalog.operationError);
    }
  };

  return (
    <div>
      {groups.length === 0 && <p className="muted">{copy.catalog.noModifierGroups}</p>}
      {groups.map((group) => (
        <article key={group.id} className="data-card" style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>
              {group.name}
              {group.is_required && (
                <span className="status-warn" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>
                  {copy.catalog.required}
                </span>
              )}
            </strong>
            {canDelete && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await deactivateModifierGroup(group.id);
                    onNotice(copy.catalog.modifierGroupDeactivated);
                    await onReload();
                  } catch {
                    onNotice(copy.catalog.operationError);
                  }
                }}
              >
                {copy.catalog.deactivate}
              </button>
            )}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0" }}>
            {group.options.map((opt) => (
              <li key={opt.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                <span>{opt.name}</span>
                {parseFloat(opt.price_delta) > 0 && (
                  <span className="muted">+MX${parseFloat(opt.price_delta).toFixed(2)}</span>
                )}
                {canDelete && (
                  <button
                    type="button"
                    style={{ marginLeft: "auto", fontSize: "0.8rem" }}
                    onClick={async () => {
                      try {
                        await deactivateModifierOption(group.id, opt.id);
                        onNotice(copy.catalog.optionDeactivated);
                        await onReload();
                      } catch {
                        onNotice(copy.catalog.operationError);
                      }
                    }}
                  >
                    {copy.catalog.deactivate}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <input
                type="text"
                placeholder={copy.catalog.optionName}
                value={newOptions[group.id]?.name ?? ""}
                onChange={(e) => setNewOptions((prev) => ({
                  ...prev, [group.id]: { ...prev[group.id], name: e.target.value, delta: prev[group.id]?.delta ?? "" }
                }))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                placeholder={copy.catalog.priceDelta}
                step="0.01"
                min="0"
                value={newOptions[group.id]?.delta ?? ""}
                onChange={(e) => setNewOptions((prev) => ({
                  ...prev, [group.id]: { ...prev[group.id], delta: e.target.value, name: prev[group.id]?.name ?? "" }
                }))}
                style={{ width: "7rem" }}
              />
              <button type="button" onClick={() => void handleAddOption(group.id)}>
                {copy.catalog.newOption}
              </button>
            </div>
          )}
        </article>
      ))}

      {canEdit && (
        <form onSubmit={(e) => void handleCreateGroup(e)} style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "center" }}>
          <input
            type="text"
            placeholder={copy.catalog.modifierGroupName}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            style={{ flex: 1 }}
          />
          <label style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={newGroupRequired}
              onChange={(e) => setNewGroupRequired(e.target.checked)}
            />
            {copy.catalog.required}
          </label>
          <button type="submit" disabled={addingGroup || !newGroupName.trim()}>
            {copy.catalog.newModifierGroup}
          </button>
        </form>
      )}
    </div>
  );
}

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
    <form className="panel-form" onSubmit={handleSubmit} aria-label="Category form">
      <label>
        {copy.catalog.categoryName}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          autoFocus
        />
      </label>
      <label>
        {copy.catalog.categoryDescription}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </label>
      <label>
        {copy.catalog.sortOrder}
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          min={0}
        />
      </label>
      <div className="button-row">
        <button type="submit" disabled={pending || !name.trim()}>
          {copy.catalog.saveCategory}
        </button>
        <button type="button" onClick={onCancel}>
          {copy.catalog.cancel}
        </button>
      </div>
    </form>
  );
}

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
    <form className="panel-form" onSubmit={handleSubmit} aria-label="Product form">
      <label>
        {copy.catalog.productName}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={160}
          autoFocus
        />
      </label>
      <label>
        {copy.catalog.productPrice}
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </label>
      <label>
        {copy.catalog.productCategory}
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.catalog.productSku}
        <input
          type="text"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          maxLength={100}
        />
      </label>
      <label>
        {copy.catalog.productDescription}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={trackInventory}
          onChange={(e) => setTrackInventory(e.target.checked)}
        />
        {" "}{copy.catalog.trackInventory}
      </label>
      {trackInventory && (
        <label>
          {copy.catalog.lowStockThreshold}
          <input
            type="number"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
      )}
      {availableModifierGroups.length > 0 && (
        <fieldset>
          <legend>{copy.catalog.assignedModifierGroups}</legend>
          {availableModifierGroups.map((group) => (
            <label key={group.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={selectedGroupIds.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
              />
              {group.name}
              {group.is_required && (
                <span className="muted" style={{ fontSize: "0.8rem" }}>({copy.catalog.required})</span>
              )}
            </label>
          ))}
        </fieldset>
      )}
      <div className="button-row">
        <button type="submit" disabled={pending || !name.trim() || !price}>
          {copy.catalog.saveProduct}
        </button>
        {onDeactivate && (
          <button type="button" disabled={pending} onClick={() => void onDeactivate()}>
            {copy.catalog.deactivate}
          </button>
        )}
        <button type="button" onClick={onCancel}>
          {copy.catalog.cancel}
        </button>
      </div>
    </form>
  );
}
