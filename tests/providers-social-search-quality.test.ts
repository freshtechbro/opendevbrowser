import { describe, expect, it } from "vitest";
import {
  detectSocialSearchShell,
  isAllowedSocialSearchExpansionUrl,
  isFirstPartySocialSearchRoute,
  prioritizeSocialSearchLinks,
  selectUsableSocialSearchLinks
} from "../src/providers/social/search-quality";

describe("social search quality helpers", () => {
  it("treats facebook watch search routes as shells until a concrete content url exists", () => {
    const baseUrl = "https://www.facebook.com/watch/search/?q=browser+automation";
    const watchUrl = "https://www.facebook.com/watch/?v=123456789012345";
    const reelUrl = "https://www.facebook.com/reel/123456789012345";
    const links = [baseUrl, watchUrl, reelUrl];

    expect(isFirstPartySocialSearchRoute("facebook", baseUrl)).toBe(true);
    expect(detectSocialSearchShell("facebook", {
      url: baseUrl,
      content: "Explore the latest browser automation videos in Video."
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(detectSocialSearchShell("facebook", {
      url: baseUrl,
      content: "Explore the latest browser automation videos in Video.",
      links: [watchUrl]
    })).toBeNull();
    expect(isAllowedSocialSearchExpansionUrl("facebook", baseUrl)).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("facebook", "https://www.facebook.com/public/browser-automation")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("facebook", watchUrl)).toBe(true);
    expect(prioritizeSocialSearchLinks("facebook", baseUrl, links)).toEqual([
      watchUrl,
      reelUrl,
      baseUrl
    ]);
    expect(selectUsableSocialSearchLinks("facebook", baseUrl, links)).toEqual([
      watchUrl,
      reelUrl
    ]);
  });

  it("accepts bare and mobile facebook hosts only when they point at concrete content urls", () => {
    const baseUrl = "https://m.facebook.com/watch/search/?q=browser+automation";

    expect(detectSocialSearchShell("facebook", {
      url: "https://facebook.com/login",
      content: "Log into Facebook"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
    expect(isAllowedSocialSearchExpansionUrl("facebook", "https://m.facebook.com/watch")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("facebook", "https://facebook.com/reg/")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("facebook", "https://facebook.com/recover/initiate")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("facebook", "https://m.facebook.com/site.webmanifest")).toBe(false);
    expect(isAllowedSocialSearchExpansionUrl("facebook", "notaurl")).toBe(false);
    expect(selectUsableSocialSearchLinks("facebook", baseUrl, [
      "https://facebook.com/story.php?story_fbid=123&id=456",
      "https://m.facebook.com/share/v/123456789012345/",
      "https://facebook.com/photo/?fbid=123"
    ])).toEqual([
      "https://facebook.com/story.php?story_fbid=123&id=456",
      "https://m.facebook.com/share/v/123456789012345/",
      "https://facebook.com/photo/?fbid=123"
    ]);
    expect(isAllowedSocialSearchExpansionUrl("facebook", "https://example.com/browser-automation")).toBe(true);
  });

  it("accepts populated facebook watch search pages when result markers survive but only profile links are exposed", () => {
    const baseUrl = "https://www.facebook.com/watch/search/?q=browser+automation+facebook&page=1";

    expect(detectSocialSearchShell("facebook", {
      url: baseUrl,
      content: "Top browser automation facebook videos Search results Shared with Public Open reel in Reels Viewer",
      links: [
        "/BradfordSCarlton",
        "/prince.okporu"
      ]
    })).toBeNull();
    expect(selectUsableSocialSearchLinks("facebook", baseUrl, [
      "/BradfordSCarlton",
      "/prince.okporu"
    ])).toEqual([]);
  });

  it("accepts populated facebook watch search pages without an explicit search heading when strong result markers and support links survive", () => {
    const baseUrl = "https://www.facebook.com/watch/search/?q=browser+automation+facebook&page=1";

    expect(detectSocialSearchShell("facebook", {
      url: baseUrl,
      content: "Top browser automation facebook videos Shared with Public Open reel in Reels Viewer",
      links: [
        "/BradfordSCarlton",
        "/prince.okporu"
      ]
    })).toBeNull();
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

  it("accepts x i/web/status links as usable first-party search evidence", () => {
    const baseUrl = "https://x.com/search?q=browser+automation";
    const recoveredStatusUrl = "https://x.com/i/web/status/1234567890";

    expect(detectSocialSearchShell("x", {
      url: baseUrl,
      content: "JavaScript is disabled in this browser",
      links: [recoveredStatusUrl]
    })).toBeNull();
    expect(selectUsableSocialSearchLinks("x", baseUrl, [
      "https://x.com/search",
      recoveredStatusUrl
    ])).toEqual([recoveredStatusUrl]);
  });

  it("treats concrete x status routes as usable while excluding analytics subpaths", () => {
    const baseUrl = "https://x.com/search?q=browser+automation";
    const statusUrl = "https://x.com/opendevbrowser/status/123";
    const analyticsUrl = "https://x.com/opendevbrowser/status/123/analytics";

    expect(detectSocialSearchShell("x", {
      url: statusUrl,
      content: "JavaScript is disabled in this browser",
      links: [statusUrl]
    })).toBeNull();
    expect(selectUsableSocialSearchLinks("x", baseUrl, [
      statusUrl,
      analyticsUrl
    ])).toEqual([statusUrl]);
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

  it("treats x help hosts, invalid urls, and login-flow roots as unusable search evidence", () => {
    const baseUrl = "https://x.com/search?q=browser+automation";

    expect(selectUsableSocialSearchLinks("x", baseUrl, [
      "notaurl",
      "https://help.x.com/en/using-x",
      "https://x.com/i/flow/login"
    ])).toEqual([]);
    expect(detectSocialSearchShell("x", {
      url: "https://x.com/i/flow/login",
      content: "Sign in"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
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

  it("treats bluesky search routes and metadata urls as blocked expansion paths", () => {
    const baseUrl = "https://bsky.app/search?q=browser+automation";

    expect(selectUsableSocialSearchLinks("bluesky", baseUrl, [
      "https://bsky.app/search?q=browser+automation",
      "https://bsky.app/manifest.json",
      "https://bsky.app/profile/test.bsky.social/post/abc123"
    ])).toEqual(["https://bsky.app/profile/test.bsky.social/post/abc123"]);
  });

  it("keeps reddit search routes and blocked first segments out of usable search evidence", () => {
    const baseUrl = "https://www.reddit.com/search?q=browser+automation";

    expect(selectUsableSocialSearchLinks("reddit", baseUrl, [
      "https://www.reddit.com/search?q=browser+automation",
      "https://www.reddit.com/login/",
      "https://www.reddit.com/r/opendevbrowser/comments/123/example"
    ])).toEqual(["https://www.reddit.com/r/opendevbrowser/comments/123/example"]);
  });

  it("leaves non-targeted platform links untouched", () => {
    const links = [
      "https://www.youtube.com/watch?v=abc123def45",
      "notaurl"
    ];

    expect(isAllowedSocialSearchExpansionUrl("youtube", "notaurl")).toBe(true);
    expect(detectSocialSearchShell("youtube", {
      url: "https://www.youtube.com/results?search_query=test",
      content: "Please enable JavaScript"
    })).toBeNull();
    expect(prioritizeSocialSearchLinks("youtube", "https://www.youtube.com/results?search_query=test", links)).toEqual(links);
    expect(selectUsableSocialSearchLinks("youtube", "https://www.youtube.com/results?search_query=test", links)).toEqual(links);
  });

  it("keeps allowed non-content links behind concrete content evidence for targeted platforms", () => {
    const baseUrl = "https://www.facebook.com/watch/search/?q=browser+automation";

    expect(prioritizeSocialSearchLinks("facebook", baseUrl, [
      "https://example.com/browser-automation",
      "https://www.facebook.com/login",
      "https://www.facebook.com/watch/?v=123456789012345"
    ])).toEqual([
      "https://www.facebook.com/watch/?v=123456789012345",
      "https://example.com/browser-automation",
      "https://www.facebook.com/login"
    ]);
  });

  it("detects the empty logged-out bluesky search shell separately from javascript-required shells", () => {
    expect(detectSocialSearchShell("bluesky", {
      url: "https://bsky.app/search?q=browser+automation",
      content: "Follow 10 people to get started"
    })).toMatchObject({
      providerShell: "social_render_shell"
    });
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
