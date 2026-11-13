import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PresetPicker } from "./PresetPicker";
import { getPresetPreview } from "../onboarding/api";

vi.mock("../onboarding/api", () => ({ getPresetPreview: vi.fn() }));

const preview = {
  preset: "cafe",
  label: "Cafetería",
  categories: ["Café caliente", "Pan dulce"],
  products: [
    { name: "Americano chico", category: "Café caliente", price_amount: "38.00" },
    { name: "Concha", category: "Pan dulce", price_amount: "18.00" },
  ],
};

beforeEach(() => vi.mocked(getPresetPreview).mockReset());

it("shows the real preset products as Caja tiles before applying anything", async () => {
  vi.mocked(getPresetPreview).mockResolvedValue(preview);
  const onApply = vi.fn();
  render(<PresetPicker disabled={false} onApply={onApply} />);

  const toggles = screen.getAllByRole("button", { name: "Ver cómo queda" });
  expect(toggles).toHaveLength(4);
  const cafeToggle = toggles[1];
  expect(cafeToggle).toHaveAccessibleDescription("Cafetería");
  expect(cafeToggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(cafeToggle);

  expect(getPresetPreview).toHaveBeenCalledWith("cafe");
  const region = await screen.findByRole("complementary", { name: "Vista previa de la plantilla Cafetería" });
  expect(region).toHaveTextContent("Así se verá tu Caja");
  expect(region).toHaveTextContent("Americano chico");
  expect(region).toHaveTextContent("Concha");
  expect(region.querySelector("img")).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Ocultar vista previa" })).toHaveAttribute("aria-expanded", "true");

  fireEvent.click(screen.getByRole("button", { name: "Usar Cafetería" }));
  expect(onApply).toHaveBeenCalledWith("cafe");
});

it("still applies a preset in one click and explains a failed preview", async () => {
  vi.mocked(getPresetPreview).mockRejectedValueOnce(new Error("network"));
  const onApply = vi.fn();
  render(<PresetPicker disabled={false} onApply={onApply} />);

  fireEvent.click(screen.getAllByRole("button", { name: "Ver cómo queda" })[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos mostrar la vista previa de Abarrotes");

  fireEvent.click(screen.getByRole("button", { name: /^Abarrotes/ }));
  expect(onApply).toHaveBeenCalledWith("abarrotes");
});
