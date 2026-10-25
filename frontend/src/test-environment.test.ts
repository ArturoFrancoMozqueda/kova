import { describe, expect, it, vi } from "vitest";

// Use the real globals supplied by the locked Vitest/jsdom environment. Replacing
// only AbortController can make Request work while breaking DOM event cleanup.
describe("DOM and Fetch cancellation compatibility", () => {
  it("preserves the POST body and abort reason across Request clones", async () => {
    const controller = new AbortController();
    const body = JSON.stringify({ operation: "environment-contract" });
    const request = new Request("https://example.invalid/api", {
      method: "POST",
      body,
      signal: controller.signal,
    });
    const clone = request.clone();

    expect(await request.text()).toBe(body);
    expect(await clone.text()).toBe(body);
    expect(request.signal.aborted).toBe(false);
    expect(clone.signal.aborted).toBe(false);

    const reason = new Error("The operation was cancelled");
    controller.abort(reason);
    for (const signal of [request.signal, clone.signal]) {
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe(reason);
    }
  });

  it("removes a DOM listener when the same global controller is aborted", () => {
    const controller = new AbortController();
    const target = document.createElement("button");
    const listener = vi.fn();
    target.addEventListener("click", listener, { signal: controller.signal });
    target.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledOnce();

    controller.abort();
    target.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps an already-cancelled Request and its clone cancelled", () => {
    const controller = new AbortController();
    const reason = new Error("Cancelled before construction");
    controller.abort(reason);
    const request = new Request("https://example.invalid/api", {
      signal: controller.signal,
    });
    for (const signal of [request.signal, request.clone().signal]) {
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe(reason);
    }
  });
});
