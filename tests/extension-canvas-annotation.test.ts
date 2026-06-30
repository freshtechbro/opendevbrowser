import { describe, expect, it } from "vitest";
import { computeAnnotationPlacement } from "../extension/src/annotation-payload";

describe("extension canvas annotation placement", () => {
  it("prefers the requested anchor side when it fits", () => {
    const placement = computeAnnotationPlacement({
      anchorRect: { x: 100, y: 100, width: 80, height: 40 },
      floatingSize: { width: 220, height: 120 },
      viewport: { width: 800, height: 600 },
      desiredSide: "right"
    });

    expect(placement.strategy).toBe("anchored");
    expect(placement.side).toBe("right");
    expect(placement.x).toBe(192);
    expect(placement.y).toBe(60);
    expect(placement.connector.visible).toBe(true);
  });

  it("clamps to the viewport and avoids blocked panel space", () => {
    const placement = computeAnnotationPlacement({
      anchorRect: { x: 720, y: 520, width: 60, height: 40 },
      floatingSize: { width: 220, height: 140 },
      viewport: { width: 800, height: 600 },
      panels: [{ x: 556, y: 440, width: 236, height: 152 }],
      desiredSide: "right"
    });

    expect(placement.x).toBeLessThanOrEqual(572);
    expect(placement.y).toBeLessThanOrEqual(452);
    expect(placement.overlapsPanel).toBe(false);
    expect(placement.clamped).toBe(true);
  });

  it("keeps mobile placement inside short viewports", () => {
    const placement = computeAnnotationPlacement({
      anchorRect: { x: 40, y: 180, width: 80, height: 40 },
      floatingSize: { width: 320, height: 260 },
      viewport: { width: 390, height: 220 },
      desiredSide: "right"
    });

    expect(placement.strategy).toBe("mobile-side-panel");
    expect(placement.y).toBeGreaterThanOrEqual(8);
  });

  it("moves away from existing annotation cards before falling back to weak overlap", () => {
    const placement = computeAnnotationPlacement({
      anchorRect: { x: 240, y: 220, width: 80, height: 60 },
      floatingSize: { width: 200, height: 120 },
      viewport: { width: 900, height: 650 },
      existing: [
        { x: 332, y: 190, width: 200, height: 120 },
        { x: 28, y: 190, width: 200, height: 120 }
      ],
      desiredSide: "right"
    });

    expect(placement.overlapsExisting).toBe(false);
    expect(["top", "bottom"]).toContain(placement.side);
  });
});
