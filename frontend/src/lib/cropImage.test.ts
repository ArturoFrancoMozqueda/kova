import { describe, expect, it } from "vitest";

import { calculateCoverCrop } from "./cropImage";

describe("calculateCoverCrop", () => {
  it("centers a landscape image inside a square cover frame", () => {
    expect(calculateCoverCrop(1000, 500, 512, { positionX: 50, positionY: 50, zoom: 1 })).toEqual({
      renderedWidth: 1024,
      renderedHeight: 512,
      offsetX: -256,
      offsetY: 0,
      originX: 256,
      originY: 256,
    });
  });

  it("uses the selected focus point for the crop and zoom origin", () => {
    expect(calculateCoverCrop(1000, 500, 512, { positionX: 25, positionY: 75, zoom: 1.4 })).toEqual({
      renderedWidth: 1024,
      renderedHeight: 512,
      offsetX: -128,
      offsetY: 0,
      originX: 128,
      originY: 384,
    });
  });
});
