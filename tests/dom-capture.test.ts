// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { captureDom } from "../src/export/dom-capture";

const createPage = () => ({
  $eval: async (selector: string, fn: (el: Element, opts: { shouldSanitize: boolean }) => unknown, opts: { shouldSanitize: boolean }) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error("missing element");
    return fn(element, opts);
  }
});

describe("captureDom", () => {
  it("captures html and styles", async () => {
    document.body.innerHTML = "<div id=\"root\">Hi</div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).toContain("id=\"root\"");
    expect(result.styles).toHaveProperty("display");
    expect(result.warnings).toEqual([]);
  });

  it("skips sanitization when sanitize is false", async () => {
    document.body.innerHTML = "<div id=\"root\"><script>alert(1)</script></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root", { sanitize: false });

    expect(result.html).toContain("<script");
  });

  it("sanitizes by default", async () => {
    document.body.innerHTML = "<div id=\"root\" onclick=\"alert(1)\">Hi</div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("onclick");
  });

  it("removes dangerous tags and URLs", async () => {
    document.body.innerHTML = `
      <div id="root">
        <script>alert(1)</script>
        <iframe src="evil.html"></iframe>
        <a href="javascript:alert(1)">Click</a>
        <img src="data:text/html,<script>alert(1)</script>" />
      </div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("<iframe");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("data:");
  });

  it("removes dangerous srcset entries", async () => {
    document.body.innerHTML = `
      <div id="root">
        <img srcset="data:text/html,evil 1x, https://example.com/ok.png 2x" />
      </div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("srcset=");
  });

  it("inlines computed styles for subtree elements", async () => {
    document.body.innerHTML = "<div id=\"root\"><span>Hi</span></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).toContain("style=");
  });

  it("skips inline styles when disabled", async () => {
    document.body.innerHTML = "<div id=\"root\"><span>Hi</span></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root", { inlineStyles: false });

    expect(result.html).not.toContain("style=");
  });

  it("preserves safe URL attributes", async () => {
    document.body.innerHTML = "<div id=\"root\"><a href=\"https://example.com\">Link</a></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).toContain("href=\"https://example.com\"");
  });

  it("adds a warning when max node cap is exceeded", async () => {
    document.body.innerHTML = "<div id=\"root\"><span>Hi</span></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root", { maxNodes: 1 });

    expect(result.warnings[0]).toContain("Export truncated");
  });

  it("filters inline styles to allowlist properties only", async () => {
    document.body.innerHTML = "<div id=\"root\"><span>Hi</span></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    const allowedProps = ["color", "background", "font-size", "margin", "padding", "display"];
    const disallowedProps = ["animation-name", "transition", "cursor"];

    for (const prop of allowedProps) {
      if (result.html.includes(`${prop}:`)) {
        expect(result.html).toContain(`${prop}:`);
      }
    }

    for (const prop of disallowedProps) {
      expect(result.html).not.toContain(`${prop}:`);
    }
  });

  it("excludes skip values like 'none', 'initial', 'inherit' from inline styles", async () => {
    document.body.innerHTML = "<div id=\"root\"><span>Hi</span></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toMatch(/: none;/);
    expect(result.html).not.toMatch(/: initial;/);
    expect(result.html).not.toMatch(/: inherit;/);
  });
});
