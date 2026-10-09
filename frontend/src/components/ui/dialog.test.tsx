import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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

  it("keeps input focus across rerenders and restores the original trigger", async () => {
    function EditingDialog() {
      const [open, setOpen] = useState(false);
      const [value, setValue] = useState("");
      return <>
        <button onClick={() => setOpen(true)}>Editar</button>
        <Dialog open={open} onClose={() => setOpen(false)}>
          <DialogTitle>Editar nota</DialogTitle>
          <input aria-label="Nota" value={value} onChange={event => setValue(event.target.value)} />
        </Dialog>
      </>;
    }
    render(<EditingDialog />);
    const trigger = screen.getByRole("button", { name: "Editar" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveFocus();
    const input = screen.getByRole("textbox", { name: "Nota" });
    input.focus();
    fireEvent.change(input, { target: { value: "Recibo de luz" } });
    expect(input).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument());
  });

  it("uses the latest close handler without restarting focus management", () => {
    const before = vi.fn();
    const after = vi.fn();
    const view = render(<Dialog open onClose={before}><DialogTitle>Editar</DialogTitle><input aria-label="Nota" /></Dialog>);
    const input = screen.getByRole("textbox", { name: "Nota" });
    input.focus();
    view.rerender(<Dialog open onClose={after}><DialogTitle>Editar</DialogTitle><input aria-label="Nota" /></Dialog>);
    expect(input).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledOnce();
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

  it("restores focus to the trigger immediately on close, then unmounts", async () => {
    render(<TriggeredDialog />);
    const trigger = screen.getByText("Abrir");
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const panel = screen.getByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    // Focus returns synchronously — it is tied to `open`, not to the exit
    // animation, so a keyboard user is never left waiting on motion.
    expect(trigger).toHaveFocus();
    // The panel now animates out before unmounting (usePresence), so its actual
    // removal from the DOM is no longer synchronous. Held by reference rather
    // than re-queried, because an exiting dialog is already out of the a11y tree.
    await waitFor(() => expect(panel).not.toBeInTheDocument());
  });

  it("leaves the accessibility tree and stops accepting clicks while animating out", () => {
    render(<TriggeredDialog />);
    fireEvent.click(screen.getByText("Abrir"));
    fireEvent.keyDown(document, { key: "Escape" });

    // A dialog animating out is already logically closed. It must not be
    // queryable by role, or its buttons keep being announced — and keep matching
    // test locators — alongside the page's own controls.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acción" })).not.toBeInTheDocument();

    const overlay = document.querySelector("[aria-hidden='true']");
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute("inert");
    expect(overlay?.className).toContain("pointer-events-none");
  });

  it("releases the body scroll lock only once the exit finishes", async () => {
    render(<TriggeredDialog />);
    fireEvent.click(screen.getByText("Abrir"));
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    // Still locked: releasing it early would reflow the page under a dialog that
    // is still on screen.
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(document.body.style.overflow).toBe(""));
  });
});
