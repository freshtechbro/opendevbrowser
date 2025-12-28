import { describe, it, expect } from "vitest";
import { extractCss } from "../src/export/css-extract";
import { emitReactComponent } from "../src/export/react-emitter";

const capture = {
  html: "<div id=\"root\">Hello</div>",
  styles: {
    color: "red",
    "font-size": "16px"
  },
  warnings: []
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
    expect(result.warnings).toBeUndefined();
  });

  it("adds warning comment for unsafe export", () => {
    const result = emitReactComponent(capture, ".opendevbrowser-root {}\n", { allowUnsafeExport: true });
    expect(result.component).toContain("Unsafe export enabled");
    expect(result.warnings?.[0]).toContain("Unsafe export enabled");
  });
});
