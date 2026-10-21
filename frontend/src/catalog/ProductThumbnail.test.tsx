import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProductThumbnail } from "./ProductThumbnail";

const product = {
  name: "Pan de nuez",
  image_url: "/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123",
  image_position_x: 20,
  image_position_y: 70,
  image_zoom: 1.5,
};

it("requests a thumbnail matching its rendered size, preserving the uploaded framing", () => {
  render(<ProductThumbnail product={product} />);
  const image = screen.getByRole("img", { name: "Imagen de Pan de nuez" });
  expect(image).toHaveAttribute("src", `${product.image_url}&w=160`);
  expect(image).toHaveAttribute("srcset", expect.stringContaining("w=320 320w"));
  expect(image).toHaveAttribute("sizes", "(min-width: 1024px) 44px, 48px");
  expect(image).toHaveAttribute("width", "48");
  expect(image).toHaveAttribute("height", "48");
  expect(image).toHaveStyle({ objectPosition: "20% 70%", transform: "scale(1.5)" });
  expect(screen.getByText("Cargando fotografía de Pan de nuez")).toBeInTheDocument();
  fireEvent.load(image);
  expect(screen.queryByText("Cargando fotografía de Pan de nuez")).not.toBeInTheDocument();
});

it("retries the same revision on explicit request without opening the product editor", () => {
  const edit = vi.fn();
  // Model CatalogView's pointer-only row shortcut to verify that retry does
  // not bubble into it; the real row also has a labelled Editar button.
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
  render(<div onClick={edit}><ProductThumbnail product={product} /></div>);
  const original = screen.getByRole("img");
  fireEvent.error(original);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: "Volver a cargar la foto de Pan de nuez" });
  expect(retry).toHaveAttribute("type", "button");
  fireEvent.click(retry);
  const image = screen.getByRole("img");
  expect(image).not.toBe(original);
  expect(image).toHaveAttribute("src", `${product.image_url}&w=160`);
  expect(edit).not.toHaveBeenCalled();
  fireEvent.load(image);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("resets a previous failure after replacement and distinguishes products without photos", () => {
  const view = render(<ProductThumbnail product={product} />);
  fireEvent.error(screen.getByRole("img"));
  view.rerender(<ProductThumbnail product={{ ...product, image_url: product.image_url.replace("123", "124") }} />);
  expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("v=124&w=160"));
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  view.rerender(<ProductThumbnail product={{ ...product, image_url: null }} />);
  expect(screen.getByText("Sin fotografía")).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
