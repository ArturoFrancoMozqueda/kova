import { describe, expect, it } from "vitest";
import { catalogImportFingerprint } from "./importFingerprint";

describe("catalog import retry fingerprint", () => {
  it("hashes CSV bytes using the backend SHA-256 contract", async () => {
    expect(await catalogImportFingerprint(new File(["abc"], "catalogo.csv"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("uses content and format while ignoring filename, timestamp and browser media type", async () => {
    const first = await catalogImportFingerprint(new File(["Café,18"], "uno.csv", { lastModified: 1, type: "text/csv" }));
    const renamed = await catalogImportFingerprint(new File(["Café,18"], "dos.CSV", { lastModified: 2, type: "application/octet-stream" }));
    expect(renamed).toBe(first);
    expect(await catalogImportFingerprint(new File(["Café,19"], "uno.csv"))).not.toBe(first);
    expect(await catalogImportFingerprint(new File(["Café,18"], "uno.xlsx"))).not.toBe(first);
  });
});
