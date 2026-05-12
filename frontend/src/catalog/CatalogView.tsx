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
  createProduct,
  deactivateCategory,
  deactivateProduct,
  listCategories,
  listProducts,
  updateCategory,
  updateProduct,
} from "./api";
import type { Category, Product } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: Category[]; products: Product[] };

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

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const [categories, products] = await Promise.all([listCategories(), listProducts()]);
      setLoadState({ status: "ready", categories, products });
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
              defaultCategoryId={selectedCategoryId}
              pending={pending}
              onCancel={() => setModal(null)}
              onSubmit={async (values) => {
                setPending(true);
                try {
                  if (modal.type === "product-create") {
                    await createProduct(values);
                    showNotice(copy.catalog.productCreated);
                  } else {
                    await updateProduct(modal.product.id, values);
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
    </main>
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
};

function ProductForm({
  initial,
  categories,
  defaultCategoryId,
  pending,
  onCancel,
  onSubmit,
  onDeactivate,
}: {
  initial?: Product;
  categories: Category[];
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
