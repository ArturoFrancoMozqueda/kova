import { afterEach, describe, expect, it, vi } from "vitest";

import { apiErrorDetailText, resolveApiErrorMessage } from "./apiError";
import { copy } from "@/i18n/messages";

class FakeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const FALLBACK = "FALLBACK_MESSAGE";

describe("resolveApiErrorMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the network message when fetch rejects with a TypeError", () => {
    expect(resolveApiErrorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(
      copy.errors.network,
    );
  });

  it("returns the network message when the browser reports offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(resolveApiErrorMessage(new FakeApiError("nope", 500), FALLBACK)).toBe(
      copy.errors.network,
    );
  });

  it("returns the permission message for a 403", () => {
    expect(resolveApiErrorMessage(new FakeApiError("forbidden", 403), FALLBACK)).toBe(
      copy.errors.permission,
    );
  });

  it("returns the server message for 5xx", () => {
    expect(resolveApiErrorMessage(new FakeApiError("boom", 503), FALLBACK)).toBe(
      copy.errors.server,
    );
  });

  it("keeps the module fallback for other statuses (e.g. 422)", () => {
    expect(resolveApiErrorMessage(new FakeApiError("invalid", 422), FALLBACK)).toBe(FALLBACK);
  });

  it("keeps the module fallback for unknown errors", () => {
    expect(resolveApiErrorMessage(new Error("???"), FALLBACK)).toBe(FALLBACK);
  });

  it("reads an actionable FastAPI string detail without returning other fields", () => {
    const error = new FakeApiError(
      JSON.stringify({ detail: "Faltan columnas: precio", internal: "do-not-show" }),
      400,
    );
    expect(apiErrorDetailText(error)).toBe("Faltan columnas: precio");
  });
});
