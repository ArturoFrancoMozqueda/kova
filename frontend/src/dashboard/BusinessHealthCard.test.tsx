import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { makeStory } from "@/reports/__fixtures__/story";
import { BusinessHealthCard } from "./BusinessHealthCard";
import { paymentsFromStory, summaryFromStory } from "./storyAdapters";

it.each([[1, 20], [7, 140]])("describes %s refund events across five orders without claiming a share of orders", (refundCount, expectedFrequency) => {
  const story = makeStory();
  const summary = { ...summaryFromStory(story), order_count: 5, refund_count: refundCount };
  render(<BusinessHealthCard summary={summary} yesterday={null} payments={paymentsFromStory(story)} lowStockCount={0} compareLabel="vs periodo anterior" />);
  expect(screen.getByText(`${expectedFrequency} eventos por cada 100 órdenes`)).toBeInTheDocument();
  expect(screen.getByText(`Se registraron ${expectedFrequency} eventos de devolución por cada 100 órdenes; conviene revisarlos.`)).toBeInTheDocument();
  expect(screen.queryByText(/% de las órdenes/)).not.toBeInTheDocument();
  expect(screen.getByText(/una orden puede tener varias devoluciones parciales/)).toBeInTheDocument();
});

it("retains the no-refunds explanation when there are no refund events", () => {
  const story = makeStory();
  render(<BusinessHealthCard summary={summaryFromStory(story)} yesterday={null} payments={paymentsFromStory(story)} lowStockCount={0} compareLabel="vs periodo anterior" />);
  expect(screen.getByText("Sin devoluciones en el periodo")).toBeInTheDocument();
  expect(screen.queryByText(/eventos por cada 100 órdenes/)).not.toBeInTheDocument();
});
