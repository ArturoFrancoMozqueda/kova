import type {
  Category,
  CategoryCreate,
  CategoryUpdate,
  Product,
  ProductCreate,
  ProductUpdate,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

function ikey(): string {
  return crypto.randomUUID();
}

export function listCategories(): Promise<Category[]> {
  return requestJson<Category[]>("/api/v1/catalog/categories");
}

export function createCategory(body: CategoryCreate): Promise<Category> {
  return requestJson<Category>("/api/v1/catalog/categories", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function updateCategory(id: string, body: CategoryUpdate): Promise<Category> {
  return requestJson<Category>(`/api/v1/catalog/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function deactivateCategory(id: string): Promise<Category> {
  return requestJson<Category>(`/api/v1/catalog/categories/${id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": ikey() },
  });
}

export function listProducts(): Promise<Product[]> {
  return requestJson<Product[]>("/api/v1/catalog/products");
}

export function createProduct(body: ProductCreate): Promise<Product> {
  return requestJson<Product>("/api/v1/catalog/products", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function updateProduct(id: string, body: ProductUpdate): Promise<Product> {
  return requestJson<Product>(`/api/v1/catalog/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": ikey() },
  });
}

export function deactivateProduct(id: string): Promise<Product> {
  return requestJson<Product>(`/api/v1/catalog/products/${id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": ikey() },
  });
}
