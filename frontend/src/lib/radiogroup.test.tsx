import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { handleRadioGroupKeyDown } from "./radiogroup";

const OPTIONS = [{ value: "a" }, { value: "b" }, { value: "c" }] as const;

function Group({ disabledC = false }: { disabledC?: boolean }) {
  const [value, setValue] = useState<string>("a");
  const options = OPTIONS.map((o) => ({
    value: o.value,
    disabled: disabledC && o.value === "c",
  }));
  return (
    <div
      role="radiogroup"
      aria-label="grupo"
      tabIndex={-1}
      onKeyDown={(e) => handleRadioGroupKeyDown(e, options, value, setValue)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-radio-value={o.value}
          aria-checked={value === o.value}
          aria-disabled={o.disabled}
          tabIndex={value === o.value ? 0 : -1}
        >
          {o.value}
        </button>
      ))}
    </div>
  );
}

describe("handleRadioGroupKeyDown", () => {
  it("moves selection and focus forward on ArrowRight (with wraparound)", () => {
    render(<Group />);
    const group = screen.getByRole("radiogroup");
    screen.getByText("a").focus();

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByText("b")).toHaveFocus();
    expect(screen.getByText("b")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "ArrowRight" }); // c -> wraps to a
    expect(screen.getByText("a")).toHaveFocus();
    expect(screen.getByText("a")).toHaveAttribute("aria-checked", "true");
  });

  it("moves selection backward on ArrowLeft", () => {
    render(<Group />);
    const group = screen.getByRole("radiogroup");
    screen.getByText("a").focus();
    fireEvent.keyDown(group, { key: "ArrowLeft" }); // wraps to c
    expect(screen.getByText("c")).toHaveAttribute("aria-checked", "true");
  });

  it("jumps to first/last with Home/End", () => {
    render(<Group />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "End" });
    expect(screen.getByText("c")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "Home" });
    expect(screen.getByText("a")).toHaveAttribute("aria-checked", "true");
  });

  it("skips disabled options", () => {
    render(<Group disabledC />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" }); // a -> b
    expect(screen.getByText("b")).toHaveAttribute("aria-checked", "true");
    // From b, ArrowRight would land on disabled c → wraps to a instead.
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByText("a")).toHaveAttribute("aria-checked", "true");
  });

  it("ignores non-navigation keys", () => {
    render(<Group />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "Enter" });
    expect(screen.getByText("a")).toHaveAttribute("aria-checked", "true");
  });
});
