import { describe, expect, it } from "vitest";
import { productImageStyle } from "./imageUrl";

describe("productImageStyle", () => {
  it("uses saved image focus coordinates", () => {
    expect(productImageStyle({ image_position_x: 35, image_position_y: 70 })).toEqual({
      objectFit: "cover",
      objectPosition: "35% 70%",
      transformOrigin: "35% 70%",
    });
  });

  it("falls back to centered positioning", () => {
    expect(productImageStyle({ image_position_x: undefined, image_position_y: undefined })).toEqual({
      objectFit: "cover",
      objectPosition: "50% 50%",
      transformOrigin: "50% 50%",
    });
  });

  it("applies scale transform when zoom is not 1", () => {
    expect(productImageStyle({ image_position_x: 35, image_position_y: 70, image_zoom: 2.0 })).toEqual({
      objectFit: "cover",
      objectPosition: "35% 70%",
      transformOrigin: "35% 70%",
      transform: "scale(2)",
    });
  });

  it("omits transform when zoom is 1", () => {
    const style = productImageStyle({ image_position_x: 35, image_position_y: 70, image_zoom: 1.0 });
    expect(style).not.toHaveProperty("transform");
  });
});
