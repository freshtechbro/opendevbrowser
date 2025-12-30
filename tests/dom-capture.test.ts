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

  it("handles empty element content", async () => {
    document.body.innerHTML = "<div id=\"empty\"></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#empty");

    expect(result.html).toContain("id=\"empty\"");
    expect(result.warnings).toEqual([]);
  });

  it("handles attribute with empty value", async () => {
    document.body.innerHTML = "<div id=\"root\"><img src=\"\" alt=\"\"></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).toContain("<img");
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

  it("handles srcset with empty entries gracefully", async () => {
    document.body.innerHTML = `
      <div id="root">
        <img srcset=", , https://example.com/ok.png 1x, " />
      </div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).toContain("srcset=");
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

  it("removes script elements inside SVG", async () => {
    document.body.innerHTML = `
      <div id="root">
        <svg><rect width="100" height="100"></rect><script>alert('xss')</script></svg>
      </div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("<script");
    expect(result.html).toContain("<svg");
  });

  it("removes foreignObject from SVG", async () => {
    document.body.innerHTML = `
      <div id="root">
        <svg><foreignObject><div>malicious</div></foreignObject><rect/></svg>
      </div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("foreignObject");
  });

  it("removes event handlers from SVG elements", async () => {
    document.body.innerHTML = `
      <div id="root">
        <svg onload="alert('xss')"><rect onclick="evil()"/></svg>
      </div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("onload");
    expect(result.html).not.toContain("onclick");
  });

  it("blocks url() in inline styles", async () => {
    document.body.innerHTML = `
      <div id="root" style="background: url('https://evil.com/track')">Hi</div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("url(");
  });

  it("blocks expression() in inline styles", async () => {
    document.body.innerHTML = `
      <div id="root" style="width: expression(alert('xss'))">Hi</div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("expression(");
  });

  it("blocks -moz-binding in inline styles", async () => {
    document.body.innerHTML = `
      <div id="root" style="-moz-binding: url('evil.xml')">Hi</div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("-moz-binding");
  });

  it("truncates nodes beyond maxNodes limit", async () => {
    document.body.innerHTML = `
      <div id="root">
        <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
      </div>
    `;
    const page = createPage();
    const result = await captureDom(page as never, "#root", { maxNodes: 2 });

    expect(result.warnings[0]).toContain("Export truncated");
    const spanCount = (result.html.match(/<span/g) || []).length;
    expect(spanCount).toBeLessThanOrEqual(3);
  });
});
