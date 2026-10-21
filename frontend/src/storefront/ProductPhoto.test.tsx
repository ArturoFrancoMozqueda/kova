import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProductPhoto } from "./ProductPhoto";

const product = {
  name: "Pan de nuez",
  image_url: "/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123",
  image_position_x: 20,
  image_position_y: 70,
  image_zoom: 1.5,
};

it("shows the uploaded version with responsive sizes and the saved product framing", () => {
  render(<ProductPhoto product={product} />);
  const photo = screen.getByRole("img", { name: "Pan de nuez" });
  expect(photo).toHaveAttribute("src", `${product.image_url}&w=400`);
  expect(photo).toHaveAttribute("srcset", expect.stringContaining(`${product.image_url}&w=800 800w`));
  expect(photo).toHaveAttribute("sizes", expect.stringMatching(/^auto,/));
  expect(photo).toHaveAttribute("loading", "lazy");
  expect(photo).toHaveAttribute("decoding", "async");
  expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(photo).toHaveStyle({ objectFit: "cover", objectPosition: "20% 70%", transform: "scale(1.5)" });
  expect(screen.getByText("Cargando fotografía…")).toBeVisible();
  fireEvent.load(photo);
  expect(screen.queryByText("Cargando fotografía…")).not.toBeInTheDocument();
});

it("uses honest missing/error states and retries a newly uploaded revision", () => {
  const view = render(<ProductPhoto product={{ name: product.name }} />);
  expect(screen.getByText("Sin fotografía")).toBeVisible();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  view.rerender(<ProductPhoto product={product} />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("Fotografía no disponible")).toBeVisible();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  view.rerender(<ProductPhoto product={{ ...product, image_url: product.image_url.replace("123", "124") }} />);
  expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("v=124&w=400"));
  expect(screen.queryByText("Fotografía no disponible")).not.toBeInTheDocument();
});

it("publisher thumbnails request small images and do not repeat the adjacent product name", () => {
  const { container } = render(<ProductPhoto product={product} compact />);
  const photo = container.querySelector("img");
  expect(photo).toHaveAttribute("src", `${product.image_url}&w=160`);
  expect(photo).toHaveAttribute("sizes", "64px");
  expect(photo).toHaveAttribute("alt", "");
  expect(photo).toHaveAttribute("width", "64");
});
