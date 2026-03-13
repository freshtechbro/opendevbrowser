import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANVAS_SURFACE_TOKENS, CANVAS_SURFACE_TOKEN_VARIABLES } from "../src/canvas/surface-palette";

const canvasHtml = readFileSync(new URL("../extension/canvas.html", import.meta.url), "utf8");

describe("extension canvas shell", () => {
  it("keeps the design stage on the shared canvas surface palette", () => {
    expect(canvasHtml).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.background}: ${CANVAS_SURFACE_TOKENS.background};`);
    expect(canvasHtml).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.text}: ${CANVAS_SURFACE_TOKENS.text};`);
    expect(canvasHtml).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.grid}: ${CANVAS_SURFACE_TOKENS.grid};`);
    expect(canvasHtml).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.accent}: ${CANVAS_SURFACE_TOKENS.accent};`);
    expect(canvasHtml).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.accentStrong}: ${CANVAS_SURFACE_TOKENS.accentStrong};`);
    expect(canvasHtml).toContain(`linear-gradient(var(${CANVAS_SURFACE_TOKEN_VARIABLES.grid}) 1px, transparent 1px)`);
    expect(canvasHtml).toContain(`color: var(${CANVAS_SURFACE_TOKEN_VARIABLES.text});`);
  });
});
