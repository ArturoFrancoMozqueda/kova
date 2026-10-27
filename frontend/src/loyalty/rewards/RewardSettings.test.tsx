import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RewardSettings } from "./RewardSettings";
import type { Reward } from "./api";

const identity = { tenantId: "tenant-1", userId: "owner-1", branchId: "branch-1" };
const reward: Reward = { id: "reward-1", version: 3, enabled: true, title: "Gracias por volver", points_cost: 20, discount_amount: "20.00" };
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
beforeEach(() => {
  vi.clearAllMocks(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(json(null));
});
afterEach(() => vi.unstubAllGlobals());

it("starts without inventing a benefit, monetary amount, point goal or activation", async () => {
  render(<RewardSettings identity={identity} />);
  fireEvent.click(await screen.findByRole("button", { name: "Definir recompensa" }));
  expect(screen.getByLabelText("Nombre de la recompensa")).toHaveValue("");
  expect(screen.getByLabelText("Puntos para canjear")).toHaveValue(null);
  expect(screen.getByLabelText("Descuento en MXN")).toHaveValue("");
  expect(screen.getByLabelText("Permitir nuevos canjes en caja")).not.toBeChecked();
  expect(writes()).toHaveLength(0);
});

it("saves only the owner's explicit reward with the current version and branch", async () => {
  fetchMock.mockImplementation(async (_url, init) => init?.method === "PUT" ? json({ ...reward, version: 4, points_cost: 30, discount_amount: "25.00" }) : json(reward));
  render(<RewardSettings identity={identity} />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar recompensa" }));
  expect(screen.getByLabelText("Permitir nuevos canjes en caja")).toBeChecked();
  fireEvent.change(screen.getByLabelText("Puntos para canjear"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("Descuento en MXN"), { target: { value: "25.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar recompensa" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Recompensa guardada");
  expect(writes()).toHaveLength(1);
  expect(writes()[0][0]).toBe("/api/v1/loyalty/rewards");
  expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ expected_version: 3, enabled: true, title: reward.title, points_cost: 30, discount_amount: "25.00" });
  expect(writes()[0][1]).toEqual(expect.objectContaining({ credentials: "include", cache: "no-store", headers: expect.objectContaining({ "X-Kova-Expected-Tenant": "tenant-1", "X-Kova-Expected-User": "owner-1", "X-Kova-Branch": "branch-1", "Idempotency-Key": expect.any(String) }) }));
});

it("keeps a failed save reviewable and reuses its key for the same uncertain request", async () => {
  let count = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== "PUT") return json(reward);
    count += 1; return count === 1 ? json({ detail: "No pudimos confirmar el guardado" }, 503) : json({ ...reward, version: 4 });
  });
  render(<RewardSettings identity={identity} />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar recompensa" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar recompensa" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Consulta la recompensa actual antes de volver a guardar.");
  expect(screen.getByLabelText("Nombre de la recompensa")).toHaveValue(reward.title);
  fireEvent.click(screen.getByRole("button", { name: "Guardar recompensa" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[0][1]?.body).toBe(writes()[1][1]?.body);
  expect((writes()[0][1]?.headers as Record<string, string>)["Idempotency-Key"]).toBe((writes()[1][1]?.headers as Record<string, string>)["Idempotency-Key"]);
});

it("does not present a malformed API result as a reward or allow overwriting it", async () => {
  fetchMock.mockResolvedValue(json({ title: "Sin versión ni regla válida" }));
  render(<RewardSettings identity={identity} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar");
  expect(screen.getByRole("button", { name: "Definir recompensa" })).toBeDisabled();
  expect(screen.queryByText(/puntos por/)).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("recovers an initial loading failure through an explicit retry without inventing or saving a benefit", async () => {
  fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(reward));
  render(<RewardSettings identity={identity} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Consultar recompensa actual" }));
  expect(await screen.findByRole("button", { name: "Editar recompensa" })).toBeEnabled();
  expect(screen.getByText(/Gracias por volver/)).toBeVisible();
  expect(writes()).toHaveLength(0);
});

it.each(["malformed JSON", "technical network error"])("keeps a %s out of reward feedback and preserves the same save operation", async failure => {
  let attempts = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== "PUT") return json(reward);
    if (++attempts === 1) {
      if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
      throw new Error("Failed to fetch: backend postgres connection failed");
    }
    return json({ ...reward, version: 4 });
  });
  render(<RewardSettings identity={identity} />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar recompensa" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar recompensa" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Consulta la recompensa actual antes de volver a guardar.");
  expect(screen.queryByText(/Unexpected token|Failed to fetch|postgres|proxy error/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guardar recompensa" }));
  await screen.findByRole("status");
  expect(writes()).toHaveLength(2);
  expect(writes()[0][1]?.body).toBe(writes()[1][1]?.body);
  expect((writes()[0][1]?.headers as Record<string, string>)["Idempotency-Key"]).toBe((writes()[1][1]?.headers as Record<string, string>)["Idempotency-Key"]);
});
