import { mkdtemp, readFile } from "fs/promises";
import { describe, expect, it } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { parseCodeSyncManifest, normalizeCodeSyncManifest, normalizeRootLocator } from "../src/canvas/code-sync/manifest";
import { hashCodeSyncJson, hashCodeSyncValue } from "../src/canvas/code-sync/hash";
import { buildManifestLookup, locatorKey } from "../src/canvas/code-sync/graph";
import { finalizeCodeSyncManifest, writeCodeSyncSource } from "../src/canvas/code-sync/write";
import {
  DEFAULT_CODE_SYNC_OWNERSHIP,
  isCodeSyncProjectionMode,
  isCodeSyncState,
  normalizeCodeSyncBindingMetadata,
  normalizeCodeSyncOwnership,
  type CodeSyncManifest,
  type CodeSyncSourceLocator
} from "../src/canvas/code-sync/types";

function buildLocator(overrides: Partial<CodeSyncSourceLocator> = {}): CodeSyncSourceLocator {
  return {
    sourcePath: "src/app.tsx",
    astPath: "exports.default",
    sourceSpan: {
      start: { offset: 1, line: 1, column: 1 },
      end: { offset: 10, line: 1, column: 10 }
    },
    ...overrides
  };
}

function buildManifest(overrides: Partial<CodeSyncManifest> = {}): CodeSyncManifest {
  return {
    bindingId: "binding_code",
    documentId: "dc_sync",
    repoPath: "src/app.tsx",
    adapter: "tsx-react-v1",
    rootLocator: { exportName: "App" },
    sourceHash: "hash_123",
    documentRevision: 3,
    nodeMappings: [{
      nodeId: "node_root",
      locator: buildLocator()
    }],
    lastImportedAt: "2026-03-12T00:00:00.000Z",
    lastPushedAt: "2026-03-12T01:00:00.000Z",
    ...overrides
  };
}

describe("canvas code-sync primitive helpers", () => {
  it("hashes raw values and JSON payloads deterministically", () => {
    expect(hashCodeSyncValue("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(hashCodeSyncJson({ b: 2, a: 1 })).toBe(hashCodeSyncValue(JSON.stringify({ b: 2, a: 1 })));
    expect(hashCodeSyncJson({ a: 1 })).not.toBe(hashCodeSyncJson({ a: 2 }));
  });

  it("recognizes valid sync states and projection modes", () => {
    expect(isCodeSyncState("in_sync")).toBe(true);
    expect(isCodeSyncState("bogus")).toBe(false);
    expect(isCodeSyncState(42)).toBe(false);
    expect(isCodeSyncProjectionMode("bound_app_runtime")).toBe(true);
    expect(isCodeSyncProjectionMode("projectionless")).toBe(false);
    expect(isCodeSyncProjectionMode(null)).toBe(false);
  });

  it("matches manifest locators by stable AST path instead of source offsets", () => {
    const original = buildLocator({
      astPath: "export:Hero.child.0.child.0",
      sourceSpan: {
        start: { offset: 40, line: 2, column: 12 },
        end: { offset: 60, line: 2, column: 32 }
      }
    });
    const moved = buildLocator({
      astPath: original.astPath,
      sourceSpan: {
        start: { offset: 140, line: 5, column: 4 },
        end: { offset: 180, line: 5, column: 44 }
      }
    });

    expect(locatorKey(moved)).toBe(locatorKey(original));
    expect(buildManifestLookup([{ nodeId: "node_text", locator: original }]).get(locatorKey(moved))).toBe("node_text");
  });

  it("normalizes ownership defaults and invalid per-dimension values", () => {
    expect(normalizeCodeSyncOwnership(null)).toEqual(DEFAULT_CODE_SYNC_OWNERSHIP);
    expect(normalizeCodeSyncOwnership({
      structure: "canvas",
      text: "invalid",
      style: "shared",
      tokens: 123,
      behavior: "code",
      data: "canvas"
    })).toEqual({
      structure: "canvas",
      text: "shared",
      style: "shared",
      tokens: "shared",
      behavior: "code",
      data: "canvas"
    });
  });

  it("normalizes valid binding metadata and defaults optional fields", () => {
    expect(normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: " src/components/App.tsx ",
      exportName: "App",
      syncMode: "watch",
      ownership: { structure: "canvas", behavior: "shared" },
      route: " /preview ",
      verificationTarget: " #app ",
      runtimeRootSelector: " #root ",
      projection: "bound_app_runtime"
    })).toEqual({
      adapter: "tsx-react-v1",
      repoPath: "src/components/App.tsx",
      exportName: "App",
      selector: undefined,
      syncMode: "watch",
      ownership: {
        structure: "canvas",
        text: "shared",
        style: "shared",
        tokens: "shared",
        behavior: "shared",
        data: "code"
      },
      route: " /preview ",
      verificationTarget: " #app ",
      runtimeRootSelector: " #root ",
      projection: "bound_app_runtime"
    });

    expect(normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/components/App.tsx",
      selector: "[data-testid='app']",
      syncMode: "manual",
      ownership: {},
      projection: "not-real"
    }).projection).toBe("canvas_html");
  });

  it("rejects invalid binding metadata payloads", () => {
    expect(() => normalizeCodeSyncBindingMetadata(null)).toThrow("Invalid code sync binding metadata.");
    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "unknown-adapter",
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toThrow("Unsupported code sync adapter: unknown-adapter");
    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "   ",
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toThrow("codeSync.repoPath is required.");
    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: "later",
      ownership: {}
    })).toThrow("Unsupported code sync mode: later");
    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/app.tsx",
      syncMode: "manual",
      ownership: {}
    })).toThrow("codeSync.exportName or codeSync.selector is required.");

    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: 123,
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toThrow("Unsupported code sync adapter: unknown");

    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: 123,
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toThrow("codeSync.repoPath is required.");

    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: 123,
      ownership: {}
    })).toThrow("Unsupported code sync mode: unknown");
  });

  it("normalizes root locators and parses valid manifests", () => {
    expect(normalizeRootLocator()).toEqual({ exportName: undefined, selector: undefined });
    expect(normalizeRootLocator({
      exportName: "  ",
      selector: " #root "
    })).toEqual({ exportName: undefined, selector: " #root " });

    const parsed = parseCodeSyncManifest({
      ...buildManifest(),
      rootLocator: { exportName: "App", selector: "  " },
      nodeMappings: [
        {
          nodeId: "node_root",
          locator: buildLocator()
        },
        {
          nodeId: 42,
          locator: buildLocator()
        }
      ]
    });

    expect(parsed.rootLocator).toEqual({ exportName: "App", selector: undefined });
    expect(parsed.nodeMappings).toHaveLength(1);
    expect(parsed.nodeMappings[0]?.locator.sourceSpan.end.column).toBe(10);
  });

  it("rejects invalid manifest payloads and malformed locators", () => {
    expect(() => parseCodeSyncManifest(null)).toThrow("Invalid code sync manifest payload.");
    expect(() => parseCodeSyncManifest({
      ...buildManifest(),
      sourceHash: ""
    })).toThrow("Invalid code sync manifest payload.");

    expect(() => parseCodeSyncManifest({
      ...buildManifest(),
      bindingId: 1,
      documentId: 2,
      repoPath: 3,
      adapter: 4,
      sourceHash: 5
    })).toThrow("Invalid code sync manifest payload.");

    expect(parseCodeSyncManifest({
      ...buildManifest(),
      rootLocator: "not-an-object",
      lastImportedAt: 123,
      lastPushedAt: "2026-03-12T02:00:00.000Z"
    })).toMatchObject({
      rootLocator: { exportName: undefined, selector: undefined },
      lastImportedAt: undefined,
      lastPushedAt: "2026-03-12T02:00:00.000Z"
    });

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: null as unknown as CodeSyncSourceLocator
      }]
    }))).toThrow("Invalid code sync locator.");

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: {
          sourceSpan: null,
          sourcePath: 123,
          astPath: false
        } as unknown as CodeSyncSourceLocator
      }]
    }))).toThrow("Invalid code sync locator.");

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: {
          sourcePath: "",
          astPath: "",
          sourceSpan: {
            start: { offset: 1, line: 1, column: 1 },
            end: { offset: 2, line: 1, column: 2 }
          }
        }
      }]
    }))).toThrow("Invalid code sync locator.");

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: {
          sourcePath: "src/app.tsx",
          astPath: "exports.default",
          sourceSpan: {
            start: { offset: Number.NaN, line: 1, column: 1 },
            end: { offset: 2, line: 1, column: 2 }
          }
        }
      }]
    }))).toThrow("Invalid code sync locator positions.");
  });

  it("drops non-array and malformed node mappings during normalization", () => {
    expect(normalizeCodeSyncManifest(buildManifest({
      nodeMappings: null as unknown as CodeSyncManifest["nodeMappings"]
    })).nodeMappings).toEqual([]);

    const normalized = normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [
        { nodeId: "node_root", locator: buildLocator() },
        { locator: buildLocator() } as unknown as CodeSyncManifest["nodeMappings"][number]
      ]
    }));

    expect(normalized.nodeMappings).toHaveLength(1);
    expect(normalized.nodeMappings[0]?.nodeId).toBe("node_root");
  });

  it("writes source files atomically and finalizes manifest timestamps with fallback preservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-code-sync-"));
    const repoPath = join(root, "src/components/App.tsx");
    await writeCodeSyncSource(repoPath, "export const App = () => <main />;\n");

    await expect(readFile(repoPath, "utf8")).resolves.toBe("export const App = () => <main />;\n");

    const manifest = buildManifest({
      lastImportedAt: "2026-03-12T03:00:00.000Z",
      lastPushedAt: "2026-03-12T04:00:00.000Z"
    });

    expect(finalizeCodeSyncManifest(manifest, {
      sourceHash: "hash_next",
      documentRevision: 4,
      lastImportedAt: "2026-03-12T05:00:00.000Z"
    })).toMatchObject({
      sourceHash: "hash_next",
      documentRevision: 4,
      lastImportedAt: "2026-03-12T05:00:00.000Z",
      lastPushedAt: "2026-03-12T04:00:00.000Z"
    });

    expect(finalizeCodeSyncManifest(manifest, {
      sourceHash: "hash_final",
      documentRevision: 5,
      lastPushedAt: "2026-03-12T06:00:00.000Z"
    })).toMatchObject({
      sourceHash: "hash_final",
      documentRevision: 5,
      lastImportedAt: "2026-03-12T03:00:00.000Z",
      lastPushedAt: "2026-03-12T06:00:00.000Z"
    });
  });
});
