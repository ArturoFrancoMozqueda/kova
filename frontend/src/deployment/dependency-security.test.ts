import { describe, expect, it } from "vitest";
import uri from "fast-uri";

const { normalize, parse, resolve, serialize } = uri;

// Workbox's AJV dependency uses this parser while validating the PWA build.
// Keep the pinned override protected against GHSA-58mr-gqgx-xq4g: an opening
// bracket alone cannot turn an invalid reg-name into an accepted IP literal.
describe("build dependency URI validation", () => {
  it.each(["https://[evil.example/path", "http://[example.com/"])(
    "rejects an unterminated IP literal in %s",
    (url) => {
      expect(parse(url).error).toBe("URI host is malformed.");
    },
  );

  it.each(["https://kovasuite.com/", "http://[::1]:5174/"])(
    "keeps valid build URLs usable: %s",
    (url) => {
      expect(parse(url).error).toBeUndefined();
    },
  );

  it("does not promote an encoded scheme to an executable URL", () => {
    const input = "%6Aavascript:alert(1)";
    expect(parse(input).error).toBeDefined();
    expect(normalize(input)).not.toMatch(/^javascript:/i);
  });

  it("keeps a suffix path from becoming a scheme", () => {
    const output = serialize({ path: "javascript:alert(1)" }, { reference: "suffix" });
    expect(output).toBe("javascript%3Aalert(1)");
    expect(parse(output).scheme).toBeUndefined();
  });

  it.each(["https://a@b@evil.example/", "https://kovasuite.\tcom/"])(
    "rejects ambiguous authorities instead of silently rewriting %s",
    (input) => {
      expect(parse(input).error).toBeDefined();
    },
  );

  it.each(["../x", "a/../b"])(
    "preserves the destination of a normalized relative path: %s",
    (input) => {
      const base = "https://kovasuite.com/docs/page";
      expect(resolve(base, normalize(input))).toBe(resolve(base, input));
    },
  );
});
