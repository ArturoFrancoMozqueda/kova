import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DrawerSettings } from "./DrawerSettings";
import { useCashDrawer } from "./useCashDrawer";

const api = vi.hoisted(() => ({
  getDrawerStatus: vi.fn(), openDrawer: vi.fn(), pairDrawer: vi.fn(),
  revokeDrawer: vi.fn(), saveDrawerSettings: vi.fn(),
}));
vi.mock("./api", () => api);

describe("cash drawer setup and failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDrawerStatus.mockResolvedValue({ configured: true, online: true, auto_open: true, name: "Caja 1", pin: 0, paired: true });
  });

  it("keeps hardware failures separate from the completed sale", async () => {
    api.openDrawer.mockRejectedValue(new Error("Disconnected"));
    const { result } = renderHook(useCashDrawer);
    await waitFor(() => expect(result.current.device?.configured).toBe(true));
    await act(async () => { await result.current.open("sale", "", "sale-1"); });
    expect(result.current.message).toMatch(/venta permanece guardada/);
    expect(result.current.busy).toBe(false);
    expect(api.openDrawer).toHaveBeenCalledTimes(1);
  });

  it("does not send automatic commands when auto opening is disabled", async () => {
    api.getDrawerStatus.mockResolvedValue({ configured: true, online: true, auto_open: false });
    const { result } = renderHook(useCashDrawer);
    await waitFor(() => expect(result.current.device?.configured).toBe(true));
    await act(async () => { await result.current.open("sale", "", "sale-1"); });
    expect(api.openDrawer).not.toHaveBeenCalled();
  });

  it("saves changes without rotating the paired device key", async () => {
    api.saveDrawerSettings.mockResolvedValue({ configured: true, online: true, auto_open: false });
    render(<DrawerSettings />);
    expect(await screen.findByDisplayValue("Caja 1")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: /abrir al cobrar efectivo/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración del cajón" }));
    await waitFor(() => expect(api.saveDrawerSettings).toHaveBeenCalledWith({ name: "Caja 1", pin: 0, auto_open: false }));
    expect(api.pairDrawer).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation before revoking the connector", async () => {
    api.revokeDrawer.mockResolvedValue({ status: "revoked" });
    render(<DrawerSettings />);
    await screen.findByDisplayValue("Caja 1");
    fireEvent.click(screen.getByRole("button", { name: "Desvincular conector" }));
    expect(api.revokeDrawer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    await waitFor(() => expect(api.revokeDrawer).toHaveBeenCalledTimes(1));
  });
});
