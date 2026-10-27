import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LoyaltyCardScreen, type PublicLoyaltyCardData } from "./LoyaltyCardScreen";

const card: PublicLoyaltyCardData = {
  business_name: "Café del Patio", branch_name: "Centro", balance: 10, adjustments_pending: false,
  policy: { enabled: true, spend_amount: "100.00", points_per_step: 5 }, expires_at: "2026-11-26T12:00:00Z", catalog_path: "/catalogo/cafe-del-patio",
  member_code: "KV-ABCD-EFGH", reward: { id: "reward-1", version: 1, enabled: true, title: "Gracias por volver", points_cost: 20, discount_amount: "20.00" },
};
beforeEach(() => { vi.clearAllMocks(); });

it("shows only the backend member code and real reward progress with an accessible copy fallback", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
  const { container } = render(<LoyaltyCardScreen data={card} onRefresh={vi.fn()} />);
  expect(screen.getByLabelText("Número de tarjeta")).not.toBeVisible();
  fireEvent.click(screen.getByText("Usar número de tarjeta"));
  expect(screen.getByRole("textbox", { name: "Número de tarjeta" })).toHaveValue(card.member_code);
  expect(screen.getByRole("progressbar", { name: "Progreso de tu recompensa" })).toHaveAttribute("value", "10");
  expect(screen.getByText("Te faltan 10 puntos.")).toBeVisible();
  expect(screen.queryByText("Disponible para ti")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copiar número de tarjeta" }));
  expect(await screen.findByText("Número seleccionado. Cópialo y compártelo con el equipo al pagar.")).toHaveAttribute("role", "status");
  expect(screen.getByRole("textbox", { name: "Número de tarjeta" })).toHaveFocus();
  expect((await axe(container, { runOnly: ["region", "label", "button-name", "heading-order"] })).violations).toEqual([]);
});

it("marks an earned reward as available without redeeming it or promising an automatic payment", () => {
  render(<LoyaltyCardScreen data={{ ...card, balance: 25 }} onRefresh={vi.fn()} />);
  expect(screen.getByText("Disponible para ti")).toBeVisible();
  expect(screen.getByText("Solicítala al equipo para aplicarla al completar tu compra.")).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "Progreso de tu recompensa" })).toHaveAttribute("value", "20");
  expect(screen.queryByRole("button", { name: /Canjear|Pagar/ })).not.toBeInTheDocument();
});

it.each([{ balance: 10, progress: 8 }, { balance: -2, progress: 0 }])("keeps the actual $balance balance while limiting reward progress to $progress of 8", ({ balance, progress }) => {
  render(<LoyaltyCardScreen data={{ ...card, balance, reward: { ...card.reward!, points_cost: 8 } }} onRefresh={vi.fn()} />);
  expect(screen.getByLabelText("Tus puntos")).toHaveTextContent(String(balance));
  expect(screen.getByText(`${progress} de 8 puntos`)).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "Progreso de tu recompensa" })).toHaveAttribute("value", String(progress));
  if (balance >= 8) expect(screen.getByText("Disponible para ti")).toBeVisible();
  else {
    expect(screen.queryByText("Disponible para ti")).not.toBeInTheDocument();
    expect(screen.getByText(/Las devoluciones o anulaciones redujeron tus puntos/)).toBeVisible();
  }
});

it("keeps availability neutral while reversals are pending, even if the current balance reaches the goal", () => {
  render(<LoyaltyCardScreen data={{ ...card, balance: 25, adjustments_pending: true }} onRefresh={vi.fn()} />);
  expect(screen.queryByText("Disponible para ti")).not.toBeInTheDocument();
  expect(screen.getByText("Consulta tu saldo con el equipo antes de canjear.")).toBeVisible();
  expect(screen.getByText(/El saldo puede cambiar/)).toBeVisible();
});

it("does not invent a member code or a reward for legacy cards", () => {
  render(<LoyaltyCardScreen data={{ ...card, member_code: undefined, reward: null }} onRefresh={vi.fn()} />);
  expect(screen.queryByRole("textbox", { name: "Número de tarjeta" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Tu próxima recompensa" })).not.toBeInTheDocument();
});

it("explains device-cookie access separately from the expiring shared link", () => {
  render(<LoyaltyCardScreen data={card} accessMode="device" onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByText("Cómo funciona tu tarjeta"));
  expect(screen.getByText(/Puedes volver a consultar esta tarjeta desde este navegador hasta/)).toBeVisible();
  expect(screen.queryByText(/El enlace vence el/)).not.toBeInTheDocument();
});

it("presents a local QR first and reveals the number only as an explicit alternative", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHbkAAAAASUVORK5CYII=";
  render(<LoyaltyCardScreen data={{ ...card, member_qr_data_url: png }} onRefresh={vi.fn()} />);
  expect(screen.getByAltText("Tu tarjeta para presentar en caja")).toBeVisible();
  expect(screen.getByAltText("Tu tarjeta para presentar en caja")).toHaveAttribute("src", png);
  expect(screen.getByLabelText("Número de tarjeta")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Copiar número de tarjeta" })).not.toBeVisible();
  fireEvent.click(screen.getByText("Usar número de tarjeta"));
  expect(screen.getByRole("textbox", { name: "Número de tarjeta" })).toHaveValue(card.member_code);
});
it.each(["https://example.invalid/qr.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA", `data:image/png;base64,iVBORw0KGgo${"A".repeat(32768)}`])("does not render an external, non-PNG or oversized QR image", value => {
  render(<LoyaltyCardScreen data={{ ...card, member_qr_data_url: value }} onRefresh={vi.fn()} />);
  expect(screen.queryByAltText("Tu tarjeta para presentar en caja")).not.toBeInTheDocument();
});
