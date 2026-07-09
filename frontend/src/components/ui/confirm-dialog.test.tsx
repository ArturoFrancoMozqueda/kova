import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("does not fire the action until confirmed", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="¿Desactivar acceso?"
        description="Fulano ya no podrá entrar."
        confirmLabel="Desactivar acceso"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Desactivar acceso"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel aborts without confirming", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="¿Seguro?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText("Cancelar"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both buttons while busy", () => {
    render(
      <ConfirmDialog open busy title="¿Seguro?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Cancelar")).toBeDisabled();
    expect(screen.getByText("Confirmar")).toBeDisabled();
  });
});
