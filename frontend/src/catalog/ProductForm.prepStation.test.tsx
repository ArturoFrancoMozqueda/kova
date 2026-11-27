import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";

const stations = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/prep/api", () => ({ listPrepStations: () => stations.list() }));
import { ProductForm } from "./CatalogView";

const renderForm = (onSubmit: (values: unknown) => Promise<void>) => render(
  <ToastProvider>
    <ProductForm categories={[]} availableModifierGroups={[]} defaultCategoryId={null} pending={false}
      onCancel={vi.fn()} onSubmit={onSubmit} />
  </ToastProvider>,
);

it("assigns the station that prepares a product sold at the counter", async () => {
  stations.list.mockResolvedValue([{ id: "bar", name: "Barra", alert_minutes: 8, position: 0, is_active: true }]);
  const onSubmit = vi.fn(async () => undefined);
  renderForm(onSubmit);
  fireEvent.change(screen.getByLabelText("Nombre del producto"), { target: { value: "Latte" } });
  fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "55.00" } });
  fireEvent.change(await screen.findByLabelText("Estación de preparación"), { target: { value: "bar" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prep_station_id: "bar" })));
});

it("leaves the field out when the business has no stations", async () => {
  stations.list.mockResolvedValue([]);
  const onSubmit = vi.fn<(values: unknown) => Promise<void>>(async () => undefined);
  renderForm(onSubmit);
  fireEvent.change(screen.getByLabelText("Nombre del producto"), { target: { value: "Galleta" } });
  fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "20.00" } });
  await waitFor(() => expect(stations.list).toHaveBeenCalled());
  expect(screen.queryByLabelText("Estación de preparación")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("prep_station_id");
});
