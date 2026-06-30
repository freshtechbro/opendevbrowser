import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANVAS_SURFACE_TOKENS, CANVAS_SURFACE_TOKEN_VARIABLES } from "../src/canvas/surface-palette";

const canvasHtml = readFileSync(new URL("../extension/canvas.html", import.meta.url), "utf8");
const canvasPageSource = readFileSync(new URL("../extension/src/canvas-page.ts", import.meta.url), "utf8");

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

  it("declares the 4x2 agent workspace shell landmarks", () => {
    expect(canvasHtml).toContain("canvas-workspace-shell");
    expect(canvasHtml).toContain("canvas-workspace-coordinator");
    expect(canvasHtml).toContain("canvas-workspace-active-child");
    expect(canvasHtml).toContain("canvas-workspace-workers");
    expect(canvasHtml).toContain("canvas-workspace-activity");
    expect(canvasHtml).toContain("canvas-workspace-review");
    expect(canvasHtml).toContain("canvas-workspace-checkpoints");
    for (const state of ["delivered", "degraded", "paused", "conflict", "lease", "revision", "sync"]) {
      expect(canvasHtml).toContain(`data-workspace-state="${state}"`);
    }
  });

  it("keeps partial workspace identities out of singleton cache and channel keys", () => {
    expect(canvasPageSource).toContain("function hasWorkspaceScope(state: CanvasPageState): boolean");
    expect(canvasPageSource).toContain("state.workspaceId ?? \"none\"");
    expect(canvasPageSource).toContain("session:${state.canvasSessionId}");
    expect(canvasPageSource).toContain("state.childId ?? state.canvasSessionId");
    expect(canvasPageSource).toContain("return `${CHANNEL_NAME}:${canvasScopeKey(state)}`;");
  });
});
