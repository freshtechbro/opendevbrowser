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
import type {
  CodeSyncBindingStatus,
  CodeSyncManifest
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
  return {
    adapter: "tsx-react-v1",
    repoPath,
    exportName: "Hero",
    syncMode: "manual",
    ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP },
    ...overrides
  };
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
  return {
    bindingId: binding.id,
    documentId: document.documentId,
    repoPath,
    adapter: binding.codeSync?.adapter ?? "tsx-react-v1",
    rootLocator: {
      exportName: binding.codeSync?.exportName,
      selector: binding.codeSync?.selector
    },
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
    lastImportedAt: "2026-03-12T00:00:00.000Z"
  };
}

function createApplyPatches(store: CanvasDocumentStore): (patches: CanvasPatch[]) => Promise<{ documentRevision: number }> {
  return async (patches) => {
    store.applyPatches(store.getRevision(), patches);
    return { documentRevision: store.getRevision() };
  };
}

async function flushWatchCallbacks(expectedCalls: number, callback: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 5 && callback.mock.calls.length < expectedCalls; attempt += 1) {
    await waitForIo();
    await Promise.resolve();
  }
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

    const status = await manager.getBindingStatus("session-watch-status", document.documentId, binding, 1);
    expect(status.state).toBe("in_sync");
    expect(runtime.watch.lastSourceHash).toBe("stale-hash");
    expect(manager.getSessionStatus("session-watch-status", 3, "client-owner")).toMatchObject({
      attachedClients: 3,
      activeLeaseHolder: "client-owner",
      watchState: "watching"
    });

    await unlink(sourcePath);
    const drifted = await manager.getBindingStatus("session-watch-status", document.documentId, binding, 1);
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
    const drifted = await manager.getBindingStatus("session-conflict-status", document.documentId, binding, 2);

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
    await vi.runAllTimersAsync();
    expect(watchedChanges).not.toHaveBeenCalled();

    runtime.watch = {
      watcher,
      debounceTimer: null,
      lastSourceHash: hashCodeSyncValue(initialSource)
    };

    runtime.watch.lastSourceHash = null;
    onChange();
    await vi.runAllTimersAsync();
    await flushWatchCallbacks(1, watchedChanges);
    expect(watchedChanges).toHaveBeenCalledTimes(1);
    watchedChanges.mockClear();
    runtime.watch.lastSourceHash = hashCodeSyncValue(initialSource);

    onChange();
    await vi.advanceTimersByTimeAsync(200);
    expect(watchedChanges).not.toHaveBeenCalled();

    await writeFile(sourcePath, initialSource.replace("Hello watch", "Hello changed"));
    onChange();
    const drifted = await manager.getBindingStatus("session-watch-callbacks", document.documentId, binding, 1);
    expect(drifted).toMatchObject({
      state: "drift_detected",
      driftState: "source_changed"
    });
    onChange();
    await vi.runAllTimersAsync();
    await flushWatchCallbacks(1, watchedChanges);
    expect(watchedChanges).toHaveBeenCalledTimes(1);
    expect(watchedChanges).toHaveBeenCalledWith("session-watch-callbacks", binding.id);

    await unlink(sourcePath);
    onChange();
    await vi.runAllTimersAsync();
    await waitForIo();
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
});
