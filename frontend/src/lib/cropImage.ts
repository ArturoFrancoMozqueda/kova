type ImageFraming = {
  positionX: number;
  positionY: number;
  zoom: number;
};

type CoverCrop = {
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
  originX: number;
  originY: number;
};

const OUTPUT_SIZE = 512;
const OUTPUT_TYPE = "image/webp";
const OUTPUT_QUALITY = 0.9;

export async function cropImageToSquare(file: File, framing: ImageFraming): Promise<File> {
  const bitmap = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new Error("Could not prepare logo crop");
  }

  const { renderedWidth, renderedHeight, offsetX, offsetY, originX, originY } =
    calculateCoverCrop(bitmap.width, bitmap.height, OUTPUT_SIZE, framing);

  context.translate(originX, originY);
  context.scale(framing.zoom, framing.zoom);
  context.translate(-originX, -originY);
  context.drawImage(bitmap, offsetX, offsetY, renderedWidth, renderedHeight);
  bitmap.close?.();

  const blob = await canvasToBlob(canvas, OUTPUT_TYPE, OUTPUT_QUALITY);
  if (!blob) throw new Error("Could not export logo crop");
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.webp`, { type: OUTPUT_TYPE, lastModified: Date.now() });
}

export function calculateCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  outputSize: number,
  framing: ImageFraming,
): CoverCrop {
  const coverScale = Math.max(outputSize / sourceWidth, outputSize / sourceHeight);
  const renderedWidth = sourceWidth * coverScale;
  const renderedHeight = sourceHeight * coverScale;
  return {
    renderedWidth,
    renderedHeight,
    offsetX: (outputSize - renderedWidth) * (framing.positionX / 100),
    offsetY: (outputSize - renderedHeight) * (framing.positionY / 100),
    originX: outputSize * (framing.positionX / 100),
    originY: outputSize * (framing.positionY / 100),
  };
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode image"));
      image.src = url;
    }) as unknown as ImageBitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
