import { describe, expect, it } from "vitest";
import { isLikelyDocumentUrl } from "../src/providers/shared/traversal-url";

describe("provider traversal url filter", () => {
  it("accepts normal http(s) document urls", () => {
    expect(isLikelyDocumentUrl("https://example.com/articles/opendevbrowser")).toBe(true);
    expect(isLikelyDocumentUrl("http://example.com/path/to/page")).toBe(true);
  });

  it("rejects non-http protocols and malformed urls", () => {
    expect(isLikelyDocumentUrl("ftp://example.com/file")).toBe(false);
    expect(isLikelyDocumentUrl("not-a-url")).toBe(false);
  });

  it("rejects static asset hosts used in anti-bot walls", () => {
    expect(isLikelyDocumentUrl("https://www.redditstatic.com/challenge.js")).toBe(false);
    expect(isLikelyDocumentUrl("https://abs.twimg.com/responsive-web/client-web/main.js")).toBe(false);
  });

  it("rejects static asset file extensions", () => {
    expect(isLikelyDocumentUrl("https://example.com/assets/main.js")).toBe(false);
    expect(isLikelyDocumentUrl("https://example.com/assets/banner.webp")).toBe(false);
    expect(isLikelyDocumentUrl("https://example.com/docs/readme.txt")).toBe(false);
  });
});
