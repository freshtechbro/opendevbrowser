import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "fs/promises";
import { watch, type FSWatcher } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setImmediate as waitForIo } from "timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasCodeSyncManager } from "../src/browser/canvas-code-sync-manager";
import { CanvasDocumentStore, createDefaultCanvasDocument } from "../src/canvas/document-store";
import { saveCanvasCodeSyncManifest } from "../src/canvas/repo-store";
import {
  DEFAULT_CODE_SYNC_OWNERSHIP,
  type CanvasCodeSyncBindingMetadata,
  type CanvasDocument,
  type CanvasPatch
} from "../src/canvas/types";
import { hashCodeSyncValue } from "../src/canvas/code-sync/hash";
import {
  normalizeCodeSyncBindingMetadata,
  type CodeSyncBindingStatus,
  type CodeSyncManifest
} from "../src/canvas/code-sync/types";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    watch: vi.fn()
  };
});

type WatchState = {
  watcher: FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  lastSourceHash: string | null;
};

type BindingRuntimeState = {
  status: CodeSyncBindingStatus;
  manifest: CodeSyncManifest | null;
  conflicts: Array<{ kind: string; message: string }>;
  unsupportedRegions: Array<{ key: string }>;
  watch: WatchState | null;
};

type SessionRuntimeState = {
  state: string;
  driftState: string;
  bindings: Map<string, BindingRuntimeState>;
  lastImportAt?: string;
  lastPushAt?: string;
};

type ManagerInternals = {
  sessions: Map<string, SessionRuntimeState>;
  recomputeSession: (canvasSessionId: string) => void;
  disposeSession: (canvasSessionId: string) => void;
};

const mockedWatch = vi.mocked(watch);

const validPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Refine the hero." },
  visualDirection: { profile: "cinematic-minimal" },
  layoutStrategy: { approach: "hero-led-grid" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first" },
  motionPosture: { level: "subtle" },
  responsivePosture: { primaryViewport: "desktop" },
  accessibilityPosture: { target: "WCAG_2_2_AA" },
  validationTargets: { blockOn: ["contrast-failure"] }
};

function createCodeSyncMetadata(repoPath: string, overrides: Partial<CanvasCodeSyncBindingMetadata> = {}): CanvasCodeSyncBindingMetadata {
  return normalizeCodeSyncBindingMetadata({
    adapter: "tsx-react-v1",
    repoPath,
    exportName: "Hero",
    syncMode: "manual",
    ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP },
    ...overrides
  });
}

function createBinding(document: CanvasDocument, repoPath: string, overrides: Partial<CanvasDocument["bindings"][number]> = {}): CanvasDocument["bindings"][number] {
  return {
    id: "binding_code_sync",
    nodeId: document.pages[0]!.rootNodeId as string,
    kind: "code-sync",
    codeSync: createCodeSyncMetadata(repoPath),
    ...overrides
  };
}

function getRuntime(manager: CanvasCodeSyncManager, canvasSessionId: string, bindingId: string): BindingRuntimeState {
  const session = (manager as unknown as ManagerInternals).sessions.get(canvasSessionId);
  if (!session) {
    throw new Error(`Missing session ${canvasSessionId}`);
  }
  const runtime = session.bindings.get(bindingId);
  if (!runtime) {
    throw new Error(`Missing binding runtime ${bindingId}`);
  }
  return runtime;
}

function buildManifest(document: CanvasDocument, binding: CanvasDocument["bindings"][number], repoPath: string, sourceText: string, documentRevision = 1): CodeSyncManifest {
  const metadata = binding.codeSync ?? createCodeSyncMetadata(repoPath);
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
    documentRevision,
    nodeMappings: [{
      nodeId: binding.nodeId,
      locator: {
        sourcePath: repoPath,
        astPath: "Hero:return",
        sourceSpan: {
          start: { offset: 33, line: 2, column: 10 },
          end: { offset: 89, line: 2, column: 66 }
        }
      }
    }],
    lastImportedAt: "2026-03-12T00:00:00.000Z",
    reasonCode: metadata.reasonCode
  };
}

function createApplyPatches(store: CanvasDocumentStore): (patches: CanvasPatch[]) => Promise<{ documentRevision: number }> {
  return async (patches) => {
    store.applyPatches(store.getRevision(), patches);
    return { documentRevision: store.getRevision() };
  };
}

async function flushWatchCallbacks(expectedCalls: number, callback: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 25 && callback.mock.calls.length < expectedCalls; attempt += 1) {
    await drainWatchWork();
  }
  if (callback.mock.calls.length < expectedCalls) {
    throw new Error(
      `Expected ${expectedCalls} watch callbacks, saw ${callback.mock.calls.length} with ${vi.getTimerCount()} pending timers.`
    );
  }
}

async function drainWatchWork(): Promise<void> {
  await vi.runAllTimersAsync();
    await waitForIo();
    await Promise.resolve();
  await waitForIo();
  await Promise.resolve();
}

describe("canvas code sync manager", () => {
  let worktree = "";

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-code-sync-manager-"));
    mockedWatch.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(worktree, { recursive: true, force: true });
  });

  it("requires code-sync metadata and treats missing sessions as no-ops", async () => {
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });
    const document = createDefaultCanvasDocument("dc_missing_code_sync");
    const invalidBinding = {
      id: "binding_invalid",
      nodeId: document.pages[0]!.rootNodeId as string,
      kind: "code-sync"
    };

    await expect(manager.bind({
      canvasSessionId: "session-invalid",
      document,
      documentRevision: 1,
      binding: invalidBinding
    })).rejects.toThrow("missing code-sync metadata");

    expect(() => (manager as unknown as ManagerInternals).recomputeSession("session-missing")).not.toThrow();
    expect(() => manager.disposeSession("session-missing")).not.toThrow();
  });

  it("tracks watch hashes, refreshes source drift, and clears watch state on unbind", async () => {
    vi.useFakeTimers();

    const sourcePath = join(worktree, "Hero.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section className=\"hero-shell\"><span>Hello world</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const watcher = { close: vi.fn() } as unknown as FSWatcher;
    mockedWatch.mockReturnValue(watcher);

    const document = createDefaultCanvasDocument("dc_watch_status");
    const binding = createBinding(document, sourcePath, {
      id: "binding_watch_status",
      codeSync: createCodeSyncMetadata(sourcePath, { syncMode: "watch" })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-watch-status",
      document,
      documentRevision: 1,
      binding
    });

    const runtime = getRuntime(manager, "session-watch-status", binding.id);
    expect(runtime.watch?.lastSourceHash).toBe(hashCodeSyncValue(sourceText));
    if (!runtime.watch) {
      throw new Error("Expected watch state");
    }
    runtime.watch.lastSourceHash = "stale-hash";
    runtime.watch.debounceTimer = setTimeout(() => undefined, 1_000);

    const status = await manager.getBindingStatus("session-watch-status", worktree, document.documentId, binding, 1);
    expect(status.state).toBe("in_sync");
    expect(runtime.watch.lastSourceHash).toBe("stale-hash");
    expect(manager.getSessionStatus("session-watch-status", 3, "client-owner")).toMatchObject({
      attachedClients: 3,
      activeLeaseHolder: "client-owner",
      watchState: "watching"
    });

    await unlink(sourcePath);
    const drifted = await manager.getBindingStatus("session-watch-status", worktree, document.documentId, binding, 1);
    expect(drifted).toMatchObject({
      state: "drift_detected",
      driftState: "source_changed"
    });
    expect(manager.getSessionStatus("session-watch-status", 1, null)).toMatchObject({
      state: "drift_detected",
      driftState: "source_changed"
    });

    manager.unbind("session-watch-status", binding.id);
    expect((watcher.close as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks bindings as conflicted when both source and document drift at the same time", async () => {
    const sourcePath = join(worktree, "ConflictHero.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello conflict</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const document = createDefaultCanvasDocument("dc_conflict_status");
    const binding = createBinding(document, sourcePath, {
      id: "binding_conflict_status"
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, 1));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-conflict-status",
      document,
      documentRevision: 1,
      binding
    });

    await writeFile(sourcePath, sourceText.replace("Hello conflict", "Hello source drift"));
    const drifted = await manager.getBindingStatus("session-conflict-status", worktree, document.documentId, binding, 2);

    expect(drifted).toMatchObject({
      state: "conflict",
      driftState: "conflict"
    });
    expect(manager.getSessionStatus("session-conflict-status", 2, "client-owner")).toMatchObject({
      state: "conflict",
      driftState: "conflict"
    });
  });

  it("debounces watcher callbacks, survives status refresh races, ignores unchanged hashes, and degrades on watcher read failures", async () => {
    vi.useFakeTimers();

    const sourcePath = join(worktree, "WatchHero.tsx");
    const initialSource = [
      "export function Hero() {",
      "  return <section><span>Hello watch</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, initialSource);

    let onChange: (() => void) | undefined;
    const watcher = { close: vi.fn() } as unknown as FSWatcher;
    mockedWatch.mockImplementation((_path, listener) => {
      onChange = listener as () => void;
      return watcher;
    });

    const document = createDefaultCanvasDocument("dc_watch_callbacks");
    const binding = createBinding(document, sourcePath, {
      id: "binding_watch_callbacks",
      codeSync: createCodeSyncMetadata(sourcePath, { syncMode: "watch" })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, initialSource));

    const watchedChanges = vi.fn().mockResolvedValue(undefined);
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: watchedChanges
    });

    await manager.bind({
      canvasSessionId: "session-watch-callbacks",
      document,
      documentRevision: 1,
      binding
    });

    if (!onChange) {
      throw new Error("Expected watch callback");
    }

    const runtime = getRuntime(manager, "session-watch-callbacks", binding.id);
    runtime.watch = null;
    onChange();
    await drainWatchWork();
    expect(watchedChanges).not.toHaveBeenCalled();

    runtime.watch = {
      watcher,
      debounceTimer: null,
      lastSourceHash: hashCodeSyncValue(initialSource)
    };

    runtime.watch.lastSourceHash = null;
    onChange();
    await flushWatchCallbacks(1, watchedChanges);
    expect(watchedChanges).toHaveBeenCalledTimes(1);
    watchedChanges.mockClear();
    runtime.watch.lastSourceHash = hashCodeSyncValue(initialSource);

    onChange();
    await drainWatchWork();
    expect(watchedChanges).not.toHaveBeenCalled();

    await writeFile(sourcePath, initialSource.replace("Hello watch", "Hello changed"));
    onChange();
    const drifted = await manager.getBindingStatus("session-watch-callbacks", worktree, document.documentId, binding, 1);
    expect(drifted).toMatchObject({
      state: "drift_detected",
      driftState: "source_changed"
    });
    onChange();
    await flushWatchCallbacks(1, watchedChanges);
    expect(watchedChanges).toHaveBeenCalledTimes(1);
    expect(watchedChanges).toHaveBeenCalledWith("session-watch-callbacks", binding.id);

    await unlink(sourcePath);
    onChange();
    await drainWatchWork();
    expect(runtime.status).toMatchObject({
      state: "drift_detected",
      driftState: "source_changed"
    });
  });

  it("rejects pushes without manifests and rejects manual conflict resolution", async () => {
    const sourcePath = join(worktree, "PushHero.tsx");
    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section><span>Hello push</span></section>;",
      "}",
      ""
    ].join("\n"));

    const document = createDefaultCanvasDocument("dc_push_manual");
    const binding = createBinding(document, sourcePath, {
      id: "binding_push_manual"
    });
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-push-manual",
      document,
      documentRevision: 1,
      binding
    });

    await expect(manager.push({
      canvasSessionId: "session-push-manual",
      document,
      documentRevision: 1,
      binding
    })).resolves.toMatchObject({
      ok: false,
      conflicts: [expect.objectContaining({ kind: "unsupported_change" })]
    });

    await expect(manager.resolve({
      canvasSessionId: "session-push-manual",
      document,
      documentRevision: 1,
      binding,
      resolutionPolicy: "manual",
      applyPatches: async () => ({ documentRevision: 1 })
    })).resolves.toMatchObject({
      ok: false,
      conflicts: [expect.objectContaining({ kind: "ownership_violation" })]
    });
  });

  it("reports unsupported pulls for missing adapters and denied code_pull capability", async () => {
    const missingAdapterPath = join(worktree, "MissingAdapter.canvas");
    await writeFile(missingAdapterPath, "<section>Missing adapter</section>\n");

    const missingAdapterDocument = createDefaultCanvasDocument("dc_missing_adapter_pull");
    const missingAdapterBinding = createBinding(missingAdapterDocument, missingAdapterPath, {
      id: "binding_missing_adapter",
      codeSync: createCodeSyncMetadata(missingAdapterPath, {
        adapter: "plugin/missing-adapter",
        frameworkAdapterId: "plugin/missing-adapter"
      })
    });
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-missing-adapter",
      document: missingAdapterDocument,
      documentRevision: 1,
      binding: missingAdapterBinding
    });

    await expect(manager.pull({
      canvasSessionId: "session-missing-adapter",
      document: missingAdapterDocument,
      documentRevision: 1,
      binding: missingAdapterBinding,
      applyPatches: async () => {
        throw new Error("pull should not apply patches when no adapter is available");
      }
    })).resolves.toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "plugin_not_found"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "No framework adapter is available for plugin/missing-adapter."
      })]
    });

    const deniedPullPath = join(worktree, "DeniedPull.tsx");
    await writeFile(deniedPullPath, [
      "export function Hero() {",
      "  return <section><span>Denied pull</span></section>;",
      "}",
      ""
    ].join("\n"));

    const deniedPullDocument = createDefaultCanvasDocument("dc_denied_pull");
    const deniedPullBinding = createBinding(deniedPullDocument, deniedPullPath, {
      id: "binding_pull_denied",
      codeSync: createCodeSyncMetadata(deniedPullPath, {
        grantedCapabilities: [{
          capability: "code_pull",
          granted: false,
          reasonCode: "capability_denied"
        }]
      })
    });

    await manager.bind({
      canvasSessionId: "session-pull-denied",
      document: deniedPullDocument,
      documentRevision: 1,
      binding: deniedPullBinding
    });

    await expect(manager.pull({
      canvasSessionId: "session-pull-denied",
      document: deniedPullDocument,
      documentRevision: 1,
      binding: deniedPullBinding,
      applyPatches: async () => {
        throw new Error("pull should not apply patches when code_pull is denied");
      }
    })).resolves.toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "capability_denied"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Framework adapter builtin:react-tsx-v2 does not grant code_pull."
      })]
    });
  });

  it("reports pull conflicts when source and document drift under manual resolution", async () => {
    const sourcePath = join(worktree, "ManualConflictHero.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello manual conflict</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_manual_pull_conflict"));
    const document = store.getDocument();
    const binding = createBinding(document, sourcePath, {
      id: "binding_manual_pull_conflict"
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, store.getRevision()));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-manual-pull-conflict",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    await writeFile(sourcePath, sourceText.replace("manual conflict", "source conflict"));

    await expect(manager.pull({
      canvasSessionId: "session-manual-pull-conflict",
      document,
      documentRevision: store.getRevision() + 1,
      binding,
      applyPatches: async () => {
        throw new Error("manual conflicts should return before patches apply");
      }
    })).resolves.toMatchObject({
      ok: false,
      bindingStatus: {
        state: "conflict",
        driftState: "conflict"
      },
      conflicts: [
        expect.objectContaining({ kind: "source_hash_changed" }),
        expect.objectContaining({ kind: "document_revision_changed" })
      ]
    });
  });

  it("requires a detectable entrypoint and degrades status when the bound source disappears", async () => {
    const sourcePath = join(worktree, "NoEntrypoint.tsx");
    await writeFile(sourcePath, [
      "const hero = <section><span>No export</span></section>;",
      "export default hero;",
      ""
    ].join("\n"));

    const document = createDefaultCanvasDocument("dc_no_entrypoint");
    const binding = createBinding(document, sourcePath, {
      id: "binding_no_entrypoint"
    });
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    vi.spyOn(manager as unknown as {
      loadAdapterRuntime: () => Promise<{
        frameworkRegistry: {
          resolveForBinding: () => {
            detectEntrypoint: () => null;
            detectForPath: () => null;
          };
          detectForPath: () => null;
        };
        libraryRegistry: {
          resolveForSource: () => [];
        };
        plugins: [];
        errors: [];
      }>;
    }, "loadAdapterRuntime").mockResolvedValue({
      frameworkRegistry: {
        resolveForBinding: () => ({
          detectEntrypoint: () => null,
          detectForPath: () => null
        }),
        detectForPath: () => null
      },
      libraryRegistry: {
        resolveForSource: () => []
      },
      plugins: [],
      errors: []
    });

    await manager.bind({
      canvasSessionId: "session-no-entrypoint",
      document,
      documentRevision: 1,
      binding
    });

    await expect(manager.pull({
      canvasSessionId: "session-no-entrypoint",
      document,
      documentRevision: 1,
      binding,
      applyPatches: async () => {
        throw new Error("pull should not apply patches when entrypoint detection fails");
      }
    })).resolves.toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "requires_rebind"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: `Unable to detect an entrypoint for ${sourcePath}.`
      })]
    });

    await unlink(sourcePath);
    await expect(manager.getBindingStatus(
      "session-no-entrypoint",
      worktree,
      document.documentId,
      binding,
      1
    )).resolves.toMatchObject({
      state: "drift_detected",
      driftState: "source_changed"
    });
  });

  it("rejects token round-trip pushes when framework or library lanes lack support", async () => {
    const frameworkDeniedPath = join(worktree, "TokenDenied.html");
    const frameworkDeniedSource = "<section><span>Hello framework denial</span></section>\n";
    await writeFile(frameworkDeniedPath, frameworkDeniedSource);

    const frameworkDeniedStore = new CanvasDocumentStore(createDefaultCanvasDocument("dc_framework_token_denial"));
    const frameworkDeniedDocument = frameworkDeniedStore.getDocument();
    const frameworkDeniedRootId = frameworkDeniedDocument.pages[0]?.rootNodeId;
    if (!frameworkDeniedRootId) {
      throw new Error("Missing root node for framework token denial");
    }
    const frameworkDeniedRoot = frameworkDeniedDocument.pages[0]?.nodes.find((node) => node.id === frameworkDeniedRootId);
    if (!frameworkDeniedRoot) {
      throw new Error("Missing root node payload for framework token denial");
    }
    frameworkDeniedRoot.tokenRefs = { backgroundColor: "semantic/bg" };

    const frameworkDeniedBinding = createBinding(frameworkDeniedDocument, frameworkDeniedPath, {
      id: "binding_framework_token_denial",
      codeSync: createCodeSyncMetadata(frameworkDeniedPath, {
        adapter: "builtin:html-static-v1",
        frameworkAdapterId: "builtin:html-static-v1",
        selector: "#app"
      })
    });
    await saveCanvasCodeSyncManifest(
      worktree,
      buildManifest(frameworkDeniedDocument, frameworkDeniedBinding, frameworkDeniedPath, frameworkDeniedSource, 1)
    );

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-framework-token-denial",
      document: frameworkDeniedDocument,
      documentRevision: frameworkDeniedStore.getRevision(),
      binding: frameworkDeniedBinding
    });

    await expect(manager.push({
      canvasSessionId: "session-framework-token-denial",
      document: frameworkDeniedDocument,
      documentRevision: frameworkDeniedStore.getRevision(),
      binding: frameworkDeniedBinding
    })).resolves.toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "capability_denied"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Framework adapter builtin:html-static-v1 does not support token_roundtrip."
      })]
    });

    const libraryDeniedPath = join(worktree, "TokenLibraryDenied.tsx");
    const libraryDeniedSource = [
      "export function Hero() {",
      "  return <section><span>Hello library denial</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(libraryDeniedPath, libraryDeniedSource);

    const libraryDeniedStore = new CanvasDocumentStore(createDefaultCanvasDocument("dc_library_token_denial"));
    const libraryDeniedDocument = libraryDeniedStore.getDocument();
    const libraryDeniedRootId = libraryDeniedDocument.pages[0]?.rootNodeId;
    if (!libraryDeniedRootId) {
      throw new Error("Missing root node for library token denial");
    }
    const libraryDeniedRoot = libraryDeniedDocument.pages[0]?.nodes.find((node) => node.id === libraryDeniedRootId);
    if (!libraryDeniedRoot) {
      throw new Error("Missing root node payload for library token denial");
    }
    libraryDeniedRoot.tokenRefs = { backgroundColor: "semantic/bg" };

    const libraryDeniedBinding = createBinding(libraryDeniedDocument, libraryDeniedPath, {
      id: "binding_library_token_denial",
      codeSync: createCodeSyncMetadata(libraryDeniedPath, {
        libraryAdapterIds: ["missing/library-adapter"]
      })
    });
    await saveCanvasCodeSyncManifest(
      worktree,
      buildManifest(libraryDeniedDocument, libraryDeniedBinding, libraryDeniedPath, libraryDeniedSource, 1)
    );

    await manager.bind({
      canvasSessionId: "session-library-token-denial",
      document: libraryDeniedDocument,
      documentRevision: libraryDeniedStore.getRevision(),
      binding: libraryDeniedBinding
    });
    const libraryDeniedPush = await manager.push({
      canvasSessionId: "session-library-token-denial",
      document: libraryDeniedDocument,
      documentRevision: libraryDeniedStore.getRevision(),
      binding: libraryDeniedBinding
    });
    expect(libraryDeniedPush).toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "capability_denied"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Library adapter missing/library-adapter does not declare token_roundtrip."
      })]
    });
    if (libraryDeniedPush.ok) {
      throw new Error("Expected library token denial push to fail");
    }
    expect(libraryDeniedPush.bindingStatus.capabilityDenials).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "token_roundtrip",
        details: expect.objectContaining({ libraryAdapterId: "missing/library-adapter" })
      })
    ]));
  });

  it("rejects pushes when code_push is explicitly denied", async () => {
    const sourcePath = join(worktree, "DeniedPush.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello denied push</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_denied_push"));
    const document = store.getDocument();
    document.designGovernance.generationPlan = structuredClone(validPlan);
    const binding = createBinding(document, sourcePath, {
      id: "binding_denied_push",
      codeSync: createCodeSyncMetadata(sourcePath, {
        grantedCapabilities: [{
          capability: "code_push",
          granted: false,
          reasonCode: "capability_denied"
        }]
      })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, store.getRevision()));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-denied-push",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    await expect(manager.push({
      canvasSessionId: "session-denied-push",
      document,
      documentRevision: store.getRevision(),
      binding
    })).resolves.toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "capability_denied"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Framework adapter builtin:react-tsx-v2 does not support code_push."
      })]
    });
  });

  it("reports unsupported pushes when no framework adapter can be resolved", async () => {
    const sourcePath = join(worktree, "UnknownFrameworkPush.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello missing push adapter</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const document = createDefaultCanvasDocument("dc_missing_push_adapter");
    const binding = createBinding(document, sourcePath, {
      id: "binding_missing_push_adapter",
      codeSync: createCodeSyncMetadata(sourcePath, {
        adapter: "mystery-adapter",
        frameworkAdapterId: "mystery-adapter"
      })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, 1));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });
    vi.spyOn(manager as unknown as {
      loadAdapterRuntime: () => Promise<{
        frameworkRegistry: {
          resolveForBinding: () => null;
          detectForPath: () => null;
        };
        libraryRegistry: {
          resolveForSource: () => [];
          get: () => null;
        };
        plugins: [];
        errors: [];
      }>;
    }, "loadAdapterRuntime").mockResolvedValue({
      frameworkRegistry: {
        resolveForBinding: () => null,
        detectForPath: () => null
      },
      libraryRegistry: {
        resolveForSource: () => [],
        get: () => null
      },
      plugins: [],
      errors: []
    });

    await manager.bind({
      canvasSessionId: "session-missing-push-adapter",
      document,
      documentRevision: 1,
      binding
    });

    await expect(manager.push({
      canvasSessionId: "session-missing-push-adapter",
      document,
      documentRevision: 1,
      binding
    })).resolves.toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "none"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "No framework adapter is available for mystery-adapter."
      })]
    });
  });

  it("keeps unsupported status when plugin adapters fail to load during status refresh", async () => {
    const sourcePath = join(worktree, "BrokenPlugin.canvas");
    const sourceText = "<section>Broken plugin</section>\n";
    await writeFile(sourcePath, sourceText);

    const document = createDefaultCanvasDocument("dc_plugin_load_failed_status");
    const binding = createBinding(document, sourcePath, {
      id: "binding_plugin_load_failed",
      codeSync: createCodeSyncMetadata(sourcePath, {
        adapter: "plugin/broken-adapter",
        frameworkAdapterId: "plugin/broken-adapter",
        pluginId: "plugin/broken-adapter"
      })
    });
    await saveCanvasCodeSyncManifest(worktree, {
      ...buildManifest(document, binding, sourcePath, sourceText, 1),
      adapter: "plugin/broken-adapter",
      frameworkAdapterId: "plugin/broken-adapter",
      pluginId: "plugin/broken-adapter"
    } as CodeSyncManifest);

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });
    vi.spyOn(manager as unknown as {
      loadAdapterRuntime: () => Promise<{
        frameworkRegistry: {
          resolveForBinding: () => null;
          detectForPath: () => null;
        };
        libraryRegistry: {
          resolveForSource: () => [];
          get: () => null;
        };
        plugins: [];
        errors: Array<{ pluginId: string; code: string }>;
      }>;
    }, "loadAdapterRuntime").mockResolvedValue({
      frameworkRegistry: {
        resolveForBinding: () => null,
        detectForPath: () => null
      },
      libraryRegistry: {
        resolveForSource: () => [],
        get: () => null
      },
      plugins: [],
      errors: [{
        pluginId: "plugin/broken-adapter",
        code: "plugin_load_failed"
      }]
    });

    await manager.bind({
      canvasSessionId: "session-plugin-load-failed",
      document,
      documentRevision: 1,
      binding
    });

    await expect(manager.getBindingStatus(
      "session-plugin-load-failed",
      worktree,
      document.documentId,
      binding,
      1
    )).resolves.toMatchObject({
      state: "unsupported"
    });
  });

  it("throws when pushes reference a canvas node that no longer exists", async () => {
    const sourcePath = join(worktree, "MissingCanvasNode.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello missing node</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_missing_canvas_node"));
    const document = store.getDocument();
    document.designGovernance.generationPlan = structuredClone(validPlan);
    const binding = createBinding(document, sourcePath, {
      id: "binding_missing_canvas_node",
      nodeId: "node_missing_from_document"
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, store.getRevision()));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-missing-canvas-node",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    await expect(manager.push({
      canvasSessionId: "session-missing-canvas-node",
      document,
      documentRevision: store.getRevision(),
      binding
    })).rejects.toThrow("Unknown canvas node: node_missing_from_document");
  });

  it("falls back to path-based adapter detection during status refresh", async () => {
    const sourcePath = join(worktree, "PathDetectedHero.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello path detection</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_path_detected_status"));
    const document = store.getDocument();
    document.designGovernance.generationPlan = structuredClone(validPlan);
    const binding = createBinding(document, sourcePath, {
      id: "binding_path_detected_status"
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, store.getRevision()));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });
    vi.spyOn(manager as unknown as {
      loadAdapterRuntime: () => Promise<{
        frameworkRegistry: {
          resolveForBinding: () => null;
          detectForPath: () => { capabilities: string[] };
        };
        libraryRegistry: {
          resolveForSource: () => [];
          get: () => null;
        };
        plugins: [];
        errors: [];
      }>;
    }, "loadAdapterRuntime").mockResolvedValue({
      frameworkRegistry: {
        resolveForBinding: () => null,
        detectForPath: () => ({ capabilities: ["preview", "code_pull"] })
      },
      libraryRegistry: {
        resolveForSource: () => [],
        get: () => null
      },
      plugins: [],
      errors: []
    });

    await manager.bind({
      canvasSessionId: "session-path-detected-status",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    await expect(manager.getBindingStatus(
      "session-path-detected-status",
      worktree,
      document.documentId,
      binding,
      store.getRevision()
    )).resolves.toMatchObject({
      state: "in_sync",
      driftState: "clean"
    });
  });

  it("rejects pushes for non-react source families with a synthesized code_push denial", async () => {
    const sourcePath = join(worktree, "NonReactPush.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello non-react push</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_non_react_push"));
    const document = store.getDocument();
    document.designGovernance.generationPlan = structuredClone(validPlan);
    const binding = createBinding(document, sourcePath, {
      id: "binding_non_react_push",
      codeSync: createCodeSyncMetadata(sourcePath, {
        sourceFamily: "html-static"
      })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, store.getRevision()));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-non-react-push",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    const result = await manager.push({
      canvasSessionId: "session-non-react-push",
      document,
      documentRevision: store.getRevision(),
      binding
    });
    expect(result).toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "capability_denied"
      },
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Framework adapter builtin:react-tsx-v2 does not support code_push."
      })]
    });
    if (result.ok) {
      throw new Error("Expected non-react push to fail");
    }
    expect(result.bindingStatus.capabilityDenials).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "code_push",
        details: expect.objectContaining({ frameworkAdapterId: "builtin:react-tsx-v2" })
      })
    ]));
  });

  it("keeps imported node identities stable across source offset changes and updates text on prefer_code pulls", async () => {
    const sourcePath = join(worktree, "RoundTripWatchHero.tsx");
    const initialSource = [
      "export function Hero() {",
      "  return <section className=\"hero-shell\" data-node-id=\"node_root\" data-binding-id=\"binding_roundtrip\"><span data-node-id=\"node_copy\" data-binding-id=\"binding_roundtrip\">{\"Hello baseline\"}</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, initialSource);

    const document = createDefaultCanvasDocument("dc_roundtrip_watch_pull");
    const binding = createBinding(document, sourcePath, {
      id: "binding_roundtrip",
      codeSync: createCodeSyncMetadata(sourcePath)
    });
    document.bindings = [binding];
    const store = new CanvasDocumentStore(document);
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-roundtrip-watch-pull",
      document: store.getDocument(),
      documentRevision: store.getRevision(),
      binding
    });

    const firstPull = await manager.pull({
      canvasSessionId: "session-roundtrip-watch-pull",
      document: store.getDocument(),
      documentRevision: store.getRevision(),
      binding,
      resolutionPolicy: "prefer_code",
      applyPatches: createApplyPatches(store)
    });
    expect(firstPull).toMatchObject({ ok: true });

    const firstTextNode = store.getDocument().pages[0]?.nodes.find((node) => node.props.text === "Hello baseline");
    expect(firstTextNode?.id).toBeTruthy();

    const updatedSource = [
      "export function Hero() {",
      "  return <section className=\"hero-shell\" data-node-id=\"node_root\" data-binding-id=\"binding_roundtrip\"><span data-node-id=\"node_copy\" data-binding-id=\"binding_roundtrip\">{\"Hello from source update with a much longer string\"}</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, updatedSource);

    const secondPull = await manager.pull({
      canvasSessionId: "session-roundtrip-watch-pull",
      document: store.getDocument(),
      documentRevision: store.getRevision(),
      binding,
      resolutionPolicy: "prefer_code",
      applyPatches: createApplyPatches(store)
    });
    expect(secondPull).toMatchObject({ ok: true });

    const secondTextNode = store.getDocument().pages[0]?.nodes.find((node) =>
      node.props.text === "Hello from source update with a much longer string"
    );
    expect(secondTextNode?.id).toBe(firstTextNode?.id);
  });

  it("resolves relative repo paths, delegates prefer_canvas resolution to push, and disposes watch sessions without timers", async () => {
    const relativeRepoPath = join("components", "RelativeHero.tsx");
    const sourcePath = join(worktree, relativeRepoPath);
    await mkdir(join(worktree, "components"), { recursive: true });
    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section><span>Hello relative path</span></section>;",
      "}",
      ""
    ].join("\n"));

    const watcher = { close: vi.fn() } as unknown as FSWatcher;
    mockedWatch.mockReturnValue(watcher);

    const document = createDefaultCanvasDocument("dc_relative_push");
    const binding = createBinding(document, relativeRepoPath, {
      id: "binding_relative_push",
      codeSync: createCodeSyncMetadata(relativeRepoPath, { syncMode: "watch" })
    });
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    const status = await manager.bind({
      canvasSessionId: "session-relative-push",
      document,
      documentRevision: 1,
      binding
    });
    expect(status.repoPath).toBe(relativeRepoPath);
    expect(status.watchEnabled).toBe(true);

    await expect(manager.resolve({
      canvasSessionId: "session-relative-push",
      document,
      documentRevision: 1,
      binding,
      resolutionPolicy: "prefer_canvas",
      applyPatches: async () => ({ documentRevision: 1 })
    })).resolves.toMatchObject({
      ok: false,
      conflicts: [expect.objectContaining({ kind: "unsupported_change" })]
    });

    const runtime = getRuntime(manager, "session-relative-push", binding.id);
    expect(runtime.watch?.debounceTimer).toBeNull();

    manager.disposeSession("session-relative-push");
    expect((watcher.close as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("reports document-only drift and unbinds watch bindings without debounce timers", async () => {
    const sourcePath = join(worktree, "DocumentDriftHero.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello document drift</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const watcher = { close: vi.fn() } as unknown as FSWatcher;
    mockedWatch.mockReturnValue(watcher);

    const document = createDefaultCanvasDocument("dc_document_drift");
    const binding = createBinding(document, sourcePath, {
      id: "binding_document_drift",
      codeSync: createCodeSyncMetadata(sourcePath, { syncMode: "watch" })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(document, binding, sourcePath, sourceText, 1));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-document-drift",
      document,
      documentRevision: 1,
      binding
    });

    const drifted = await manager.getBindingStatus(
      "session-document-drift",
      worktree,
      document.documentId,
      binding,
      2
    );
    expect(drifted).toMatchObject({
      state: "drift_detected",
      driftState: "document_changed"
    });
    expect(manager.getSessionStatus("session-document-drift", 2, "client-owner")).toMatchObject({
      state: "drift_detected",
      driftState: "document_changed",
      watchState: "watching"
    });

    const runtime = getRuntime(manager, "session-document-drift", binding.id);
    expect(runtime.watch?.debounceTimer).toBeNull();

    manager.unbind("session-document-drift", binding.id);
    expect((watcher.close as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("imports unsupported source graphs and allows source-only pull refresh without conflicts", async () => {
    const sourcePath = join(worktree, "UnsupportedHero.tsx");
    const initialSource = [
      "export function Hero() {",
      "  return <section><FancyCard /></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, initialSource);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_unsupported_pull"));
    const document = store.getDocument();
    document.designGovernance.generationPlan = structuredClone(validPlan);
    const binding = createBinding(document, sourcePath, {
      id: "binding_unsupported_pull"
    });
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-unsupported-pull",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    const pulled = await manager.pull({
      canvasSessionId: "session-unsupported-pull",
      document,
      documentRevision: store.getRevision(),
      binding,
      applyPatches: createApplyPatches(store)
    });
    expect(pulled).toMatchObject({
      ok: true,
      bindingStatus: { state: "unsupported" }
    });
    expect(manager.getSessionStatus("session-unsupported-pull", 2, "lease-holder")).toMatchObject({
      state: "unsupported",
      driftState: "clean"
    });

    await writeFile(sourcePath, [
      "export function Hero() {",
      "  return <section><span>Updated</span></section>;",
      "}",
      ""
    ].join("\n"));
    const refreshed = await manager.pull({
      canvasSessionId: "session-unsupported-pull",
      document: store.getDocument(),
      documentRevision: store.getRevision(),
      binding,
      applyPatches: createApplyPatches(store)
    });
    expect(refreshed).toMatchObject({
      ok: true,
      bindingStatus: { state: "in_sync", driftState: "clean" }
    });
    const refreshedSource = await readFile(sourcePath, "utf-8");
    expect(refreshedSource).toContain("Updated");
  });

  it("keeps unsupported status on clean refresh after an unsupported pull", async () => {
    const sourcePath = join(worktree, "UnsupportedWatchHero.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><FancyCard /></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_unsupported_watch_refresh"));
    const document = store.getDocument();
    document.designGovernance.generationPlan = structuredClone(validPlan);
    const binding = createBinding(document, sourcePath, {
      id: "binding_unsupported_watch_refresh"
    });
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-unsupported-watch-refresh",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    const pulled = await manager.pull({
      canvasSessionId: "session-unsupported-watch-refresh",
      document,
      documentRevision: store.getRevision(),
      binding,
      applyPatches: createApplyPatches(store)
    });
    expect(pulled).toMatchObject({
      ok: true,
      bindingStatus: { state: "unsupported" }
    });

    const refreshed = await manager.getBindingStatus(
      "session-unsupported-watch-refresh",
      worktree,
      document.documentId,
      binding,
      store.getRevision()
    );
    expect(refreshed).toMatchObject({
      state: "unsupported",
      driftState: "clean"
    });
  });

  it("surfaces apply conflicts, updates watch hashes on successful push, and disposes watchers", async () => {
    const sourcePath = join(worktree, "RoundTripHero.tsx");
    const initialSource = [
      "export function Hero() {",
      "  return <section><span>Hello round trip</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, initialSource);

    const watcher = { close: vi.fn() } as unknown as FSWatcher;
    mockedWatch.mockReturnValue(watcher);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_round_trip_push"));
    const document = store.getDocument();
    document.designGovernance.generationPlan = structuredClone(validPlan);
    const binding = createBinding(document, sourcePath, {
      id: "binding_round_trip_push",
      codeSync: createCodeSyncMetadata(sourcePath, { syncMode: "watch" })
    });
    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-round-trip-push",
      document,
      documentRevision: store.getRevision(),
      binding
    });

    const pulled = await manager.pull({
      canvasSessionId: "session-round-trip-push",
      document,
      documentRevision: store.getRevision(),
      binding,
      applyPatches: createApplyPatches(store)
    });
    expect(pulled).toMatchObject({ ok: true });

    const runtime = getRuntime(manager, "session-round-trip-push", binding.id);
    expect(runtime.watch?.lastSourceHash).toBe(runtime.manifest?.sourceHash ?? null);

    await writeFile(sourcePath, initialSource.replace("Hello round trip", "Hello source drift"));
    const conflict = await manager.push({
      canvasSessionId: "session-round-trip-push",
      document: store.getDocument(),
      documentRevision: store.getRevision(),
      binding
    });
    expect(conflict).toMatchObject({
      ok: false,
      conflicts: [expect.objectContaining({ kind: "source_hash_changed" })]
    });

    const textNode = store.getDocument().pages[0]!.nodes.find((node) => node.props.text === "Hello round trip");
    if (!textNode) {
      throw new Error("Expected imported text node");
    }
    store.applyPatches(store.getRevision(), [{
      op: "node.update",
      nodeId: textNode.id,
      changes: {
        "props.text": "Hello canvas push"
      }
    }]);

    await writeFile(sourcePath, initialSource);
    const pushed = await manager.push({
      canvasSessionId: "session-round-trip-push",
      document: store.getDocument(),
      documentRevision: store.getRevision(),
      binding
    });
    expect(pushed).toMatchObject({
      ok: true,
      bindingStatus: { state: "in_sync", driftState: "clean" }
    });
    expect(runtime.watch?.lastSourceHash).toBe(runtime.manifest?.sourceHash ?? null);
    expect(await readFile(sourcePath, "utf-8")).toContain("Hello canvas push");

    if (runtime.watch) {
      runtime.watch.debounceTimer = setTimeout(() => undefined, 1_000);
    }
    manager.disposeSession("session-round-trip-push");
    expect((watcher.close as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("dedupes repeated library token denials and accepts supported watch-mode token pushes", async () => {
    const sourcePath = join(worktree, "TokenLibraryCoverage.tsx");
    const sourceText = [
      "export function Hero() {",
      "  return <section><span>Hello token library coverage</span></section>;",
      "}",
      ""
    ].join("\n");
    await writeFile(sourcePath, sourceText);

    const watcher = { close: vi.fn() } as unknown as FSWatcher;
    mockedWatch.mockReturnValue(watcher);

    const deniedStore = new CanvasDocumentStore(createDefaultCanvasDocument("dc_duplicate_library_denials"));
    const deniedDocument = deniedStore.getDocument();
    deniedDocument.designGovernance.generationPlan = structuredClone(validPlan);
    const deniedRootId = deniedDocument.pages[0]?.rootNodeId;
    const deniedRoot = deniedDocument.pages[0]?.nodes.find((node) => node.id === deniedRootId);
    if (!deniedRoot) {
      throw new Error("Missing root node for duplicate library denial");
    }
    deniedRoot.tokenRefs = { backgroundColor: "semantic/bg" };
    const deniedBinding = createBinding(deniedDocument, sourcePath, {
      id: "binding_duplicate_library_denials",
      codeSync: createCodeSyncMetadata(sourcePath, {
        libraryAdapterIds: ["missing/library-adapter", "missing/library-adapter"]
      })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(deniedDocument, deniedBinding, sourcePath, sourceText, deniedStore.getRevision()));

    const manager = new CanvasCodeSyncManager({
      worktree,
      onWatchedSourceChanged: vi.fn()
    });

    await manager.bind({
      canvasSessionId: "session-duplicate-library-denials",
      document: deniedDocument,
      documentRevision: deniedStore.getRevision(),
      binding: deniedBinding
    });

    const denied = await manager.push({
      canvasSessionId: "session-duplicate-library-denials",
      document: deniedDocument,
      documentRevision: deniedStore.getRevision(),
      binding: deniedBinding
    });
    expect(denied).toMatchObject({
      ok: false,
      bindingStatus: {
        state: "unsupported",
        reasonCode: "capability_denied"
      }
    });
    if (denied.ok) {
      throw new Error("Expected duplicate library denial push to fail");
    }
    const duplicateDenials = denied.bindingStatus.capabilityDenials.filter((entry) => entry.details?.libraryAdapterId === "missing/library-adapter");
    expect(duplicateDenials).toHaveLength(1);

    const supportedStore = new CanvasDocumentStore(createDefaultCanvasDocument("dc_supported_library_push"));
    const supportedDocument = supportedStore.getDocument();
    supportedDocument.designGovernance.generationPlan = structuredClone(validPlan);
    supportedDocument.tokens.metadata = { activeModeId: "   " };
    supportedDocument.tokens.values = {
      semantic: {
        bg: "#0f172a"
      }
    };
    const supportedRootId = supportedDocument.pages[0]?.rootNodeId;
    const supportedRoot = supportedDocument.pages[0]?.nodes.find((node) => node.id === supportedRootId);
    if (!supportedRoot) {
      throw new Error("Missing root node for supported library push");
    }
    supportedRoot.tokenRefs = { backgroundColor: "semantic/bg" };
    const supportedBinding = createBinding(supportedDocument, sourcePath, {
      id: "binding_supported_library_push",
      codeSync: createCodeSyncMetadata(sourcePath, {
        syncMode: "watch",
        libraryAdapterIds: ["builtin:react/shadcn-ui"]
      })
    });
    await saveCanvasCodeSyncManifest(worktree, buildManifest(supportedDocument, supportedBinding, sourcePath, sourceText, supportedStore.getRevision()));

    await manager.bind({
      canvasSessionId: "session-supported-library-push",
      document: supportedDocument,
      documentRevision: supportedStore.getRevision(),
      binding: supportedBinding
    });

    const supportedPull = await manager.pull({
      canvasSessionId: "session-supported-library-push",
      document: supportedDocument,
      documentRevision: supportedStore.getRevision(),
      binding: supportedBinding,
      applyPatches: createApplyPatches(supportedStore)
    });
    expect(supportedPull).toMatchObject({ ok: true });

    const supportedTextNode = supportedStore.getDocument().pages[0]?.nodes.find((node) => node.props.text === "Hello token library coverage");
    if (!supportedTextNode) {
      throw new Error("Expected imported text node for supported library push");
    }
    supportedStore.applyPatches(supportedStore.getRevision(), [{
      op: "node.update",
      nodeId: supportedTextNode.id,
      changes: {
        "props.text": "Hello supported library push"
      }
    }]);

    await writeFile(sourcePath, sourceText);
    const supported = await manager.push({
      canvasSessionId: "session-supported-library-push",
      document: supportedStore.getDocument(),
      documentRevision: supportedStore.getRevision(),
      binding: supportedBinding
    });
    expect(supported).toMatchObject({
      ok: true,
      bindingStatus: {
        state: "in_sync",
        driftState: "clean"
      }
    });
    if (!supported.ok) {
      throw new Error("Expected supported library push to succeed");
    }
    const supportedRuntime = getRuntime(manager, "session-supported-library-push", supportedBinding.id);
    expect(supportedRuntime.watch?.lastSourceHash).toBe(supportedRuntime.manifest?.sourceHash ?? null);
  });
});
