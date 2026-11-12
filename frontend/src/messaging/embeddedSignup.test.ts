import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { launchMetaSignup, type MetaSdk } from "./embeddedSignup";

let callback: Parameters<MetaSdk["login"]>[0];
let sdk: MetaSdk;
const finish = vi.fn();
const failed = vi.fn();
const assets = { waba_id: "987", phone_number_id: "654" };
const message = (origin: string, event = "FINISH", data = assets) => window.dispatchEvent(
  new MessageEvent("message", { origin, data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data }) }),
);
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  sdk = { init: vi.fn(), login: vi.fn(value => { callback = value; }) };
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

it("requires both a code and exact-origin assets, in either callback order", () => {
  const cleanup = launchMetaSignup(sdk, "456", finish, failed);
  message("https://www.facebook.com.evil.invalid");
  message("https://evilfacebook.com");
  callback({ authResponse: { code: "synthetic-code" } });
  expect(finish).not.toHaveBeenCalled();
  message("https://www.facebook.com");
  expect(finish).toHaveBeenCalledExactlyOnceWith({ ...assets, event: "FINISH", code: "synthetic-code" });
  message("https://web.facebook.com");
  expect(finish).toHaveBeenCalledTimes(1);
  cleanup();

  finish.mockClear();
  const second = launchMetaSignup(sdk, "456", finish, failed);
  message("https://web.facebook.com");
  expect(finish).not.toHaveBeenCalled();
  callback({ authResponse: { code: "second-code" } });
  expect(finish).toHaveBeenCalledExactlyOnceWith({ ...assets, event: "FINISH", code: "second-code" });
  second();
});

it("does not complete coexistence, account-only flows, cancellation or missing numbers", () => {
  for (const event of ["FINISH_ONLY_WABA", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "CANCEL", "ERROR"]) {
    const cleanup = launchMetaSignup(sdk, "456", finish, failed);
    message("https://www.facebook.com", event);
    callback({ authResponse: { code: "synthetic-code" } });
    expect(finish).not.toHaveBeenCalled();
    cleanup();
  }
  expect(failed).toHaveBeenCalledTimes(4);
});

it("expires incomplete codes quickly and removes listeners when branch scope unmounts", () => {
  let cleanup = launchMetaSignup(sdk, "456", finish, failed);
  callback({ authResponse: { code: "synthetic-code" } });
  vi.advanceTimersByTime(10_000);
  expect(failed).toHaveBeenCalledExactlyOnceWith("incomplete");
  message("https://www.facebook.com");
  expect(finish).not.toHaveBeenCalled();
  cleanup();
  failed.mockClear();
  cleanup = launchMetaSignup(sdk, "456", finish, failed);
  cleanup();
  message("https://www.facebook.com"); callback({ authResponse: { code: "late-code" } });
  vi.advanceTimersByTime(300_000);
  expect(finish).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});
