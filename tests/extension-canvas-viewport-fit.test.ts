import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_VIEWPORT,
  computeFittedViewport,
  computeViewportCanvasCenter,
  isDefaultEditorViewport
} from "../extension/src/canvas/viewport-fit";
import type { CanvasNode } from "../extension/src/canvas/model";

const createNode = (overrides: Partial<CanvasNode> & Pick<CanvasNode, "id">): CanvasNode => ({
  id: overrides.id,
  kind: overrides.kind ?? "frame",
  name: overrides.name ?? overrides.id,
  pageId: overrides.pageId ?? "page_home",
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  rect: overrides.rect ?? { x: 0, y: 0, width: 240, height: 120 },
  props: overrides.props ?? {},
  style: overrides.style ?? {},
  bindingRefs: overrides.bindingRefs ?? {},
  metadata: overrides.metadata ?? {}
});

describe("canvas viewport fitting", () => {
  it("keeps the default viewport sentinel stable", () => {
    expect(isDefaultEditorViewport(DEFAULT_EDITOR_VIEWPORT)).toBe(true);
    expect(isDefaultEditorViewport({ x: 121, y: 96, zoom: 1 })).toBe(false);
  });

  it("fits the document while keeping the stage anchored near the top edge", () => {
    const viewport = computeFittedViewport([
      createNode({
        id: "node_root",
        rect: { x: 0, y: 0, width: 960, height: 560 }
      })
    ], 824, 1024);

    expect(viewport.zoom).toBe(0.76);
    expect(viewport.x).toBe(47);
    expect(viewport.y).toBe(96);
  });

  it("falls back to the default viewport when the document is empty", () => {
    expect(computeFittedViewport([], 824, 1024)).toEqual(DEFAULT_EDITOR_VIEWPORT);
  });

  it("uses the actual stage dimensions when placing new nodes at the viewport center", () => {
    const center = computeViewportCanvasCenter({ x: 47, y: 96, zoom: 0.76 }, 824, 1024);
    expect(center).toEqual({ x: 480.2631578947368, y: 547.3684210526316 });
  });
});
