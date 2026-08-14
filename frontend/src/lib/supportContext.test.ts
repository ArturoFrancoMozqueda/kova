import { afterEach, describe, expect, it } from "vitest";
import { captureApiRequestId, clearLatestRequestId, getLatestRequestId } from "./supportContext";

describe("support request context", () => {
  afterEach(clearLatestRequestId);

  it("keeps only a safe request id from Kova API responses", () => {
    captureApiRequestId(
      "/api/v1/catalog/products",
      new Response(null, { headers: { "x-request-id": "91a4d81f-2c2b-4f45-89bb-aabc12345678" } }),
    );

    expect(getLatestRequestId()).toBe("91a4d81f-2c2b-4f45-89bb-aabc12345678");
  });

  it("ignores third-party responses and unsafe reflected values", () => {
    captureApiRequestId(
      "https://example.com/api/status",
      new Response(null, { headers: { "x-request-id": "third-party" } }),
    );
    captureApiRequestId(
      "/api/v1/catalog/products",
      new Response(null, { headers: { "x-request-id": "unsafe reflected value" } }),
    );

    expect(getLatestRequestId()).toBeNull();
  });

  it("accepts an absolute same-origin API URL", () => {
    captureApiRequestId(
      `${window.location.origin}/api/v1/health`,
      new Response(null, { headers: { "x-request-id": "same-origin-123" } }),
    );

    expect(getLatestRequestId()).toBe("same-origin-123");
  });
});
