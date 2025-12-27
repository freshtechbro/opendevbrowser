import { describe, it, expect } from "vitest";
import { extractCss } from "../src/export/css-extract";
import { emitReactComponent } from "../src/export/react-emitter";
import { sanitizeHtml } from "../src/export/dom-capture";

const capture = {
  html: "<div id=\"root\">Hello</div>",
  styles: {
    color: "red",
    "font-size": "16px"
  }
};

describe("export helpers", () => {
  it("extracts css", () => {
    const css = extractCss(capture);
    expect(css).toContain(".opendevbrowser-root");
    expect(css).toContain("color: red");
  });

  it("emits react component", () => {
    const result = emitReactComponent(capture, ".opendevbrowser-root {}\n");
    expect(result.component).toContain("OpenDevBrowserComponent");
    expect(result.css).toContain("opendevbrowser-root");
  });
});

describe("sanitizeHtml", () => {
  it("removes script tags", () => {
    const html = '<div><script>alert("xss")</script><p>Safe</p></div>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<script");
    expect(result).toContain("<p>Safe</p>");
  });

  it("removes iframe tags", () => {
    const html = '<div><iframe src="evil.html"></iframe><span>Ok</span></div>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<iframe");
    expect(result).toContain("<span>Ok</span>");
  });

  it("removes event handler attributes", () => {
    const html = '<img src="x.png" onerror="alert(1)" onclick="foo()" />';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("onclick");
    expect(result).toContain("src=\"x.png\"");
  });

  it("removes javascript: URLs from href", () => {
    const html = '<a href="javascript:alert(1)">Click</a>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("javascript:");
    expect(result).toContain("<a");
    expect(result).toContain(">Click</a>");
  });

  it("removes data: URLs from src", () => {
    const html = '<img src="data:text/html,<script>alert(1)</script>" />';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("data:");
  });

  it("preserves safe content", () => {
    const html = '<div class="container"><p>Hello <strong>World</strong></p></div>';
    const result = sanitizeHtml(html);
    expect(result).toContain('<div class="container">');
    expect(result).toContain("<strong>World</strong>");
  });

  it("removes nested dangerous elements", () => {
    const html = '<div><div><script>bad</script></div><object data="x"></object></div>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<object");
  });
});
