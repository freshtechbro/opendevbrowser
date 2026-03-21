import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension popup branding", () => {
  it("uses the canonical OpenDevBrowser icon asset in the popup header", () => {
    const html = readFileSync("extension/popup.html", "utf8");

    expect(html).toContain('<img class="brand-mark" src="icons/icon32.png" alt="OpenDevBrowser logo" />');
    expect(html).not.toContain('<div class="brand-mark"></div>');
  });
});
