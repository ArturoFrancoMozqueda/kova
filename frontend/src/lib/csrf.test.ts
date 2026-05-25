import { afterEach, describe, expect, it } from "vitest";

import { CSRF_HEADER, csrfHeaders, readCsrfCookie } from "./csrf";

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0`;
}

describe("csrfHeaders", () => {
  afterEach(() => {
    clearCookie("csrf_token");
  });

  it("returns the X-CSRF-Token header for unsafe methods when cookie is present", () => {
    setCookie("csrf_token", "abc123");
    expect(csrfHeaders("POST")).toEqual({ [CSRF_HEADER]: "abc123" });
    expect(csrfHeaders("put")).toEqual({ [CSRF_HEADER]: "abc123" });
    expect(csrfHeaders("PATCH")).toEqual({ [CSRF_HEADER]: "abc123" });
    expect(csrfHeaders("DELETE")).toEqual({ [CSRF_HEADER]: "abc123" });
  });

  it("returns an empty object for safe methods", () => {
    setCookie("csrf_token", "abc123");
    expect(csrfHeaders("GET")).toEqual({});
    expect(csrfHeaders("HEAD")).toEqual({});
    expect(csrfHeaders(undefined)).toEqual({});
  });

  it("returns an empty object when no cookie is present", () => {
    clearCookie("csrf_token");
    expect(csrfHeaders("POST")).toEqual({});
  });

  it("readCsrfCookie returns null when no cookie is set", () => {
    clearCookie("csrf_token");
    expect(readCsrfCookie()).toBeNull();
  });

  it("readCsrfCookie returns the cookie value when set", () => {
    setCookie("csrf_token", "xyz");
    expect(readCsrfCookie()).toBe("xyz");
  });
});
