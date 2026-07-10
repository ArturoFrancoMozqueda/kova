import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogHeader, DialogTitle } from "./dialog";

function OpenDialog() {
  return (
    <Dialog open onClose={() => {}}>
      <DialogHeader>
        <DialogTitle>Confirmar acción</DialogTitle>
      </DialogHeader>
      <button>Primero</button>
      <button>Último</button>
    </Dialog>
  );
}

function TriggeredDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader>
          <DialogTitle>Título</DialogTitle>
        </DialogHeader>
        <button>Acción</button>
      </Dialog>
    </>
  );
}

describe("Dialog focus management", () => {
  it("links its title via aria-labelledby", () => {
    render(<OpenDialog />);
    const dialog = screen.getByRole("dialog");
    const title = screen.getByText("Confirmar acción");
    expect(title.id).toBeTruthy();
    expect(dialog).toHaveAttribute("aria-labelledby", title.id);
  });

  it("moves focus into the dialog on open", () => {
    render(<OpenDialog />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("traps Tab from the last control back to the first", () => {
    render(<OpenDialog />);
    screen.getByText("Último").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    // The close (X) button is the first focusable element in the dialog.
    expect(screen.getByLabelText("Cerrar")).toHaveFocus();
  });

  it("traps Shift+Tab from the first control to the last", () => {
    render(<OpenDialog />);
    screen.getByLabelText("Cerrar").focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByText("Último")).toHaveFocus();
  });

  it("restores focus to the trigger when closed", () => {
    render(<TriggeredDialog />);
    const trigger = screen.getByText("Abrir");
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
