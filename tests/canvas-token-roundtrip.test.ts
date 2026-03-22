import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CanvasCodeSyncManager } from "../src/browser/canvas-code-sync-manager";
import { applyCanvasToTsx } from "../src/canvas/code-sync/apply-tsx";
import { hashCodeSyncValue } from "../src/canvas/code-sync/hash";
import { importCodeSyncGraph } from "../src/canvas/code-sync/import";
import { normalizeCodeSyncBindingMetadata, type CodeSyncManifest } from "../src/canvas/code-sync/types";
import { parseTsxCodeSyncBinding } from "../src/canvas/code-sync/tsx-adapter";
import { createDefaultCanvasDocument } from "../src/canvas/document-store";
import { renderCanvasDocumentHtml } from "../src/canvas/export";
import { REACT_TSX_V2_ADAPTER } from "../src/canvas/framework-adapters/react-tsx-v2";
import { saveCanvasCodeSyncManifest } from "../src/canvas/repo-store";
import { tokenPathToCssCustomProperty } from "../src/canvas/token-references";
import { DEFAULT_CODE_SYNC_OWNERSHIP, type CanvasBinding, type CanvasDocument } from "../src/canvas/types";

function createReactMetadata(repoPath = "src/Hero.tsx") {
  return normalizeCodeSyncBindingMetadata({
    adapter: "builtin:react-tsx-v2",
    frameworkAdapterId: "builtin:react-tsx-v2",
    repoPath,
    exportName: "Hero",
    syncMode: "manual",
    ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP }
  });
}

function createHtmlMetadata(repoPath: string) {
  return normalizeCodeSyncBindingMetadata({
    adapter: "builtin:html-static-v1",
    frameworkAdapterId: "builtin:html-static-v1",
    repoPath,
    syncMode: "manual",
    ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP }
  });
}

function createTokenDocument(documentId: string): CanvasDocument {
  const document = createDefaultCanvasDocument(documentId);
  const page = document.pages[0]!;
  const rootNode = page.nodes.find((node) => node.id === page.rootNodeId)!;
  rootNode.kind = "frame";
  rootNode.name = "Hero Root";
  rootNode.style = {
    backgroundColor: "#111827",
    color: "#f8fafc",
    padding: "24px"
  };
  rootNode.tokenRefs = {
    backgroundColor: "theme.primary"
  };
  document.tokens.values = {
    theme: {
      primary: "#111827"
    }
  };
  document.tokens.metadata = {
    activeModeId: "night"
  };
  return document;
}

function createBinding(document: CanvasDocument, metadata: ReturnType<typeof createReactMetadata> | ReturnType<typeof createHtmlMetadata>): CanvasBinding {
  return {
    id: "binding_code",
    nodeId: document.pages[0]!.rootNodeId as string,
    kind: "code-sync",
    codeSync: metadata,
    metadata: {}
  };
}

function buildManifest(
  document: CanvasDocument,
  binding: CanvasBinding,
  sourceText: string
): CodeSyncManifest {
  const metadata = binding.codeSync!;
  const parsed = parseTsxCodeSyncBinding(sourceText, metadata.repoPath, binding.id, metadata);
  const rootNode = parsed.graph.nodes[parsed.graph.rootKey]!;
  return {
    manifestVersion: metadata.manifestVersion,
    bindingId: binding.id,
    documentId: document.documentId,
    repoPath: metadata.repoPath,
    adapter: metadata.adapter,
    frameworkAdapterId: metadata.frameworkAdapterId,
    frameworkId: metadata.frameworkId,
    sourceFamily: metadata.sourceFamily,
    adapterKind: metadata.adapterKind,
    adapterVersion: metadata.adapterVersion,
    pluginId: metadata.pluginId,
    libraryAdapterIds: [...metadata.libraryAdapterIds],
    rootLocator: metadata.rootLocator,
    sourceHash: hashCodeSyncValue(sourceText),
    documentRevision: 1,
    nodeMappings: [{
      nodeId: binding.nodeId,
      locator: rootNode.locator
    }],
    reasonCode: metadata.reasonCode
  };
}

describe("canvas token roundtrip", () => {
  it("renders stable CSS variables and token mode attributes in exported html", () => {
    const document = createTokenDocument("dc_token_export");

    const html = renderCanvasDocumentHtml(document);
    const cssVariable = tokenPathToCssCustomProperty("theme.primary");

    expect(html).toContain(cssVariable);
    expect(html).toContain(`${cssVariable}: #111827;`);
    expect(html).toContain('data-token-mode="night"');
    expect(html).toContain('data-theme="night"');
    expect(html).toContain(`background-color:var(${cssVariable})`);
  });

  it("preserves token identity on React pull and resolves imported node styles", () => {
    const document = createTokenDocument("dc_token_pull");
    const metadata = createReactMetadata();
    const binding = createBinding(document, metadata);
    const cssVariable = tokenPathToCssCustomProperty("theme.primary");
    const sourceText = [
      "export function Hero() {",
      `  return <section style={{ backgroundColor: \"var(${cssVariable})\", color: \"#f8fafc\" }} />;`,
      "}",
      ""
    ].join("\n");
    const parsed = parseTsxCodeSyncBinding(sourceText, metadata.repoPath, binding.id, metadata);

    const imported = importCodeSyncGraph({
      document,
      binding,
      documentRevision: 1,
      graph: parsed.graph,
      tokenRefsByNodeKey: REACT_TSX_V2_ADAPTER.readTokenRefs(parsed.graph, {
        bindingId: binding.id,
        metadata,
        activeModeId: "night"
      })
    });

    const rootUpdate = imported.patches.find((patch) => patch.op === "node.update");
    expect(rootUpdate).toMatchObject({
      op: "node.update",
      nodeId: binding.nodeId,
      changes: {
        tokenRefs: {
          backgroundColor: "theme.primary"
        },
        style: {
          backgroundColor: "#111827",
          color: "#f8fafc"
        }
      }
    });
  });

  it("preserves token identity on React push and reparses the same token refs", () => {
    const document = createTokenDocument("dc_token_push");
    const metadata = createReactMetadata();
    const binding = createBinding(document, metadata);
    const sourceText = [
      "export function Hero() {",
      "  return <section data-node-id=\"binding_code\" data-binding-id=\"binding_code\" style={{ backgroundColor: \"#ffffff\" }} />;",
      "}",
      ""
    ].join("\n");
    const manifest = buildManifest(document, binding, sourceText);
    const cssVariable = tokenPathToCssCustomProperty("theme.primary");

    const applied = applyCanvasToTsx({
      document,
      binding,
      manifest,
      sourceText,
      emitTokenRefs: (node) => REACT_TSX_V2_ADAPTER.emitTokenRefs(node, {
        bindingId: binding.id,
        metadata,
        activeModeId: "night"
      }),
      themeAttributes: REACT_TSX_V2_ADAPTER.emitThemeBindings({
        bindingId: binding.id,
        metadata,
        activeModeId: "night"
      })
    });

    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.nextSource).toContain(`backgroundColor: \"var(${cssVariable})\"`);
    expect(applied.nextSource).toContain('data-token-mode="night"');
    expect(applied.nextSource).toContain('data-theme="night"');

    const reparsed = parseTsxCodeSyncBinding(applied.nextSource, metadata.repoPath, binding.id, metadata);
    expect(REACT_TSX_V2_ADAPTER.readTokenRefs(reparsed.graph, {
      bindingId: binding.id,
      metadata,
      activeModeId: "night"
    })[reparsed.graph.rootKey]).toEqual({
      backgroundColor: "theme.primary"
    });
  });

  it("rejects token push explicitly for framework lanes without token_roundtrip", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "odb-canvas-token-roundtrip-"));
    try {
      const sourcePath = join(worktree, "landing.html");
      await writeFile(sourcePath, "<main data-node-id=\"binding_code\" data-binding-id=\"binding_code\"></main>\n");
      const document = createTokenDocument("dc_token_denial");
      const metadata = createHtmlMetadata(sourcePath);
      const binding = createBinding(document, metadata);
      document.bindings = [binding];

      await saveCanvasCodeSyncManifest(worktree, {
        manifestVersion: metadata.manifestVersion,
        bindingId: binding.id,
        documentId: document.documentId,
        repoPath: metadata.repoPath,
        adapter: metadata.adapter,
        frameworkAdapterId: metadata.frameworkAdapterId,
        frameworkId: metadata.frameworkId,
        sourceFamily: metadata.sourceFamily,
        adapterKind: metadata.adapterKind,
        adapterVersion: metadata.adapterVersion,
        pluginId: metadata.pluginId,
        libraryAdapterIds: [],
        rootLocator: metadata.rootLocator,
        sourceHash: hashCodeSyncValue("<main data-node-id=\"binding_code\" data-binding-id=\"binding_code\"></main>\n"),
        documentRevision: 1,
        nodeMappings: [],
        reasonCode: metadata.reasonCode
      });

      const manager = new CanvasCodeSyncManager({
        worktree,
        onWatchedSourceChanged: async () => undefined
      });
      const result = await manager.push({
        canvasSessionId: "session_token_denial",
        document,
        documentRevision: 1,
        binding
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.bindingStatus.state).toBe("unsupported");
      expect(result.conflicts[0]?.message).toBe("Framework adapter builtin:html-static-v1 does not support token_roundtrip.");
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });
});
