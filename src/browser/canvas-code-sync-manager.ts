import { readFile } from "fs/promises";
import { watch, type FSWatcher } from "fs";
import { resolve, isAbsolute } from "path";
import type { CanvasBinding, CanvasDocument, CanvasPatch } from "../canvas/types";
import {
  loadCanvasCodeSyncManifest,
  saveCanvasCodeSyncManifest
} from "../canvas/repo-store";
import { applyCanvasToTsx } from "../canvas/code-sync/apply-tsx";
import { hashCodeSyncValue } from "../canvas/code-sync/hash";
import { importCodeSyncGraph } from "../canvas/code-sync/import";
import { finalizeCodeSyncManifest, writeCodeSyncSource } from "../canvas/code-sync/write";
import { parseTsxCodeSyncBinding } from "../canvas/code-sync/tsx-adapter";
import type {
  CanvasCodeSyncBindingMetadata,
  CodeSyncBindingStatus,
  CodeSyncConflict,
  CodeSyncDriftState,
  CodeSyncManifest,
  CodeSyncResolutionPolicy,
  CodeSyncSessionStatus,
  CodeSyncState,
  CodeSyncUnsupportedFragment,
  CodeSyncWatchState
} from "../canvas/code-sync/types";

type WatchContext = {
  watcher: FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  lastSourceHash: string | null;
};

type BindingRuntimeState = {
  status: CodeSyncBindingStatus;
  manifest: CodeSyncManifest | null;
  conflicts: CodeSyncConflict[];
  unsupportedRegions: CodeSyncUnsupportedFragment[];
  watch: WatchContext | null;
};

type SessionRuntimeState = {
  state: CodeSyncState;
  driftState: CodeSyncDriftState;
  bindings: Map<string, BindingRuntimeState>;
  lastImportAt?: string;
  lastPushAt?: string;
};

type ApplyPatches = (patches: CanvasPatch[]) => Promise<{ documentRevision: number }>;

export type CanvasCodeSyncPullResult =
  | {
    ok: true;
    bindingStatus: CodeSyncBindingStatus;
    manifest: CodeSyncManifest;
    patchesApplied: number;
    changedNodeIds: string[];
    unsupportedRegions: CodeSyncUnsupportedFragment[];
    documentRevision: number;
    repoPath: string;
  }
  | {
    ok: false;
    bindingStatus: CodeSyncBindingStatus;
    conflicts: CodeSyncConflict[];
  };

export type CanvasCodeSyncPushResult =
  | {
    ok: true;
    bindingStatus: CodeSyncBindingStatus;
    manifest: CodeSyncManifest;
    changedNodeIds: string[];
    repoPath: string;
  }
  | {
    ok: false;
    bindingStatus: CodeSyncBindingStatus;
    conflicts: CodeSyncConflict[];
  };

export class CanvasCodeSyncManager {
  private readonly worktree: string;
  private readonly onWatchedSourceChanged: (canvasSessionId: string, bindingId: string) => Promise<void>;
  private readonly sessions = new Map<string, SessionRuntimeState>();

  constructor(options: {
    worktree: string;
    onWatchedSourceChanged: (canvasSessionId: string, bindingId: string) => Promise<void>;
  }) {
    this.worktree = options.worktree;
    this.onWatchedSourceChanged = options.onWatchedSourceChanged;
  }

  async bind(options: {
    canvasSessionId: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
  }): Promise<CodeSyncBindingStatus> {
    const metadata = requireCodeSyncMetadata(options.binding);
    const runtime = this.ensureBindingState(options.canvasSessionId, options.binding);
    runtime.manifest = await loadCanvasCodeSyncManifest(
      this.worktree,
      options.document.documentId,
      options.binding.id
    );
    runtime.status = await this.refreshBindingStatus(
      options.canvasSessionId,
      options.document.documentId,
      options.binding,
      runtime,
      options.documentRevision
    );
    this.ensureWatch(options.canvasSessionId, options.binding, runtime);
    return runtime.status;
  }

  unbind(canvasSessionId: string, bindingId: string): void {
    const session = this.sessions.get(canvasSessionId);
    const runtime = session?.bindings.get(bindingId);
    runtime?.watch?.watcher.close();
    if (runtime?.watch?.debounceTimer) {
      clearTimeout(runtime.watch.debounceTimer);
    }
    session?.bindings.delete(bindingId);
    this.recomputeSession(canvasSessionId);
  }

  async getBindingStatus(
    canvasSessionId: string,
    documentId: string,
    binding: CanvasBinding,
    documentRevision: number
  ): Promise<CodeSyncBindingStatus> {
    const runtime = this.ensureBindingState(canvasSessionId, binding);
    runtime.status = await this.refreshBindingStatus(canvasSessionId, documentId, binding, runtime, documentRevision);
    return runtime.status;
  }

  getSessionStatus(
    canvasSessionId: string,
    attachedClients: number,
    leaseHolderClientId: string | null
  ): CodeSyncSessionStatus {
    const session = this.ensureSession(canvasSessionId);
    const bindings = [...session.bindings.values()].map((entry) => entry.status);
    return {
      state: session.state,
      boundFiles: unique(bindings.map((entry) => entry.repoPath)),
      attachedClients,
      activeLeaseHolder: leaseHolderClientId,
      watchState: bindings.some((entry) => entry.watchEnabled) ? "watching" : "idle",
      lastImportAt: session.lastImportAt,
      lastPushAt: session.lastPushAt,
      conflictCount: bindings.reduce((sum, entry) => sum + entry.conflictCount, 0),
      driftState: session.driftState,
      bindings
    };
  }

  async pull(options: {
    canvasSessionId: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
    resolutionPolicy?: CodeSyncResolutionPolicy;
    applyPatches: ApplyPatches;
  }): Promise<CanvasCodeSyncPullResult> {
    const runtime = this.ensureBindingState(options.canvasSessionId, options.binding);
    runtime.status = { ...runtime.status, state: "pull_pending" };
    this.recomputeSession(options.canvasSessionId);

    const metadata = requireCodeSyncMetadata(options.binding);
    const repoPath = resolveRepoPath(this.worktree, metadata.repoPath);
    const sourceText = await readFile(repoPath, "utf-8");
    const sourceHash = hashCodeSyncValue(sourceText);
    runtime.manifest = await loadCanvasCodeSyncManifest(
      this.worktree,
      options.document.documentId,
      options.binding.id
    );

    const resolutionPolicy = options.resolutionPolicy ?? "manual";
    const conflicts = detectBidirectionalConflicts(runtime.manifest, sourceHash, options.documentRevision, options.binding.id, resolutionPolicy);
    if (conflicts.length > 0) {
      runtime.conflicts = conflicts;
      runtime.status = {
        ...runtime.status,
        state: "conflict",
        driftState: "conflict",
        conflictCount: conflicts.length
      };
      this.recomputeSession(options.canvasSessionId);
      return { ok: false, bindingStatus: runtime.status, conflicts };
    }

    const parsed = parseTsxCodeSyncBinding(sourceText, repoPath, options.binding.id, metadata);
    const imported = importCodeSyncGraph({
      document: options.document,
      binding: options.binding,
      documentRevision: options.documentRevision,
      graph: parsed.graph,
      manifest: runtime.manifest
    });
    const applied = await options.applyPatches(imported.patches);
    const manifest = finalizeCodeSyncManifest(imported.manifest, {
      sourceHash: imported.manifest.sourceHash,
      documentRevision: applied.documentRevision,
      lastImportedAt: imported.manifest.lastImportedAt,
      lastPushedAt: imported.manifest.lastPushedAt
    });
    await saveCanvasCodeSyncManifest(this.worktree, manifest);
    runtime.manifest = manifest;
    runtime.conflicts = [];
    runtime.unsupportedRegions = imported.unsupportedRegions;
    runtime.status = {
      ...buildBindingStatus(options.binding, {
        state: imported.unsupportedRegions.length > 0 ? "unsupported" : "in_sync",
        driftState: "clean",
        watchEnabled: metadata.syncMode === "watch",
        lastImportedAt: manifest.lastImportedAt,
        lastPushedAt: manifest.lastPushedAt,
        conflictCount: 0,
        unsupportedCount: imported.unsupportedRegions.length
      })
    };
    if (runtime.watch) {
      runtime.watch.lastSourceHash = manifest.sourceHash;
    }
    const session = this.ensureSession(options.canvasSessionId);
    session.lastImportAt = manifest.lastImportedAt;
    session.state = runtime.status.state;
    session.driftState = runtime.status.driftState;
    this.ensureWatch(options.canvasSessionId, options.binding, runtime);
    this.recomputeSession(options.canvasSessionId);
    return {
      ok: true,
      bindingStatus: runtime.status,
      manifest,
      patchesApplied: imported.patches.length,
      changedNodeIds: imported.changedNodeIds,
      unsupportedRegions: imported.unsupportedRegions,
      documentRevision: applied.documentRevision,
      repoPath
    };
  }

  async push(options: {
    canvasSessionId: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
    resolutionPolicy?: CodeSyncResolutionPolicy;
  }): Promise<CanvasCodeSyncPushResult> {
    const runtime = this.ensureBindingState(options.canvasSessionId, options.binding);
    runtime.status = { ...runtime.status, state: "push_pending" };
    this.recomputeSession(options.canvasSessionId);

    const metadata = requireCodeSyncMetadata(options.binding);
    const repoPath = resolveRepoPath(this.worktree, metadata.repoPath);
    const sourceText = await readFile(repoPath, "utf-8");
    runtime.manifest = await loadCanvasCodeSyncManifest(
      this.worktree,
      options.document.documentId,
      options.binding.id
    );
    if (!runtime.manifest) {
      const conflicts = [{
        kind: "unsupported_change",
        bindingId: options.binding.id,
        message: "No existing code-sync manifest found. Run canvas.code.pull first."
      }] satisfies CodeSyncConflict[];
      runtime.conflicts = conflicts;
      runtime.status = {
        ...runtime.status,
        state: "conflict",
        driftState: "conflict",
        conflictCount: conflicts.length
      };
      this.recomputeSession(options.canvasSessionId);
      return { ok: false, bindingStatus: runtime.status, conflicts };
    }

    const applied = applyCanvasToTsx({
      document: options.document,
      binding: options.binding,
      manifest: runtime.manifest,
      sourceText,
      resolutionPolicy: options.resolutionPolicy
    });
    if (!applied.ok) {
      runtime.conflicts = applied.conflicts;
      runtime.status = {
        ...runtime.status,
        state: "conflict",
        driftState: "conflict",
        conflictCount: applied.conflicts.length
      };
      this.recomputeSession(options.canvasSessionId);
      return { ok: false, bindingStatus: runtime.status, conflicts: applied.conflicts };
    }

    await writeCodeSyncSource(repoPath, applied.nextSource);
    const manifest = finalizeCodeSyncManifest({
      ...runtime.manifest,
      nodeMappings: applied.nodeMappings
    }, {
      sourceHash: applied.sourceHash,
      documentRevision: options.documentRevision,
      lastImportedAt: runtime.manifest.lastImportedAt,
      lastPushedAt: new Date().toISOString()
    });
    await saveCanvasCodeSyncManifest(this.worktree, manifest);
    runtime.manifest = manifest;
    runtime.conflicts = [];
    runtime.unsupportedRegions = [];
    runtime.status = buildBindingStatus(options.binding, {
      state: "in_sync",
      driftState: "clean",
      watchEnabled: metadata.syncMode === "watch",
      lastImportedAt: manifest.lastImportedAt,
      lastPushedAt: manifest.lastPushedAt,
      conflictCount: 0,
      unsupportedCount: 0
    });
    if (runtime.watch) {
      runtime.watch.lastSourceHash = manifest.sourceHash;
    }
    const session = this.ensureSession(options.canvasSessionId);
    session.lastPushAt = manifest.lastPushedAt;
    session.state = runtime.status.state;
    session.driftState = runtime.status.driftState;
    this.ensureWatch(options.canvasSessionId, options.binding, runtime);
    this.recomputeSession(options.canvasSessionId);
    return {
      ok: true,
      bindingStatus: runtime.status,
      manifest,
      changedNodeIds: applied.changedNodeIds,
      repoPath
    };
  }

  async resolve(options: {
    canvasSessionId: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
    resolutionPolicy: CodeSyncResolutionPolicy;
    applyPatches: ApplyPatches;
  }): Promise<CanvasCodeSyncPullResult | CanvasCodeSyncPushResult> {
    if (options.resolutionPolicy === "manual") {
      const status = await this.getBindingStatus(
        options.canvasSessionId,
        options.document.documentId,
        options.binding,
        options.documentRevision
      );
      return {
        ok: false,
        bindingStatus: {
          ...status,
          state: "conflict",
          driftState: "conflict"
        },
        conflicts: [{
          kind: "ownership_violation",
          bindingId: options.binding.id,
          message: "Manual conflict resolution is not automatable. Choose prefer_code or prefer_canvas."
        }]
      };
    }
    return options.resolutionPolicy === "prefer_code"
      ? await this.pull(options)
      : await this.push(options);
  }

  disposeSession(canvasSessionId: string): void {
    const session = this.sessions.get(canvasSessionId);
    if (!session) {
      return;
    }
    for (const runtime of session.bindings.values()) {
      runtime.watch?.watcher.close();
      if (runtime.watch?.debounceTimer) {
        clearTimeout(runtime.watch.debounceTimer);
      }
    }
    this.sessions.delete(canvasSessionId);
  }

  private ensureSession(canvasSessionId: string): SessionRuntimeState {
    let session = this.sessions.get(canvasSessionId);
    if (!session) {
      session = {
        state: "idle",
        driftState: "clean",
        bindings: new Map()
      };
      this.sessions.set(canvasSessionId, session);
    }
    return session;
  }

  private ensureBindingState(canvasSessionId: string, binding: CanvasBinding): BindingRuntimeState {
    const session = this.ensureSession(canvasSessionId);
    let runtime = session.bindings.get(binding.id);
    if (!runtime) {
      runtime = {
        status: buildBindingStatus(binding, {
          state: "idle",
          driftState: "clean",
          watchEnabled: binding.codeSync?.syncMode === "watch",
          conflictCount: 0,
          unsupportedCount: 0
        }),
        manifest: null,
        conflicts: [],
        unsupportedRegions: [],
        watch: null
      };
      session.bindings.set(binding.id, runtime);
    }
    return runtime;
  }

  private async refreshBindingStatus(
    canvasSessionId: string,
    documentId: string,
    binding: CanvasBinding,
    runtime: BindingRuntimeState,
    documentRevision: number
  ): Promise<CodeSyncBindingStatus> {
    const metadata = requireCodeSyncMetadata(binding);
    const repoPath = resolveRepoPath(this.worktree, metadata.repoPath);
    let driftState: CodeSyncDriftState = runtime.status.driftState;
    let state: CodeSyncState = runtime.status.state;
    try {
      const sourceHash = hashCodeSyncValue(await readFile(repoPath, "utf-8"));
      if (!runtime.manifest) {
        runtime.manifest = await loadCanvasCodeSyncManifest(this.worktree, documentId, binding.id);
      }
      if (runtime.manifest) {
        const sourceChanged = runtime.manifest.sourceHash !== sourceHash;
        const documentChanged = runtime.manifest.documentRevision !== documentRevision;
        driftState = sourceChanged && documentChanged ? "conflict" : sourceChanged ? "source_changed" : documentChanged ? "document_changed" : "clean";
        if (driftState === "clean") {
          state = runtime.unsupportedRegions.length > 0 ? "unsupported" : "in_sync";
        } else if (driftState === "conflict") {
          state = "conflict";
        } else {
          state = "drift_detected";
        }
      }
    } catch {
      driftState = "source_changed";
      state = "drift_detected";
    }
    runtime.status = buildBindingStatus(binding, {
      state,
      driftState,
      watchEnabled: metadata.syncMode === "watch",
      lastImportedAt: runtime.manifest?.lastImportedAt,
      lastPushedAt: runtime.manifest?.lastPushedAt,
      conflictCount: runtime.conflicts.length,
      unsupportedCount: runtime.unsupportedRegions.length
    });
    this.recomputeSession(canvasSessionId);
    return runtime.status;
  }

  private ensureWatch(canvasSessionId: string, binding: CanvasBinding, runtime: BindingRuntimeState): void {
    const metadata = binding.codeSync;
    if (!metadata || metadata.syncMode !== "watch" || runtime.watch) {
      return;
    }
    const repoPath = resolveRepoPath(this.worktree, metadata.repoPath);
    const watcher = watch(repoPath, () => {
      const watchState = runtime.watch;
      if (!watchState) {
        return;
      }
      if (watchState.debounceTimer) {
        clearTimeout(watchState.debounceTimer);
      }
      watchState.debounceTimer = setTimeout(async () => {
        try {
          const nextSource = await readFile(repoPath, "utf-8");
          const nextHash = hashCodeSyncValue(nextSource);
          if (watchState.lastSourceHash && watchState.lastSourceHash === nextHash) {
            return;
          }
          watchState.lastSourceHash = nextHash;
          await this.onWatchedSourceChanged(canvasSessionId, binding.id);
        } catch {
          runtime.status = {
            ...runtime.status,
            state: "drift_detected",
            driftState: "source_changed"
          };
          this.recomputeSession(canvasSessionId);
        }
      }, 150);
    });
    runtime.watch = {
      watcher,
      debounceTimer: null,
      lastSourceHash: runtime.manifest?.sourceHash ?? null
    };
  }

  private recomputeSession(canvasSessionId: string): void {
    const session = this.sessions.get(canvasSessionId);
    if (!session) {
      return;
    }
    const bindings = [...session.bindings.values()].map((entry) => entry.status);
    session.lastImportAt = maxIso(bindings.map((entry) => entry.lastImportedAt));
    session.lastPushAt = maxIso(bindings.map((entry) => entry.lastPushedAt));
    if (bindings.some((entry) => entry.state === "conflict")) {
      session.state = "conflict";
      session.driftState = "conflict";
      return;
    }
    if (bindings.some((entry) => entry.state === "unsupported")) {
      session.state = "unsupported";
    } else if (bindings.some((entry) => entry.state === "pull_pending")) {
      session.state = "pull_pending";
    } else if (bindings.some((entry) => entry.state === "push_pending")) {
      session.state = "push_pending";
    } else if (bindings.some((entry) => entry.state === "drift_detected")) {
      session.state = "drift_detected";
    } else if (bindings.some((entry) => entry.state === "in_sync")) {
      session.state = "in_sync";
    } else {
      session.state = "idle";
    }
    if (bindings.some((entry) => entry.driftState === "source_changed")) {
      session.driftState = "source_changed";
    } else if (bindings.some((entry) => entry.driftState === "document_changed")) {
      session.driftState = "document_changed";
    } else {
      session.driftState = "clean";
    }
  }
}

function resolveRepoPath(worktree: string, repoPath: string): string {
  return isAbsolute(repoPath) ? repoPath : resolve(worktree, repoPath);
}

function requireCodeSyncMetadata(binding: CanvasBinding): CanvasCodeSyncBindingMetadata {
  if (!binding.codeSync) {
    throw new Error(`Binding ${binding.id} is missing code-sync metadata.`);
  }
  return binding.codeSync;
}

function buildBindingStatus(
  binding: CanvasBinding,
  input: {
    state: CodeSyncState;
    driftState: CodeSyncDriftState;
    watchEnabled: boolean;
    lastImportedAt?: string;
    lastPushedAt?: string;
    conflictCount: number;
    unsupportedCount: number;
  }
): CodeSyncBindingStatus {
  const metadata = requireCodeSyncMetadata(binding);
  return {
    bindingId: binding.id,
    nodeId: binding.nodeId,
    repoPath: metadata.repoPath,
    adapter: metadata.adapter,
    syncMode: metadata.syncMode,
    projection: metadata.projection ?? "canvas_html",
    state: input.state,
    driftState: input.driftState,
    watchEnabled: input.watchEnabled,
    lastImportedAt: input.lastImportedAt,
    lastPushedAt: input.lastPushedAt,
    conflictCount: input.conflictCount,
    unsupportedCount: input.unsupportedCount
  };
}

function detectBidirectionalConflicts(
  manifest: CodeSyncManifest | null,
  sourceHash: string,
  documentRevision: number,
  bindingId: string,
  resolutionPolicy: CodeSyncResolutionPolicy
): CodeSyncConflict[] {
  if (!manifest || resolutionPolicy !== "manual") {
    return [];
  }
  const sourceChanged = manifest.sourceHash !== sourceHash;
  const documentChanged = manifest.documentRevision !== documentRevision;
  if (!sourceChanged || !documentChanged) {
    return [];
  }
  return [
    {
      kind: "source_hash_changed",
      bindingId,
      message: "Source changed since the last code-sync baseline."
    },
    {
      kind: "document_revision_changed",
      bindingId,
      message: "Canvas document changed since the last code-sync baseline."
    }
  ];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function maxIso(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => typeof value === "string").sort().at(-1);
}
