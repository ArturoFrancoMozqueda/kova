import { describe, expect, it } from "vitest";
import { parse } from "fast-uri";

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
});
