import { describe, expect, it } from "vitest";
import { PUBLIC_CANVAS_COMMANDS } from "../src/browser/canvas-manager";

const EXPECTED_PUBLIC_CANVAS_COMMANDS = [
  "canvas.session.open",
  "canvas.session.attach",
  "canvas.session.status",
  "canvas.session.close",
  "canvas.capabilities.get",
  "canvas.plan.set",
  "canvas.plan.get",
  "canvas.document.load",
  "canvas.document.import",
  "canvas.document.patch",
  "canvas.history.undo",
  "canvas.history.redo",
  "canvas.document.save",
  "canvas.document.export",
  "canvas.inventory.list",
  "canvas.inventory.insert",
  "canvas.starter.list",
  "canvas.starter.apply",
  "canvas.tab.open",
  "canvas.tab.close",
  "canvas.overlay.mount",
  "canvas.overlay.unmount",
  "canvas.overlay.select",
  "canvas.preview.render",
  "canvas.preview.refresh",
  "canvas.feedback.poll",
  "canvas.feedback.subscribe",
  "canvas.feedback.next",
  "canvas.feedback.unsubscribe",
  "canvas.code.bind",
  "canvas.code.unbind",
  "canvas.code.pull",
  "canvas.code.push",
  "canvas.code.status",
  "canvas.code.resolve"
] as const;

describe("public canvas command inventory", () => {
  it("locks the shipped public canvas command surface", () => {
    expect(PUBLIC_CANVAS_COMMANDS).toEqual(EXPECTED_PUBLIC_CANVAS_COMMANDS);
    expect(new Set(PUBLIC_CANVAS_COMMANDS).size).toBe(35);
  });

  it("excludes internal extension-only helper commands", () => {
    expect(PUBLIC_CANVAS_COMMANDS).not.toContain("canvas.tab.sync");
    expect(PUBLIC_CANVAS_COMMANDS).not.toContain("canvas.overlay.sync");
  });
});
