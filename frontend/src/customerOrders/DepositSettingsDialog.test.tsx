import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("./api", () => ({
  getCustomerOrderSettings: () => api.get(),
  updateCustomerOrderSettings: (body: unknown) => api.put(body),
}));
import { DepositSettingsButton } from "./DepositSettingsDialog";

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ deposit_minimum_percent: "0.00", cancelled_deposit_policy: "refund" });
  api.put.mockReset().mockImplementation(async (body) => body);
});

it("saves the business's minimum deposit and cancellation policy", async () => {
  render(<DepositSettingsButton />);
  fireEvent.click(screen.getByRole("button", { name: "Política de anticipos" }));
  const percent = await screen.findByLabelText("Anticipo mínimo para confirmar (%)");
  fireEvent.change(percent, { target: { value: "50" } });
  fireEvent.click(screen.getByRole("radio", { name: /Conservar el anticipo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar política" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith({
    deposit_minimum_percent: "50.00", cancelled_deposit_policy: "retain",
  }));
  expect(await screen.findByText("Política guardada.")).toBeVisible();
});

it("does not save a minimum above 100%", async () => {
  render(<DepositSettingsButton />);
  fireEvent.click(screen.getByRole("button", { name: "Política de anticipos" }));
  fireEvent.change(await screen.findByLabelText("Anticipo mínimo para confirmar (%)"), { target: { value: "120" } });
  expect(screen.getByRole("button", { name: "Guardar política" })).toBeDisabled();
});
