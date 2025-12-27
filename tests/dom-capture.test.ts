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
  });

  it("skips sanitization when sanitize is false", async () => {
    document.body.innerHTML = "<div id=\"root\"><script>alert(1)</script></div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root", { sanitize: false });

    expect(result.html).toContain("<script>");
  });

  it("sanitizes by default", async () => {
    document.body.innerHTML = "<div id=\"root\" onclick=\"alert(1)\">Hi</div>";
    const page = createPage();
    const result = await captureDom(page as never, "#root");

    expect(result.html).not.toContain("onclick");
  });
});
