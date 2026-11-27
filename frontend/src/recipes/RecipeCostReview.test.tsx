import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import { RecipeCostReview } from "./RecipeCostReview";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

it("lists each ingredient once with a link to complete its cost", async () => {
  fetchMock.mockResolvedValue(json([{ ingredient_product_id: "milk", ingredient_name: "Leche entera", used_in: ["Capuchino", "Latte"] }]));
  render(<MemoryRouter><RecipeCostReview /></MemoryRouter>);
  expect(await screen.findByText("Leche entera")).toBeInTheDocument();
  expect(screen.getByText(copy.recipeCostReview.usedIn(["Capuchino", "Latte"]))).toBeInTheDocument();
  expect(screen.getByRole("link", { name: copy.recipeCostReview.complete })).toHaveAttribute("href", "/catalog?edit=milk");
});

it("says when every recipe has its costs and never shows an error as empty", async () => {
  fetchMock.mockResolvedValueOnce(json([]));
  const { unmount } = render(<MemoryRouter><RecipeCostReview /></MemoryRouter>);
  expect(await screen.findByText(copy.recipeCostReview.empty)).toBeInTheDocument();
  unmount();
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  render(<MemoryRouter><RecipeCostReview /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent(copy.recipeCostReview.loadError);
});
