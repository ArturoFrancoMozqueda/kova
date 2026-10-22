import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionDisclosure } from "./action-disclosure";

describe("ActionDisclosure", () => {
  it("opens without invoking an action and returns focus after the action", () => {
    const act = vi.fn();
    render(<ActionDisclosure label="Más acciones de Café" actions={[{ label: "Conteo", onSelect: act }]} />);
    const trigger = screen.getByRole("button", { name: "Más acciones de Café" });
    expect(screen.queryByRole("button", { name: "Conteo" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Conteo" }));
    expect(act).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("dismisses with Escape and restores focus without invoking the action", () => {
    const act = vi.fn();
    render(<ActionDisclosure label="Más acciones" actions={[{ label: "Definir umbral", onSelect: act }]} />);
    const trigger = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Definir umbral" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(act).not.toHaveBeenCalled();
  });

  it("dismisses when interacting outside or tabbing past the disclosure", () => {
    render(<><ActionDisclosure label="Más acciones" actions={[{ label: "Conteo", onSelect: () => {} }]} /><button>Fuera</button></>);
    const trigger = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Fuera" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.blur(screen.getByRole("button", { name: "Conteo" }), { relatedTarget: screen.getByRole("button", { name: "Fuera" }) });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
