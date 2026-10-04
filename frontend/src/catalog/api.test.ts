import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProduct,
  commitCatalogImport,
  previewCatalogImport,
  setProductModifierGroups,
  updateProduct,
} from "./api";
import type { ProductCreate, ProductUpdate } from "./types";

function mockProductResponse() {
  return new Response(
    JSON.stringify({
      id: "product-1",
      tenant_id: "tenant-1",
      category_id: null,
      name: "Concha",
      description: null,
      sku: null,
      price_amount: "18.00",
      cost_price: "8.50",
      track_inventory: false,
      low_stock_threshold: null,
      image_url: null,
      image_position_x: 50,
      image_position_y: 50,
      image_zoom: 1,
      is_active: true,
      modifier_groups: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

// The product form object carries client-only fields. The backend now rejects
// unknown fields, so the API layer must strip them before sending.
const POLLUTED = {
  name: "Concha",
  description: null,
  sku: null,
  price_amount: "18.00",
  cost_price: "8.50",
  category_id: null,
  track_inventory: false,
  low_stock_threshold: null,
  image_position_x: 50,
  image_position_y: 50,
  image_zoom: 1,
  // client-only fields that must NOT reach the API:
  image_file: new File(["x"], "x.png", { type: "image/png" }),
  image_remove: false,
  modifier_group_ids: ["group-1"],
};

describe("catalog api product payloads", () => {
  afterEach(() => vi.restoreAllMocks());

  it("createProduct sends only schema fields", async () => {
    const fetchMock = vi.fn(async () => mockProductResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createProduct(POLLUTED as unknown as ProductCreate);

    const body = sentBody(fetchMock);
    expect(body).not.toHaveProperty("image_file");
    expect(body).not.toHaveProperty("image_remove");
    expect(body).not.toHaveProperty("modifier_group_ids");
    expect(body.name).toBe("Concha");
    expect(body.price_amount).toBe("18.00");
    expect(body.cost_price).toBe("8.50");
  });

  it("updateProduct sends only schema fields", async () => {
    const fetchMock = vi.fn(async () => mockProductResponse());
    vi.stubGlobal("fetch", fetchMock);

    await updateProduct("product-1", POLLUTED as unknown as ProductUpdate);

    const body = sentBody(fetchMock);
    expect(body).not.toHaveProperty("image_file");
    expect(body).not.toHaveProperty("image_remove");
    expect(body).not.toHaveProperty("modifier_group_ids");
    expect(body.name).toBe("Concha");
    expect(body.cost_price).toBe("8.50");
  });

  it("setProductModifierGroups skips blank ids and compacts sort order", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await setProductModifierGroups("product-1", [" group-1 ", "", "group-1", "group-2"]);

    const body = sentBody(fetchMock);
    expect(body).toEqual({
      assignments: [
        { modifier_group_id: "group-1", sort_order: 0 },
        { modifier_group_id: "group-2", sort_order: 1 },
      ],
    });
  });

  it("sends xlsx with a coherent format query and media type", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const workbook = new File(["xlsx"], "catalogo.xlsx", {
      type: "application/octet-stream",
    });

    await previewCatalogImport(workbook);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "/api/v1/catalog/import?dry_run=true&format=xlsx",
    );
    expect(init.headers).toEqual(expect.objectContaining({
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    expect(init.body).toBe(workbook);
  });

  it("sends a preserved import key after a response is lost", async () => {
    const processed = new Set<string>();
    const keys: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get("Idempotency-Key")!;
      keys.push(key);
      if (!processed.has(key)) {
        processed.add(key);
        throw new TypeError("Response lost after server commit");
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["nombre,precio\nCafé,18"], "catalogo.csv");
    await expect(commitCatalogImport(file, "stable-import-key")).rejects.toThrow("Response lost");
    await commitCatalogImport(file, "stable-import-key");
    expect(keys).toEqual(["stable-import-key", "stable-import-key"]);
    expect(processed.size).toBe(1);
  });
});
