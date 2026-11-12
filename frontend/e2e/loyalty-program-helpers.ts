import type { Page } from "@playwright/test";

export async function openLoyaltyDesigner(page: Page, step: "accumulation" | "reward" | "review" = "accumulation") {
  await page.getByRole("button", { name: /^(Crear mi tarjeta|Editar tarjeta y programa)$/ }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  if (step !== "accumulation") await page.getByRole("button", { name: "Continuar", exact: true }).click();
  if (step === "review") await page.getByRole("button", { name: "Continuar", exact: true }).click();
}
