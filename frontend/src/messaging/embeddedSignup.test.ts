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

it("does not complete unsupported account-only flows or cancellation", () => {
  for (const event of ["FINISH_ONLY_WABA", "CANCEL", "ERROR"]) {
    const cleanup = launchMetaSignup(sdk, "456", finish, failed);
    message("https://www.facebook.com", event);
    callback({ authResponse: { code: "synthetic-code" } });
    expect(finish).not.toHaveBeenCalled();
    cleanup();
  }
  expect(failed).toHaveBeenCalledTimes(3);
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


it("requests coexistence v4 and accepts Meta's account-only completion in either order", () => {
  for (const first of ["code", "event"]) {
    finish.mockClear();
    const cleanup = launchMetaSignup(sdk, "456", finish, failed);
    expect(vi.mocked(sdk.login).mock.lastCall?.[1].extras).toMatchObject({
      version: "v4", sessionInfoVersion: "3", featureType: "whatsapp_business_app_onboarding",
    });
    const event = () => window.dispatchEvent(new MessageEvent("message", {
      origin: "https://www.facebook.com", data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "987" } }),
    }));
    const code = () => callback({ authResponse: { code: "synthetic-app-code" } });
    if (first === "code") { code(); event(); } else { event(); code(); }
    expect(finish).toHaveBeenCalledExactlyOnceWith({ code: "synthetic-app-code", waba_id: "987",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" });
    cleanup();
  }
});

it("still requires a phone for standard signup and refuses malformed app asset IDs", () => {
  for (const data of [{ waba_id: "987" }, { waba_id: "987", phone_number_id: "invalid" }]) {
    const cleanup = launchMetaSignup(sdk, "456", finish, failed);
    window.dispatchEvent(new MessageEvent("message", { origin: "https://www.facebook.com",
      data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data }) }));
    callback({ authResponse: { code: "synthetic-code" } });
    expect(finish).not.toHaveBeenCalled();
    cleanup();
  }
});
