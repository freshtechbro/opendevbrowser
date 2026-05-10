import { describe, expect, it } from "vitest";
import {
  isLikelyDocumentUrl,
  isLikelyResearchDestinationUrl
} from "../src/providers/shared/traversal-url";

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
    expect(isLikelyDocumentUrl("https://static.licdn.com/sc/h/1exdo4axa6eaw1jioxh1vu4fj")).toBe(false);
    expect(isLikelyDocumentUrl("https://i.ytimg.com/vi/abc123/hqdefault.jpg")).toBe(false);
    expect(isLikelyDocumentUrl("https://scontent-lax3-1.xx.fbcdn.net/v/t39.30808-6/asset")).toBe(false);
    expect(isLikelyDocumentUrl("https://scontent.cdninstagram.com/v/t51.2885-15/asset")).toBe(false);
  });

  it("rejects static asset file extensions", () => {
    expect(isLikelyDocumentUrl("https://example.com/assets/main.js")).toBe(false);
    expect(isLikelyDocumentUrl("https://example.com/assets/banner.webp")).toBe(false);
    expect(isLikelyDocumentUrl("https://example.com/docs/readme.txt")).toBe(false);
  });

  it("rejects research dead-end navigation urls without blocking article paths", () => {
    expect(isLikelyResearchDestinationUrl("https://example.com/articles/privacy-engineering")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/privacy/research-report")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/policy/analysis")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/legal/case-study")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/terms/browser-study")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://www.reddit.com/r/opendevbrowser/comments/123/example")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/research/search-quality")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/docs/auth")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/research/results/browser-automation")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://example.com/formal-verification/browser")).toBe(true);
    expect(isLikelyResearchDestinationUrl("https://www.google.com/search?q=browser+automation")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/search?q=browser+automation")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/results/browser-automation")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/results/query/browser-automation")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/verification")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/settings")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://www.reddit.com/login/")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://www.reddit.com/prefs/privacy")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/privacy/choices")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/privacy/choices/")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/privacychoices/")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/legal/privacy/")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/legal/terms")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/terms-of-service")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/policies/privacy-policy")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/cookie-policy")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/cookie-preferences")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/cookie-preferences/")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/consent/manage")).toBe(false);
    expect(isLikelyResearchDestinationUrl("https://example.com/choices")).toBe(false);
  });
});
