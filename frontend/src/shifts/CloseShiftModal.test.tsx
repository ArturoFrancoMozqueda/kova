import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import type { Shift } from "./types";

const syncQueue = vi.hoisted(() => ({
  pendingCount: 0,
  failedEntries: [] as Array<{ client_uuid: string }>,
}));

vi.mock("@/offline/useSyncQueue", () => ({
  useSyncQueue: vi.fn(() => ({
    ...syncQueue,
    syncNow: vi.fn(),
    retryDeadLetter: vi.fn(),
  })),
}));

import { useSyncQueue } from "@/offline/useSyncQueue";
import { CloseShiftModal } from "./CloseShiftModal";

const shift = {
  id: "shift-1",
  status: "open",
  opening_cash_amount: "500.00",
  expected_cash_amount: "550.00",
  movements: [],
} as unknown as Shift;

describe("CloseShiftModal offline sale guard", () => {
  beforeEach(() => {
    syncQueue.pendingCount = 0;
    syncQueue.failedEntries = [];
    vi.clearAllMocks();
  });

  it("blocks closing while this shift has pending or syncing sales", () => {
    syncQueue.pendingCount = 1;
    const onSubmit = vi.fn();
    render(<CloseShiftModal shift={shift} pending={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(useSyncQueue).toHaveBeenCalledWith("shift-1");
    expect(screen.getByRole("alert")).toHaveTextContent(/1 venta de este turno/i);
    fireEvent.change(screen.getByLabelText(copy.closeShiftModal.enterActualCash), {
      target: { value: "550.00" },
    });
    expect(screen.getByRole("button", { name: copy.closeShiftModal.submit })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("also blocks failed sales until they are recovered", () => {
    syncQueue.failedEntries = [{ client_uuid: "failed-1" }];
    render(<CloseShiftModal shift={shift} pending={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: copy.closeShiftModal.submit })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Ventas pendientes antes de cerrar/i);
  });

  it("submits once the shift has no unfinished offline sales", () => {
    const onSubmit = vi.fn();
    render(<CloseShiftModal shift={shift} pending={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(copy.closeShiftModal.enterActualCash), {
      target: { value: "550.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.closeShiftModal.submit }));

    expect(onSubmit).toHaveBeenCalledWith({ actual_cash_amount: "550.00" });
  });
});

describe("CloseShiftModal corte preview", () => {
  beforeEach(() => {
    syncQueue.pendingCount = 0;
    syncQueue.failedEntries = [];
  });

  it("draws the corte that will be printed with the counted cash and the server's variance rule", () => {
    render(<CloseShiftModal shift={{ ...shift, opened_at: "2026-11-13T09:00:00Z", closed_at: null }} businessName="Panadería Lupita" pending={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const preview = screen.getByRole("complementary", { name: "Vista previa del corte de caja" });
    expect(preview).toHaveTextContent("Panadería Lupita");
    expect(preview).toHaveTextContent("Captura el efectivo contado");

    fireEvent.change(screen.getByLabelText(copy.closeShiftModal.enterActualCash), { target: { value: "540.10" } });
    expect(preview).toHaveTextContent("-$9.90");
    expect(preview).toHaveTextContent("Corte con $540.10 contados y una diferencia de -$9.90.");

    fireEvent.change(screen.getByLabelText(copy.closeShiftModal.enterActualCash), { target: { value: "550" } });
    expect(preview).toHaveTextContent(/Corte con \$550\.00 contados y una diferencia de \$0\.00/);
  });

  it("keeps the compact modal when no business context is given", () => {
    render(<CloseShiftModal shift={shift} pending={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("complementary", { name: "Vista previa del corte de caja" })).not.toBeInTheDocument();
  });
});
