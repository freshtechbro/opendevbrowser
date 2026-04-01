import { describe, expect, it } from "vitest";
import {
  detectSocialSearchShell,
  isAllowedSocialSearchExpansionUrl,
  isFirstPartySocialSearchRoute,
  prioritizeSocialSearchLinks,
  selectUsableSocialSearchLinks
} from "../src/providers/social/search-quality";

describe("social search quality helpers", () => {
  it("passes through non-targeted platforms without shell gating", () => {
    const baseUrl = "https://www.facebook.com/search/top?q=browser+automation";
    const links = [
      "https://example.com/help",
      "https://www.facebook.com/posts/123"
    ];

    expect(isFirstPartySocialSearchRoute("facebook", baseUrl)).toBe(false);
    expect(detectSocialSearchShell("facebook", {
      url: baseUrl,
      content: "You need to enable JavaScript"
    })).toBeNull();
    expect(isAllowedSocialSearchExpansionUrl("facebook", "not-a-url")).toBe(true);
    expect(prioritizeSocialSearchLinks("facebook", baseUrl, links)).toEqual(links);
    expect(selectUsableSocialSearchLinks("facebook", baseUrl, links)).toEqual(links);
  });

  it("blocks reddit non-content routes while allowing non-primary-host and empty-path edge cases", () => {
    const baseUrl = "https://www.reddit.com/search?q=browser+automation";

    expect(isFirstPartySocialSearchRoute("reddit", baseUrl)).toBe(true);
    expect(isAllowedSocialSearchExpansionUrl("reddit", "https://www.reddit.com/search")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("reddit", "https://ads.reddit.com/campaign")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("reddit", "https://www.reddit.com////")).toBe(true);
    expect(isAllowedSocialSearchExpansionUrl("reddit", "https://example.com/reddit/thread")).toBe(true);
    expect(selectUsableSocialSearchLinks("reddit", baseUrl, [
      "https://support.reddithelp.com/hc/en-us/articles/verification",
      "https://www.reddit.com/r/opendevbrowser/comments/123/example",
      "https://example.com/reddit/thread",
      "https://www.reddit.com/answers/example?q=browser+automation"
    ])).toEqual([
      "https://www.reddit.com/r/opendevbrowser/comments/123/example"
    ]);
    expect(detectSocialSearchShell("reddit", {
      url: baseUrl,
      content: "Please wait for verification before continuing."
    })).toMatchObject({
      providerShell: "social_verification_wall"
    });
  });

  it("classifies x help hosts and invalid or static expansion urls as blocked", () => {
    expect(detectSocialSearchShell("x", {
      url: "https://developer.x.com/en/docs",
      content: "Developer documentation"
    })).toMatchObject({
      providerShell: "social_first_party_help_shell"
    });
    expect(isAllowedSocialSearchExpansionUrl("x", "https://%zz")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("x", "https://x.com/site.webmanifest")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("x", "https://x.com/opendevbrowser/status/123")).toBe(true);
  });

  it("requires real first-party x result links before suppressing javascript shells", () => {
    const baseUrl = "https://x.com/search?q=browser+automation";

    expect(detectSocialSearchShell("x", {
      url: baseUrl,
      content: "JavaScript is disabled in this browser",
      links: ["https://developer.x.com/en/docs"]
    })).toMatchObject({
      providerShell: "social_js_required_shell"
    });
    expect(detectSocialSearchShell("x", {
      url: baseUrl,
      content: "JavaScript is disabled in this browser",
      links: ["https://x.com/opendevbrowser/status/123"]
    })).toBeNull();
    expect(prioritizeSocialSearchLinks("x", baseUrl, [
      "https://developer.x.com/en/docs",
      "https://%zz",
      "https://x.com/opendevbrowser/status/123"
    ])).toEqual([
      "https://x.com/opendevbrowser/status/123",
      "https://developer.x.com/en/docs",
      "https://%zz"
    ]);
    expect(selectUsableSocialSearchLinks("x", baseUrl, [
      "https://developer.x.com/en/docs",
      "https://x.com/search",
      "https://x.com/opendevbrowser/status/123"
    ])).toEqual(["https://x.com/opendevbrowser/status/123"]);
  });

  it("treats x login flows and tos routes as blocked first-party shell urls", () => {
    expect(detectSocialSearchShell("x", {
      url: "https://x.com/i/flow/login",
      content: "Sign in to X"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(isAllowedSocialSearchExpansionUrl("x", "https://x.com/i/flow/login")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("x", "https://x.com/tos")).toBe(false);
    expect(selectUsableSocialSearchLinks("x", "https://x.com/search?q=browser+automation", [
      "https://mobile.x.com/opendevbrowser/status/123"
    ])).toEqual([]);
  });

  it("treats x root, login, and privacy routes as blocked first-party shells", () => {
    expect(detectSocialSearchShell("x", {
      url: "https://x.com/",
      content: "Home"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(detectSocialSearchShell("x", {
      url: "https://x.com/login",
      content: "Sign in to X"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(isAllowedSocialSearchExpansionUrl("x", "https://x.com/")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("x", "https://x.com/privacy")).toBe(false);
    expect(selectUsableSocialSearchLinks("x", "https://x.com/search?q=browser+automation", [
      "https://x.com/",
      "https://x.com/login",
      "https://x.com/privacy",
      "https://x.com/opendevbrowser/status/123"
    ])).toEqual(["https://x.com/opendevbrowser/status/123"]);
  });

  it("treats bluesky profile and feed links as shells until a post url exists", () => {
    const baseUrl = "https://bsky.app/search?q=browser+automation";

    expect(isFirstPartySocialSearchRoute("bluesky", baseUrl)).toBe(true);
    expect(isAllowedSocialSearchExpansionUrl("bluesky", "https://bsky.app/profile/test.bsky.social/feed/custom")).toBe(false);
    expect(detectSocialSearchShell("bluesky", {
      url: baseUrl,
      content: "All languages Top Latest People Feeds",
      links: [
        "https://bsky.app/profile/test.bsky.social",
        "https://bsky.app/profile/test.bsky.social/feed/custom"
      ]
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(detectSocialSearchShell("bluesky", {
      url: baseUrl,
      content: "Please enable JavaScript",
      links: ["https://bsky.app/profile/test.bsky.social/post/abc123"]
    })).toBeNull();
    expect(selectUsableSocialSearchLinks("bluesky", baseUrl, [
      "https://bsky.app/profile/test.bsky.social",
      "https://bsky.app/profile/test.bsky.social/feed/custom",
      "https://bsky.app/profile/test.bsky.social/post/abc123"
    ])).toEqual([
      "https://bsky.app/profile/test.bsky.social/post/abc123"
    ]);
  });

  it("ignores malformed and foreign-host bluesky evidence while keeping logged-out shells active", () => {
    const baseUrl = "https://bsky.app/search?q=browser+automation";

    expect(detectSocialSearchShell("bluesky", {
      url: baseUrl,
      content: "Search is currently unavailable when logged out",
      links: [
        "https://%zz",
        "https://example.com/profile/test.bsky.social/post/foreign"
      ]
    })).toMatchObject({
      providerShell: "social_js_required_shell"
    });
    expect(selectUsableSocialSearchLinks("bluesky", baseUrl, [
      "https://%zz",
      "https://example.com/profile/test.bsky.social/post/foreign",
      "https://bsky.app/profile/test.bsky.social/post/abc123"
    ])).toEqual(["https://bsky.app/profile/test.bsky.social/post/abc123"]);
    expect(detectSocialSearchShell("bluesky", {
      url: "https://bsky.app/login",
      content: "Log in"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
  });

  it("treats bluesky root and login routes as shells while keeping only post links usable", () => {
    const baseUrl = "https://bsky.app/search?q=browser+automation";

    expect(detectSocialSearchShell("bluesky", {
      url: "https://bsky.app/",
      content: "Bluesky"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(isAllowedSocialSearchExpansionUrl("bluesky", "https://bsky.app/login")).toBe(false);
    expect(prioritizeSocialSearchLinks("bluesky", baseUrl, [
      "https://bsky.app/login",
      "https://docs.bsky.app/docs",
      "https://bsky.app/profile/test.bsky.social/post/abc123"
    ])).toEqual([
      "https://bsky.app/profile/test.bsky.social/post/abc123",
      "https://bsky.app/login",
      "https://docs.bsky.app/docs"
    ]);
    expect(selectUsableSocialSearchLinks("bluesky", baseUrl, [
      "https://bsky.app/login",
      "https://docs.bsky.app/docs",
      "https://bsky.app/profile/test.bsky.social/post/abc123"
    ])).toEqual(["https://bsky.app/profile/test.bsky.social/post/abc123"]);
  });

  it("classifies root shells and bare first-party searches as render shells without usable evidence", () => {
    expect(detectSocialSearchShell("x", {
      url: "https://x.com/home",
      content: "Home"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(detectSocialSearchShell("reddit", {
      url: "https://www.reddit.com/search?q=browser+automation",
      content: "Search results",
      links: []
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
  });
});
