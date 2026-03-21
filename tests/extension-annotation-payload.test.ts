import { describe, expect, it } from "vitest";
import {
  buildCanvasAnnotationPayload,
  filterAnnotationPayload
} from "../extension/src/annotation-payload";

describe("extension annotation payload helpers", () => {
  it("filters payloads down to the requested annotation ids", () => {
    const payload = {
      url: "https://example.com",
      title: "Example",
      timestamp: "2026-03-12T00:00:00.000Z",
      screenshotMode: "visible" as const,
      screenshots: [
        { id: "shot-1", label: "first", base64: "AAAA", mime: "image/png" as const },
        { id: "shot-2", label: "second", base64: "BBBB", mime: "image/png" as const }
      ],
      annotations: [
        {
          id: "item-1",
          selector: "#hero",
          tag: "section",
          rect: { x: 0, y: 0, width: 320, height: 180 },
          attributes: {},
          a11y: {},
          styles: {},
          screenshotId: "shot-1"
        },
        {
          id: "item-2",
          selector: "#footer",
          tag: "footer",
          rect: { x: 0, y: 200, width: 320, height: 120 },
          attributes: {},
          a11y: {},
          styles: {},
          screenshotId: "shot-2"
        }
      ]
    };

    const filtered = filterAnnotationPayload(payload, ["item-2"], { includeScreenshots: false });

    expect(filtered.annotations).toHaveLength(1);
    expect(filtered.annotations[0]?.id).toBe("item-2");
    expect(filtered.annotations[0]).not.toHaveProperty("screenshotId");
    expect(filtered.screenshotMode).toBe("none");
    expect(filtered).not.toHaveProperty("screenshots");
  });

  it("builds canvas payloads with canvas urls and node-derived metadata", () => {
    const payload = buildCanvasAnnotationPayload({
      document: {
        documentId: "doc_home",
        title: "Marketing Home",
        pages: [{
          id: "page_home",
          name: "Home",
          path: "/home",
          rootNodeId: "node_button",
          prototypeIds: [],
          nodes: [{
            id: "node_button",
            kind: "component-instance",
            name: "Hero CTA",
            rect: { x: 24, y: 40, width: 160, height: 48 },
            childIds: [],
            props: {
              text: "Launch",
              tagName: "button",
              attributes: { "data-variant": "primary" }
            },
            style: { color: "#ffffff", backgroundColor: "#111827" },
            bindingRefs: {},
            metadata: {}
          }],
          metadata: {}
        }],
        bindings: [],
        assets: [],
        componentInventory: []
      },
      page: {
        id: "page_home",
        name: "Home",
        path: "/home",
        rootNodeId: "node_button",
        prototypeIds: [],
        nodes: [{
          id: "node_button",
          kind: "component-instance",
          name: "Hero CTA",
          rect: { x: 24, y: 40, width: 160, height: 48 },
          childIds: [],
          props: {
            text: "Launch",
            tagName: "button",
            attributes: { "data-variant": "primary" }
          },
          style: { color: "#ffffff", backgroundColor: "#111827" },
          bindingRefs: {},
          metadata: {}
        }],
        metadata: {}
      },
      drafts: [{ nodeId: "node_button", note: "Primary CTA alignment" }],
      context: "Check CTA fidelity"
    });

    expect(payload.url).toBe("canvas://doc_home/home");
    expect(payload.context).toBe("Check CTA fidelity");
    expect(payload.annotations).toEqual([
      expect.objectContaining({
        id: "node_button",
        tag: "button",
        note: "Primary CTA alignment",
        selector: "[data-node-id=\"node_button\"]",
        attributes: expect.objectContaining({
          "data-canvas-kind": "component-instance",
          "data-node-id": "node_button",
          "data-tag-name": "button",
          "data-variant": "primary"
        })
      })
    ]);
  });

  it("builds canvas payloads for stage regions without requiring node selectors", () => {
    const payload = buildCanvasAnnotationPayload({
      document: {
        documentId: "doc_regions",
        title: "Region Canvas",
        pages: [{
          id: "page_home",
          name: "Home",
          path: "/home",
          rootNodeId: null,
          prototypeIds: [],
          nodes: [],
          metadata: {}
        }],
        bindings: [],
        assets: [],
        componentInventory: []
      },
      page: {
        id: "page_home",
        name: "Home",
        path: "/home",
        rootNodeId: null,
        prototypeIds: [],
        nodes: [],
        metadata: {}
      },
      drafts: [{
        kind: "region",
        regionId: "region_hero",
        rect: { x: 24, y: 48, width: 220, height: 140 },
        label: "Hero group",
        note: "Spacing review"
      }]
    });

    expect(payload.annotations).toEqual([
      expect.objectContaining({
        id: "region_hero",
        tag: "canvas-region",
        selector: "[data-canvas-region=\"region_hero\"]",
        text: "Hero group",
        note: "Spacing review",
        attributes: expect.objectContaining({
          "data-canvas-region": "region_hero",
          "data-canvas-kind": "region"
        })
      })
    ]);
  });
});
