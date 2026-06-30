import { describe, expect, it } from "vitest";
import {
  buildCanvasAnnotationPayload,
  buildCompactAnnotationPayload,
  computeAnnotationPlacement,
  filterAnnotationPayload,
  sanitizeAnnotationPayloadForAgent
} from "../extension/src/annotation-payload";

describe("extension annotation payload helpers", () => {
  it("builds compact schema v2 payloads without screenshot bytes or debug internals", () => {
    const payload = {
      url: "https://example.com",
      title: "Example",
      timestamp: "2026-03-12T00:00:00.000Z",
      context: "Review hero",
      screenshotMode: "visible" as const,
      screenshots: [
        { id: "shot-1", label: "first", base64: "AAAA", mime: "image/png" as const }
      ],
      annotations: [
        {
          id: "item-1",
          selector: "#hero",
          tag: "section",
          idAttr: "hero",
          text: "Hero CTA",
          rect: { x: 8, y: 16, width: 320, height: 180 },
          attributes: { "data-testid": "hero-section", role: "region", "aria-label": "Hero" },
          a11y: { role: "region", label: "Hero" },
          styles: { color: "rgb(0, 0, 0)" },
          screenshotId: "shot-1",
          debug: { computedStyles: { color: "black" } }
        }
      ]
    };

    const sanitized = sanitizeAnnotationPayloadForAgent(payload);
    const compact = buildCompactAnnotationPayload(payload);
    const serialized = JSON.stringify(sanitized);

    expect(sanitized.schemaVersion).toBe(2);
    expect(sanitized.screenshotMode).toBe("none");
    expect(sanitized.screenshots).toBeUndefined();
    expect(sanitized.annotations[0]).not.toHaveProperty("screenshotId");
    expect(sanitized.annotations[0]).not.toHaveProperty("debug");
    expect(sanitized.compact).toEqual(compact);
    expect(serialized).not.toContain("AAAA");
    expect(compact.schemaVersion).toBe(2);
    expect(compact.items[0]?.selectorBundle.candidates.map((entry) => entry.family)).toEqual([
      "backendNodeId",
      "frameId",
      "testId",
      "aria",
      "css",
      "shadowChain",
      "xpath",
      "text"
    ]);
    expect(compact.items[0]?.selectorBundle.candidates[0]).toMatchObject({
      family: "backendNodeId",
      availability: "unavailable",
      unavailableReason: "requires_cdp_capture"
    });
    expect(compact.items[0]?.selectorBundle.candidates[2]).toMatchObject({
      family: "testId",
      availability: "available",
      value: "[data-testid=\"hero-section\"]"
    });
    expect(compact.items[0]?.redaction.removedFields).toContain("debug");
  });


  it("redacts sensitive compact fields and selector candidates before agent handoff", () => {
    const secret = "sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    const email = "person@example.com";
    const payload = {
      url: `https://example.com/account?token=${secret}&email=${email}`,
      title: `Account for ${email}`,
      timestamp: "2026-03-12T00:00:00.000Z",
      context: `Please inspect bearer ${secret} for ${email}`,
      screenshotMode: "none" as const,
      annotations: [
        {
          id: "item-secret",
          selector: `[data-token=\"${secret}\"]`,
          tag: "button",
          idAttr: `password-${secret}`,
          text: `Reset token ${secret} for ${email}`,
          rect: { x: 8, y: 16, width: 120, height: 44 },
          attributes: {
            "data-testid": `token-${secret}`,
            "data-shadow-chain": `host>${secret}`
          },
          a11y: { role: "button", label: `Use ${secret}`, labelledBy: email, describedBy: `Secret ${secret}` },
          styles: {},
          note: `Note includes apiKey=${secret} and ${email}`,
          identity: { source: "selector" as const, priority: 50, stableId: `identity-${secret}`, label: `Label ${email}` },
          selectorBundle: {
            primary: `[data-token=\"${secret}\"]`,
            transport: "extension" as const,
            candidates: [
              { family: "css" as const, rank: 50, confidence: "medium" as const, scope: "document" as const, transport: "extension" as const, availability: "available" as const, value: `[data-token=\"${secret}\"]` },
              { family: "text" as const, rank: 80, confidence: "low" as const, scope: "text" as const, transport: "extension" as const, availability: "available" as const, value: `text=${email}` }
            ],
            recoveryHints: [`Recover with apiKey=${secret}`, `Contact ${email}`]
          }
        }
      ]
    };

    const sanitized = sanitizeAnnotationPayloadForAgent(payload);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(email);
    expect(serialized).toContain("[redacted]");
    expect(sanitized.compact?.redaction.truncatedFields.some((field) => field.includes("redacted"))).toBe(true);
  });

  it("enforces the compact byte budget for a huge url", () => {
    const hugeUrl = `https://example.com/${"path/".repeat(8_000)}?token=sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`;
    const compact = buildCompactAnnotationPayload({
      url: hugeUrl,
      title: "Huge URL compact",
      timestamp: "2026-03-12T00:00:00.000Z",
      screenshotMode: "none" as const,
      annotations: [
        {
          id: "item-huge-url",
          selector: "#hero",
          tag: "section",
          text: "Hero",
          rect: { x: 8, y: 16, width: 120, height: 44 },
          attributes: {},
          a11y: {},
          styles: {}
        }
      ]
    });

    expect(Buffer.byteLength(JSON.stringify(compact), "utf8")).toBeLessThanOrEqual(compact.byteBudget);
    expect(compact.redaction.compactByteLength).toBeLessThanOrEqual(compact.byteBudget);
    expect(compact.url).toBe("[redacted]");
    expect(compact.redaction.removedFields).toContain("url");
  });

  it("enforces the compact byte budget by truncating low-priority compact fields", () => {
    const annotations = Array.from({ length: 80 }, (_, index) => ({
      id: `item-${index}`,
      selector: `#section-${index}`,
      tag: "section",
      text: `Long visible copy ${index} ${"copy ".repeat(200)}`,
      rect: { x: index, y: index, width: 320, height: 180 },
      attributes: { "data-testid": `section-${index}` },
      a11y: { role: "region", label: `Long accessible label ${index} ${"label ".repeat(120)}` },
      styles: {},
      note: `Long note ${index} ${"note ".repeat(220)}`
    }));
    const compact = buildCompactAnnotationPayload({
      url: "https://example.com/long",
      title: "Long compact",
      timestamp: "2026-03-12T00:00:00.000Z",
      context: "Long context ".repeat(500),
      screenshotMode: "none" as const,
      annotations
    });

    expect(compact.byteBudget).toBe(24 * 1024);
    expect(Buffer.byteLength(JSON.stringify(compact), "utf8")).toBeLessThanOrEqual(compact.byteBudget);
    expect(compact.redaction.compactByteLength).toBeLessThanOrEqual(compact.byteBudget);
    expect([...compact.redaction.removedFields, ...compact.redaction.truncatedFields].length).toBeGreaterThan(0);
  });

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
        bindings: [{
          id: "binding_cta",
          nodeId: "node_button",
          kind: "component",
          selector: "[data-component=\"HeroCta\"]",
          componentName: "HeroCta",
          metadata: {
            sourceKind: "react",
            framework: "react",
            adapter: "builtin:react-tsx-v2",
            plugin: "builtin"
          }
        }],
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
          bindingRefs: { primary: "binding_cta" },
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
        selector: "[data-component=\"HeroCta\"]",
        attributes: expect.objectContaining({
          "data-canvas-kind": "component-instance",
          "data-canvas-binding-id": "binding_cta",
          "data-node-id": "node_button",
          "data-tag-name": "button",
          "data-variant": "primary"
        }),
        identity: expect.objectContaining({
          source: "canvasBinding",
          canvas: expect.objectContaining({
            bindingId: "binding_cta",
            componentName: "HeroCta",
            framework: "react",
            adapter: "builtin:react-tsx-v2"
          })
        }),
        selectorBundle: expect.objectContaining({
          candidates: expect.arrayContaining([
            expect.objectContaining({ family: "css", value: "[data-component=\"HeroCta\"]" }),
            expect.objectContaining({ family: "backendNodeId", availability: "unavailable" })
          ])
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

  it("places annotation cards anchor-first while avoiding panels and existing cards", () => {
    const placement = computeAnnotationPlacement({
      anchorRect: { x: 120, y: 80, width: 100, height: 40 },
      floatingSize: { width: 240, height: 120 },
      viewport: { width: 900, height: 700 },
      panels: [{ x: 320, y: 40, width: 260, height: 240 }],
      existing: [{ x: 232, y: 80, width: 240, height: 120 }],
      desiredSide: "right"
    });

    expect(placement.side).not.toBe("right");
    expect(placement.x).toBeGreaterThanOrEqual(8);
    expect(placement.y).toBeGreaterThanOrEqual(8);
    expect(placement.overlapsPanel).toBe(false);
    expect(placement.overlapsExisting).toBe(false);
    expect(placement.connector).toMatchObject({ visible: true });
  });

  it("uses mobile side-panel placement when the viewport is narrow", () => {
    const placement = computeAnnotationPlacement({
      anchorRect: { x: 40, y: 220, width: 80, height: 40 },
      floatingSize: { width: 320, height: 160 },
      viewport: { width: 390, height: 720 },
      desiredSide: "right"
    });

    expect(placement.strategy).toBe("mobile-side-panel");
    expect(placement.side).toBe("bottom");
    expect(placement.x).toBe(8);
    expect(placement.width).toBe(374);
  });
});
