import { describe, expect, it } from "vitest";
import { productImageStyle } from "./imageUrl";

describe("productImageStyle", () => {
  it("uses saved image focus coordinates", () => {
    expect(productImageStyle({ image_position_x: 35, image_position_y: 70 })).toEqual({
      objectFit: "cover",
      objectPosition: "35% 70%",
    });
  });

  it("falls back to centered positioning", () => {
    expect(productImageStyle({ image_position_x: undefined, image_position_y: undefined })).toEqual({
      objectFit: "cover",
      objectPosition: "50% 50%",
    });
  });
});
