import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegisterProductPhoto } from "./RegisterProductPhoto";

const product = { image_url: "/api/v1/catalog/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image?v=123",
  image_position_x: 25, image_position_y: 70, image_zoom: 1.5 };
const observers: { target: Element; intersect: (visible: boolean) => void; disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn();
    constructor(private callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      expect(options).toEqual({ rootMargin: "0px", threshold: 0 });
    }
    observe(target: Element) {
      observers.push({ target, disconnect: this.disconnect,
        intersect: visible => this.callback([{ target, isIntersecting: visible } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver) });
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

it("does not mount a source before entering the viewport and admits each photo independently", () => {
  const { container } = render(<><RegisterProductPhoto product={product} /><RegisterProductPhoto product={product} /></>);
  expect(container.querySelector("img")).toBeNull();
  act(() => observers[0].intersect(false));
  expect(container.querySelector("img")).toBeNull();
  act(() => observers[0].intersect(true));
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(observers[0].disconnect).toHaveBeenCalled();
  const image = container.querySelector("img")!;
  expect(image).toHaveAttribute("src", `${product.image_url}&w=400`);
  expect(image).toHaveAttribute("srcset", expect.stringContaining("w=160 160w"));
  expect(image).toHaveAttribute("fetchpriority", "low");
  expect(image).toHaveAttribute("sizes", "(max-width: 639px) 42vw, (max-width: 1279px) 22vw, 200px");
  expect(image).toHaveStyle({ objectPosition: "25% 70%", transform: "scale(1.5)" });
  expect(image.closest('[aria-hidden="true"]')).not.toBeNull();
  fireEvent.load(image);
  act(() => observers[0].intersect(false));
  expect(container.querySelector("img")).toBe(image);
});

it("keeps the photo height bounded and full-width before or after admission", () => {
  const { container } = render(<RegisterProductPhoto product={product} />);
  const wrapper = container.firstElementChild!;
  expect(wrapper).toHaveClass("h-20", "w-full", "shrink-0", "overflow-hidden");
  act(() => observers[0].intersect(true));
  expect(container.firstElementChild).toBe(wrapper);
  expect(container.querySelector("img")).toHaveAttribute("width", "400");
  expect(container.querySelector("img")).toHaveAttribute("height", "400");
});

it("keeps honest errors decorative and re-observes a new revision without stale requests", () => {
  const view = render(<RegisterProductPhoto product={product} />);
  act(() => observers[0].intersect(true));
  fireEvent.error(view.container.querySelector("img")!);
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.querySelector("button")).toBeNull();
  view.rerender(<RegisterProductPhoto product={{ ...product, image_url: product.image_url.replace("123", "124") }} />);
  expect(view.container.querySelector("img")).toBeNull();
  act(() => observers[1].intersect(true));
  expect(view.container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("v=124&w=400"));
  view.unmount();
  expect(observers[1].disconnect).toHaveBeenCalled();
});

it("falls back to browser lazy loading when IntersectionObserver is unavailable", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { container } = render(<RegisterProductPhoto product={product} />);
  expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  expect(container.querySelector("img")).toHaveAttribute("decoding", "async");
  expect(container.querySelector("img")).toHaveAttribute("alt", "");
});


it("handles a missing photo as decoration without waiting or observing", () => {
  const { container } = render(<RegisterProductPhoto product={{ ...product, image_url: null }} />);
  expect(observers).toHaveLength(0);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("svg.lucide-package")).not.toBeNull();
  expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
});
