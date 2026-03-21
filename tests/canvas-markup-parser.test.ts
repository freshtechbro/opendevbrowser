import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CODE_SYNC_OWNERSHIP, normalizeCodeSyncBindingMetadata } from "../src/canvas/code-sync/types";
import { parseMarkupToCodeSyncGraph } from "../src/canvas/framework-adapters/markup";

function createMetadata(repoPath = "src/markup-fixture.html") {
  return normalizeCodeSyncBindingMetadata({
    adapter: "builtin:html-static-v1",
    frameworkAdapterId: "builtin:html-static-v1",
    repoPath,
    selector: "#app",
    syncMode: "manual",
    ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP }
  });
}

describe("canvas markup parser", () => {
  it("parses element trees, normalizes attributes, and skips comments and whitespace-only text", () => {
    const sourceText = [
      '<main class="shell" data-role="hero" style="color: red; bad; padding-left: 12px; width: ; --accent: teal;">',
      "  ",
      "  <!-- ignore me -->",
      '  <span data-copy="true">Hello</span>',
      "</main>"
    ].join("\n");

    const graph = parseMarkupToCodeSyncGraph({
      bindingId: "binding_markup",
      filePath: "src/markup-fixture.html",
      sourceText,
      metadata: createMetadata(),
      rootLocator: { kind: "document-root" }
    });

    const root = graph.nodes[graph.rootKey];
    expect(root).toMatchObject({
      kind: "element",
      tagName: "main",
      attributes: {
        className: "shell",
        "data-role": "hero"
      },
      style: {
        color: "red",
        "padding-left": "12px",
        "--accent": "teal"
      },
      preservedAttributes: ['data-role="hero"']
    });
    expect(root?.childKeys).toHaveLength(1);

    const span = graph.nodes[root?.childKeys[0] as string];
    expect(span).toMatchObject({
      kind: "element",
      tagName: "span",
      attributes: {
        "data-copy": "true"
      },
      preservedAttributes: ['data-copy="true"']
    });
    expect(span?.childKeys).toHaveLength(1);

    const textNode = graph.nodes[span?.childKeys[0] as string];
    expect(textNode).toMatchObject({
      kind: "text",
      text: "Hello"
    });
    expect(textNode?.locator.sourceSpan.start.line).toBeGreaterThanOrEqual(4);
  });

  it("wraps multi-root fragments in a synthetic root without dropping the first child", () => {
    const sourceText = [
      "Lead text",
      '<section class="hero"></section>',
      '<footer data-kind="cta"></footer>'
    ].join("\n");

    const graph = parseMarkupToCodeSyncGraph({
      bindingId: "binding_multi_root",
      filePath: "src/multi-root.html",
      sourceText,
      metadata: createMetadata("src/multi-root.html"),
      rootLocator: { kind: "document-root" }
    });

    expect(graph.rootKey).toBe("binding_multi_root:root");
    const root = graph.nodes[graph.rootKey];
    expect(root).toMatchObject({
      kind: "element",
      tagName: "section",
      raw: sourceText
    });
    expect(root?.locator.astPath).toBe("root");
    expect(root?.childKeys).toHaveLength(3);
    expect(root?.childKeys).not.toContain(graph.rootKey);
    expect(graph.nodes[root?.childKeys[0] as string]).toMatchObject({
      kind: "text"
    });
    expect(graph.nodes[root?.childKeys[0] as string]?.text?.trim()).toBe("Lead text");
    expect(graph.nodes[root?.childKeys[1] as string]).toMatchObject({
      kind: "element",
      tagName: "section",
      attributes: { className: "hero" }
    });
    expect(graph.nodes[root?.childKeys[2] as string]).toMatchObject({
      kind: "element",
      tagName: "footer",
      preservedAttributes: ['data-kind="cta"']
    });
  });

  it("creates an empty synthetic root when the fragment has no parsable roots", () => {
    const sourceText = " \n <!-- nothing to render --> \n";

    const graph = parseMarkupToCodeSyncGraph({
      bindingId: "binding_empty_markup",
      filePath: "src/empty.html",
      sourceText,
      metadata: createMetadata("src/empty.html"),
      rootLocator: { kind: "document-root" }
    });

    expect(graph.rootKey).toBe("binding_empty_markup:root");
    expect(graph.nodes[graph.rootKey]).toMatchObject({
      kind: "element",
      tagName: "section",
      childKeys: [],
      raw: sourceText
    });
  });

  it("uses start-tag offsets for void elements without closing tags", () => {
    const sourceText = '<img alt="Demo" src="/demo.png">\n';

    const graph = parseMarkupToCodeSyncGraph({
      bindingId: "binding_void_markup",
      filePath: "src/void.html",
      sourceText,
      metadata: createMetadata("src/void.html"),
      rootLocator: { kind: "document-root" }
    });

    expect(graph.rootKey).toBe("binding_void_markup:root/0");
    expect(graph.nodes[graph.rootKey]).toMatchObject({
      kind: "element",
      tagName: "img",
      childKeys: [],
      raw: '<img alt="Demo" src="/demo.png">'
    });
    expect(graph.nodes[graph.rootKey]?.locator.sourceSpan.start.offset).toBe(0);
    expect(graph.nodes[graph.rootKey]?.locator.sourceSpan.end.offset).toBe(sourceText.trimEnd().length);
  });

  it("covers parse5 location fallbacks for missing, direct, and partial source locations", async () => {
    vi.resetModules();
    vi.doMock("parse5", () => ({
      parseFragment: () => ({
        childNodes: [
          { value: "Alpha" },
          {
            tagName: "direct",
            attrs: [],
            childNodes: [],
            sourceCodeLocation: { startOffset: 1, endOffset: 7 }
          },
          {
            tagName: "tagged",
            attrs: [],
            childNodes: [],
            sourceCodeLocation: {
              startTag: { startOffset: 2, endOffset: 5 },
              endTag: { endOffset: 11 }
            }
          },
          {
            tagName: "start-only",
            attrs: [],
            childNodes: [],
            sourceCodeLocation: {
              startTag: { endOffset: 6 }
            }
          },
          {
            tagName: "fallback",
            attrs: [],
            childNodes: [],
            sourceCodeLocation: {
              startTag: null,
              endTag: null
            }
          },
          {
            tagName: "missing-tags",
            attrs: [],
            childNodes: [],
            sourceCodeLocation: {}
          }
        ]
      })
    }));

    try {
      const { parseMarkupToCodeSyncGraph: parseWithMock } = await import("../src/canvas/framework-adapters/markup");
      const sourceText = "<mock-source>";
      const graph = parseWithMock({
        bindingId: "binding_mock_locations",
        filePath: "src/mock.html",
        sourceText,
        metadata: createMetadata("src/mock.html"),
        rootLocator: { kind: "document-root" }
      });

      expect(graph.rootKey).toBe("binding_mock_locations:root");
      expect(graph.nodes["binding_mock_locations:root/0"]?.locator.sourceSpan).toMatchObject({
        start: { offset: 0 },
        end: { offset: sourceText.length }
      });
      expect(graph.nodes["binding_mock_locations:root/1"]?.locator.sourceSpan).toMatchObject({
        start: { offset: 1 },
        end: { offset: 7 }
      });
      expect(graph.nodes["binding_mock_locations:root/2"]?.locator.sourceSpan).toMatchObject({
        start: { offset: 2 },
        end: { offset: 11 }
      });
      expect(graph.nodes["binding_mock_locations:root/3"]?.locator.sourceSpan).toMatchObject({
        start: { offset: 0 },
        end: { offset: 6 }
      });
      expect(graph.nodes["binding_mock_locations:root/4"]?.locator.sourceSpan).toMatchObject({
        start: { offset: 0 },
        end: { offset: sourceText.length }
      });
      expect(graph.nodes["binding_mock_locations:root/5"]?.locator.sourceSpan).toMatchObject({
        start: { offset: 0 },
        end: { offset: sourceText.length }
      });
    } finally {
      vi.doUnmock("parse5");
      vi.resetModules();
    }
  });
});
