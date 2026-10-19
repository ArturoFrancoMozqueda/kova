import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import ReconciliationView from "./ReconciliationView";
import type { ReconciliationPreview, SettlementEntry } from "./types";

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", role: "owner" },
      tenantId: "tenant-1",
      sessionMode: "online",
    },
  }),
}));
vi.mock("@/branches/activeBranch", () => ({
  getActiveBranchId: () => "branch-1",
}));
const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const csv =
  "settled_at,gross_amount,fee_amount,net_amount,currency,payment_method,reference\n2026-10-18T12:00:00Z,100.00,3.00,97.00,MXN,manual_card,***1234";
const preview: ReconciliationPreview = {
  parser_version: 1,
  content_sha256: "test-hash",
  errors: [],
  rows: [
    {
      row_number: 2,
      settled_at: "2026-10-18T12:00:00Z",
      gross_amount: "100.00",
      fee_amount: "3.00",
      net_amount: "97.00",
      currency: "MXN",
      payment_method: "manual_card",
      external_reference_masked: "***1234",
      row_fingerprint: "row-hash",
    },
  ],
};
const entry: SettlementEntry = {
  id: "entry-1",
  batch_id: "batch-1",
  settled_at: "2026-10-18T12:00:00Z",
  gross_amount: "100.00",
  fee_amount: "3.00",
  net_amount: "97.00",
  currency: "MXN",
  payment_method: "manual_card",
  external_reference_masked: "***1234",
  status: "unmatched",
  matched_amount: "0.00",
  remaining_amount: "97.00",
  matches: [
    {
      id: "match-1",
      payment_id: "payment-1",
      order_id: "order-1",
      matched_amount: "97.00",
      status: "suggested",
      version: 2,
      reasons: ["Coincide el método de pago"],
    },
  ],
};
const mount = () =>
  render(
    <MemoryRouter>
      <ReconciliationView />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith("/imports/preview")) return json(preview);
    if (String(url).endsWith("/imports/commit"))
      return json({
        id: "batch-1",
        row_count: 1,
        created_at: "2026-10-18T12:00:00Z",
      });
    return json({ entries: [], has_more: false });
  });
});

it("previews without importing and commits only explicitly selected rows", async () => {
  mount();
  await screen.findByText("Empieza con una liquidación real");
  const file = new File([csv], "liquidaciones.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  fireEvent.change(screen.getByLabelText("Archivo CSV de liquidaciones"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar archivo" }));
  const choose = await screen.findByRole("checkbox", {
    name: "Importar fila 2",
  });
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).endsWith("/imports/commit"),
    ),
  ).toBe(false);
  expect(
    screen.getByRole("button", {
      name: "Importar 0 movimientos seleccionados",
    }),
  ).toBeDisabled();
  fireEvent.click(choose);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Importar 1 movimientos seleccionados",
    }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/imports/commit"),
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/imports/commit"),
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    csv_content: csv,
    content_sha256: "test-hash",
    parser_version: 1,
    selected_rows: [2],
  });
  expect(init!.headers).toHaveProperty("Idempotency-Key");
});

it("rejects an oversized CSV before reading or uploading it", async () => {
  mount();
  await screen.findByText("Empieza con una liquidación real");
  const file = new File(["x".repeat(256 * 1024 + 1)], "grande.csv", {
    type: "text/csv",
  });
  fireEvent.change(screen.getByLabelText("Archivo CSV de liquidaciones"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar archivo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("256 KiB");
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
});

it("confirms a specific suggestion using its current version", async () => {
  fetchMock.mockImplementation(async () =>
    json({ entries: [entry], has_more: false }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirmar vínculo" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/matches/match-1/confirm"),
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/matches/match-1/confirm"),
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({ expected_version: 2 });
  expect(
    await screen.findByText(/La venta y el efectivo de caja conservan/),
  ).toBeVisible();
});

it("requires a reason to reverse a confirmed match", async () => {
  fetchMock.mockImplementation(async () =>
    json({
      entries: [
        {
          ...entry,
          matches: [{ ...entry.matches[0], status: "confirmed", version: 3 }],
        },
      ],
      has_more: false,
    }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Revertir vínculo" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirmar reversa" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Motivo de la reversa"), {
    target: { value: "Liquidación incorrecta" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar reversa" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/matches/match-1/reverse"),
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/matches/match-1/reverse"),
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    expected_version: 3,
    reason: "Liquidación incorrecta",
  });
});

it("reloads a conflicting match without automatically confirming again", async () => {
  fetchMock.mockImplementation(async (_url, init) =>
    init?.method === "POST"
      ? json({ detail: "stale" }, 409)
      : json({ entries: [entry], has_more: false }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirmar vínculo" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Los datos cambiaron",
  );
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});
