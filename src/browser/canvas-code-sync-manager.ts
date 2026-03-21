import { readFile } from "fs/promises";
import { watch, type FSWatcher } from "fs";
import { resolve, isAbsolute } from "path";
import type { CanvasBinding, CanvasDocument, CanvasNode, CanvasPatch } from "../canvas/types";
import { loadCanvasAdapterPlugins } from "../canvas/adapter-plugins/loader";
import type { CanvasAdapterPluginDeclaration, CanvasAdapterPluginLoadError } from "../canvas/adapter-plugins/types";
import { createFrameworkAdapterRegistry } from "../canvas/framework-adapters/registry";
import { createLibraryAdapterRegistry } from "../canvas/library-adapters/registry";
import {
  loadCanvasCodeSyncManifest,
  saveCanvasCodeSyncManifest
} from "../canvas/repo-store";
import { applyCanvasToTsx } from "../canvas/code-sync/apply-tsx";
import { hashCodeSyncValue } from "../canvas/code-sync/hash";
import { importCodeSyncGraph } from "../canvas/code-sync/import";
import { finalizeCodeSyncManifest, writeCodeSyncSource } from "../canvas/code-sync/write";
import { hasCanvasTokenReferences } from "../canvas/token-references";
import type {
  CanvasCodeSyncBindingMetadata,
  CodeSyncBuiltInFrameworkAdapterId,
  CodeSyncBindingStatus,
  CodeSyncCapability,
  CodeSyncCapabilityGrant,
  CodeSyncConflict,
  CodeSyncDriftState,
  CodeSyncManifest,
  CodeSyncResolutionPolicy,
  CodeSyncSessionStatus,
  CodeSyncState,
  CodeSyncStatusReason,
  CodeSyncUnsupportedFragment,
  CodeSyncWatchState
} from "../canvas/code-sync/types";
import { normalizeCodeSyncBindingMetadata } from "../canvas/code-sync/types";

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
  worktree: string;
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
  private readonly configAdapterPluginDeclarations: CanvasAdapterPluginDeclaration[];
  private readonly sessions = new Map<string, SessionRuntimeState>();

  constructor(options: {
    worktree: string;
    onWatchedSourceChanged: (canvasSessionId: string, bindingId: string) => Promise<void>;
    configAdapterPluginDeclarations?: CanvasAdapterPluginDeclaration[];
  }) {
    this.worktree = options.worktree;
    this.onWatchedSourceChanged = options.onWatchedSourceChanged;
    this.configAdapterPluginDeclarations = options.configAdapterPluginDeclarations ?? [];
  }

  private async loadAdapterRuntime(worktree: string) {
    const frameworkRegistry = createFrameworkAdapterRegistry();
    const libraryRegistry = createLibraryAdapterRegistry();
    const { plugins, errors } = await loadCanvasAdapterPlugins({
      worktree,
      configDeclarations: this.configAdapterPluginDeclarations,
      frameworkRegistry,
      libraryRegistry
    });
    return { frameworkRegistry, libraryRegistry, plugins, errors };
  }

  async bind(options: {
    canvasSessionId: string;
    worktree?: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
  }): Promise<CodeSyncBindingStatus> {
    const worktree = this.ensureSession(options.canvasSessionId, options.worktree).worktree;
    const runtime = this.ensureBindingState(options.canvasSessionId, options.binding);
    runtime.manifest = await loadCanvasCodeSyncManifest(
      worktree,
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
    worktree: string | undefined,
    documentId: string,
    binding: CanvasBinding,
    documentRevision: number
  ): Promise<CodeSyncBindingStatus> {
    this.ensureSession(canvasSessionId, worktree);
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
    worktree?: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
    resolutionPolicy?: CodeSyncResolutionPolicy;
    applyPatches: ApplyPatches;
  }): Promise<CanvasCodeSyncPullResult> {
    const worktree = this.ensureSession(options.canvasSessionId, options.worktree).worktree;
    const runtime = this.ensureBindingState(options.canvasSessionId, options.binding);
    runtime.status = { ...runtime.status, state: "pull_pending" };
    this.recomputeSession(options.canvasSessionId);

    const metadata = requireCodeSyncMetadata(options.binding);
    const adapterRuntime = await this.loadAdapterRuntime(worktree);
    const repoPath = resolveRepoPath(worktree, metadata.repoPath);
    const sourceText = await readFile(repoPath, "utf-8");
    const sourceHash = hashCodeSyncValue(sourceText);
    runtime.manifest = await loadCanvasCodeSyncManifest(
      worktree,
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

    const frameworkAdapter = adapterRuntime.frameworkRegistry.resolveForBinding(metadata)
      ?? adapterRuntime.frameworkRegistry.detectForPath(repoPath);
    if (!frameworkAdapter) {
      const reasonCode = resolvePluginReasonCode(metadata, adapterRuntime.errors);
      runtime.status = buildBindingStatus(options.binding, {
        state: "unsupported",
        driftState: "clean",
        watchEnabled: metadata.syncMode === "watch",
        lastImportedAt: runtime.manifest?.lastImportedAt,
        lastPushedAt: runtime.manifest?.lastPushedAt,
        conflictCount: 0,
        unsupportedCount: 1,
        manifest: runtime.manifest,
        reasonCode,
        capabilityDenials: metadata.grantedCapabilities.filter((entry) => !entry.granted)
      });
      this.recomputeSession(options.canvasSessionId);
      return {
        ok: false,
        bindingStatus: runtime.status,
        conflicts: [{
          kind: "unsupported_change",
          bindingId: options.binding.id,
          message: `No framework adapter is available for ${metadata.frameworkAdapterId}.`
        }]
      };
    }
    const pullCapabilityDenials = capabilityDenialsFor(metadata, "code_pull");
    if (pullCapabilityDenials.length > 0) {
      runtime.status = buildBindingStatus(options.binding, {
        state: "unsupported",
        driftState: "clean",
        watchEnabled: metadata.syncMode === "watch",
        lastImportedAt: runtime.manifest?.lastImportedAt,
        lastPushedAt: runtime.manifest?.lastPushedAt,
        conflictCount: 0,
        unsupportedCount: 1,
        manifest: runtime.manifest,
        reasonCode: "capability_denied",
        capabilityDenials: pullCapabilityDenials
      });
      this.recomputeSession(options.canvasSessionId);
      return {
        ok: false,
        bindingStatus: runtime.status,
        conflicts: [{
          kind: "unsupported_change",
          bindingId: options.binding.id,
          message: `Framework adapter ${metadata.frameworkAdapterId} does not grant code_pull.`
        }]
      };
    }
    const entrypoint = frameworkAdapter.detectEntrypoint(repoPath, sourceText, { metadata });
    if (!entrypoint) {
      runtime.status = buildBindingStatus(options.binding, {
        state: "unsupported",
        driftState: "clean",
        watchEnabled: metadata.syncMode === "watch",
        lastImportedAt: runtime.manifest?.lastImportedAt,
        lastPushedAt: runtime.manifest?.lastPushedAt,
        conflictCount: 0,
        unsupportedCount: 1,
        manifest: runtime.manifest,
        reasonCode: "requires_rebind",
        capabilityDenials: []
      });
      this.recomputeSession(options.canvasSessionId);
      return {
        ok: false,
        bindingStatus: runtime.status,
        conflicts: [{
          kind: "unsupported_change",
          bindingId: options.binding.id,
          message: `Unable to detect an entrypoint for ${metadata.repoPath}.`
        }]
      };
    }
    const parsed = frameworkAdapter.parseSource(
      entrypoint,
      sourceText,
      {
        bindingId: options.binding.id,
        metadata
      },
      adapterRuntime.libraryRegistry
    );
    const resolvedBinding = {
      ...options.binding,
      codeSync: {
        ...metadata,
        libraryAdapterIds: parsed.libraryAdapterIds
      }
    };
    const tokenContext = {
      bindingId: options.binding.id,
      metadata,
      activeModeId: readActiveTokenModeId(options.document)
    };
    const imported = importCodeSyncGraph({
      document: options.document,
      binding: resolvedBinding,
      documentRevision: options.documentRevision,
      graph: parsed.graph,
      manifest: runtime.manifest,
      tokenRefsByNodeKey: frameworkAdapter.readTokenRefs(parsed.graph, tokenContext)
    });
    const applied = await options.applyPatches(imported.patches);
    const manifest = finalizeCodeSyncManifest(imported.manifest, {
      sourceHash: imported.manifest.sourceHash,
      documentRevision: applied.documentRevision,
      lastImportedAt: imported.manifest.lastImportedAt,
      lastPushedAt: imported.manifest.lastPushedAt
    });
    await saveCanvasCodeSyncManifest(worktree, manifest);
    runtime.manifest = manifest;
    runtime.conflicts = [];
    runtime.unsupportedRegions = imported.unsupportedRegions;
    runtime.status = {
      ...buildBindingStatus(resolvedBinding, {
        state: imported.unsupportedRegions.length > 0 ? "unsupported" : "in_sync",
        driftState: "clean",
        watchEnabled: metadata.syncMode === "watch",
        lastImportedAt: manifest.lastImportedAt,
        lastPushedAt: manifest.lastPushedAt,
        conflictCount: 0,
        unsupportedCount: imported.unsupportedRegions.length,
        manifest,
        reasonCode: manifest.reasonCode,
        capabilityDenials: capabilityDenialsFor(resolvedBinding.codeSync ?? metadata)
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
    worktree?: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
    resolutionPolicy?: CodeSyncResolutionPolicy;
  }): Promise<CanvasCodeSyncPushResult> {
    const worktree = this.ensureSession(options.canvasSessionId, options.worktree).worktree;
    const runtime = this.ensureBindingState(options.canvasSessionId, options.binding);
    runtime.status = { ...runtime.status, state: "push_pending" };
    this.recomputeSession(options.canvasSessionId);

    const metadata = requireCodeSyncMetadata(options.binding);
    const adapterRuntime = await this.loadAdapterRuntime(worktree);
    const repoPath = resolveRepoPath(worktree, metadata.repoPath);
    const sourceText = await readFile(repoPath, "utf-8");
    runtime.manifest = await loadCanvasCodeSyncManifest(
      worktree,
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
    const frameworkAdapter = adapterRuntime.frameworkRegistry.resolveForBinding(metadata)
      ?? adapterRuntime.frameworkRegistry.detectForPath(repoPath);
    if (!frameworkAdapter) {
      const reasonCode = resolvePluginReasonCode(metadata, adapterRuntime.errors);
      runtime.status = buildBindingStatus(options.binding, {
        state: "unsupported",
        driftState: "clean",
        watchEnabled: metadata.syncMode === "watch",
        lastImportedAt: runtime.manifest?.lastImportedAt,
        lastPushedAt: runtime.manifest?.lastPushedAt,
        conflictCount: 0,
        unsupportedCount: 1,
        manifest: runtime.manifest,
        reasonCode,
        capabilityDenials: metadata.grantedCapabilities.filter((entry) => !entry.granted)
      });
      this.recomputeSession(options.canvasSessionId);
      return {
        ok: false,
        bindingStatus: runtime.status,
        conflicts: [{
          kind: "unsupported_change",
          bindingId: options.binding.id,
          message: `No framework adapter is available for ${metadata.frameworkAdapterId}.`
        }]
      };
    }
    const pushCapabilityDenials = capabilityDenialsFor(metadata, "code_push");
    const subtreeContainsTokenRefs = documentSubtreeHasTokenRefs(options.document, options.binding.nodeId);
    if (subtreeContainsTokenRefs) {
      const tokenRoundTripCapabilityDenials = tokenRoundTripDenials(
        metadata,
        runtime.manifest?.libraryAdapterIds ?? metadata.libraryAdapterIds,
        adapterRuntime.libraryRegistry
      );
      if (!frameworkAdapter.capabilities.includes("token_roundtrip") || tokenRoundTripCapabilityDenials.length > 0) {
        runtime.status = buildBindingStatus(options.binding, {
          state: "unsupported",
          driftState: "clean",
          watchEnabled: metadata.syncMode === "watch",
          lastImportedAt: runtime.manifest?.lastImportedAt,
          lastPushedAt: runtime.manifest?.lastPushedAt,
          conflictCount: 0,
          unsupportedCount: 1,
          manifest: runtime.manifest,
          reasonCode: "capability_denied",
          capabilityDenials: tokenRoundTripCapabilityDenials
        });
        this.recomputeSession(options.canvasSessionId);
        return {
          ok: false,
          bindingStatus: runtime.status,
          conflicts: [{
            kind: "unsupported_change",
            bindingId: options.binding.id,
            message: describeTokenRoundTripDenial(
              metadata.frameworkAdapterId,
              tokenRoundTripCapabilityDenials
            )
          }]
        };
      }
    }
    if (pushCapabilityDenials.length > 0 || metadata.sourceFamily !== "react-tsx") {
      runtime.status = buildBindingStatus(options.binding, {
        state: "unsupported",
        driftState: "clean",
        watchEnabled: metadata.syncMode === "watch",
        lastImportedAt: runtime.manifest?.lastImportedAt,
        lastPushedAt: runtime.manifest?.lastPushedAt,
        conflictCount: 0,
        unsupportedCount: 1,
        manifest: runtime.manifest,
        reasonCode: "capability_denied",
        capabilityDenials: pushCapabilityDenials.length > 0
          ? pushCapabilityDenials
          : [{
            capability: "code_push",
            granted: false,
            reasonCode: "capability_denied",
            details: {
              frameworkAdapterId: metadata.frameworkAdapterId
            }
          }]
      });
      this.recomputeSession(options.canvasSessionId);
      return {
        ok: false,
        bindingStatus: runtime.status,
        conflicts: [{
          kind: "unsupported_change",
          bindingId: options.binding.id,
          message: `Framework adapter ${metadata.frameworkAdapterId} does not support code_push.`
        }]
      };
    }

    const applied = applyCanvasToTsx({
      document: options.document,
      binding: options.binding,
      manifest: runtime.manifest,
      sourceText,
      resolutionPolicy: options.resolutionPolicy,
      emitTokenRefs: (node) => frameworkAdapter.emitTokenRefs(node, {
        bindingId: options.binding.id,
        metadata,
        activeModeId: readActiveTokenModeId(options.document)
      }),
      themeAttributes: frameworkAdapter.emitThemeBindings({
        bindingId: options.binding.id,
        metadata,
        activeModeId: readActiveTokenModeId(options.document)
      })
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
    await saveCanvasCodeSyncManifest(worktree, manifest);
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
      unsupportedCount: 0,
      manifest,
      reasonCode: manifest.reasonCode,
      capabilityDenials: capabilityDenialsFor(metadata)
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
    worktree?: string;
    document: CanvasDocument;
    documentRevision: number;
    binding: CanvasBinding;
    resolutionPolicy: CodeSyncResolutionPolicy;
    applyPatches: ApplyPatches;
  }): Promise<CanvasCodeSyncPullResult | CanvasCodeSyncPushResult> {
    const worktree = this.ensureSession(options.canvasSessionId, options.worktree).worktree;
    if (options.resolutionPolicy === "manual") {
      const status = await this.getBindingStatus(
        options.canvasSessionId,
        worktree,
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
      ? await this.pull({ ...options, worktree })
      : await this.push({ ...options, worktree });
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

  private ensureSession(canvasSessionId: string, worktree?: string): SessionRuntimeState {
    let session = this.sessions.get(canvasSessionId);
    if (!session) {
      session = {
        worktree: worktree ?? this.worktree,
        state: "idle",
        driftState: "clean",
        bindings: new Map()
      };
      this.sessions.set(canvasSessionId, session);
    } else if (worktree && session.worktree !== worktree) {
      session.worktree = worktree;
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
          unsupportedCount: 0,
          manifest: null,
          reasonCode: binding.codeSync?.reasonCode ?? "none",
          capabilityDenials: capabilityDenialsFor(binding.codeSync)
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
    const worktree = this.ensureSession(canvasSessionId).worktree;
    const metadata = requireCodeSyncMetadata(binding);
    const adapterRuntime = await this.loadAdapterRuntime(worktree);
    const repoPath = resolveRepoPath(worktree, metadata.repoPath);
    let driftState: CodeSyncDriftState = runtime.status.driftState;
    let state: CodeSyncState = runtime.status.state;
    let reasonCode: CodeSyncStatusReason = runtime.manifest?.reasonCode ?? metadata.reasonCode;
    let missingAdapter = false;
    try {
      const sourceHash = hashCodeSyncValue(await readFile(repoPath, "utf-8"));
      if (!runtime.manifest) {
        runtime.manifest = await loadCanvasCodeSyncManifest(worktree, documentId, binding.id);
      }
      const frameworkAdapter = adapterRuntime.frameworkRegistry.resolveForBinding(metadata)
        ?? adapterRuntime.frameworkRegistry.detectForPath(repoPath);
      if (!frameworkAdapter) {
        reasonCode = resolvePluginReasonCode(metadata, adapterRuntime.errors);
        state = "unsupported";
        driftState = "clean";
        missingAdapter = true;
      }
      if (runtime.manifest) {
        const sourceChanged = runtime.manifest.sourceHash !== sourceHash;
        const documentChanged = runtime.manifest.documentRevision !== documentRevision;
        driftState = sourceChanged && documentChanged ? "conflict" : sourceChanged ? "source_changed" : documentChanged ? "document_changed" : "clean";
        if (driftState === "clean" && missingAdapter) {
          state = "unsupported";
        } else if (driftState === "clean") {
          state = runtime.unsupportedRegions.length > 0 ? "unsupported" : "in_sync";
        } else if (driftState === "conflict") {
          state = "conflict";
        } else {
          state = "drift_detected";
        }
        reasonCode = runtime.manifest.reasonCode;
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
      unsupportedCount: runtime.unsupportedRegions.length,
      manifest: runtime.manifest,
      reasonCode,
      capabilityDenials: capabilityDenialsFor(metadata)
    });
    this.recomputeSession(canvasSessionId);
    return runtime.status;
  }

  private ensureWatch(canvasSessionId: string, binding: CanvasBinding, runtime: BindingRuntimeState): void {
    const metadata = binding.codeSync;
    if (!metadata || metadata.syncMode !== "watch" || runtime.watch) {
      return;
    }
    const repoPath = resolveRepoPath(this.ensureSession(canvasSessionId).worktree, metadata.repoPath);
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
  return normalizeCodeSyncBindingMetadata(binding.codeSync);
}

function capabilityDenialsFor(
  metadata: CanvasCodeSyncBindingMetadata | undefined,
  requiredCapability?: CodeSyncCapability
): CodeSyncCapabilityGrant[] {
  if (!metadata) {
    return requiredCapability
      ? [{
        capability: requiredCapability,
        granted: false,
        reasonCode: "capability_denied"
      }]
      : [];
  }
  const normalizedMetadata = normalizeCodeSyncBindingMetadata(metadata);
  const denials = normalizedMetadata.grantedCapabilities.filter((entry) => !entry.granted);
  if (!requiredCapability) {
    return denials;
  }
  const requiredGrant = normalizedMetadata.grantedCapabilities.find((entry) => entry.capability === requiredCapability);
  if (requiredGrant?.granted) {
    return denials;
  }
  if (requiredGrant) {
    return [...denials, requiredGrant];
  }
  return [
    ...denials,
    {
      capability: requiredCapability,
      granted: false,
      reasonCode: "capability_denied"
    }
  ];
}

function resolvePluginReasonCode(
  metadata: CanvasCodeSyncBindingMetadata,
  errors: CanvasAdapterPluginLoadError[]
): CodeSyncStatusReason {
  if (!metadata.pluginId) {
    return metadata.reasonCode;
  }
  const error = errors.find((entry) => entry.pluginId === metadata.pluginId);
  if (!error) {
    return "plugin_not_found";
  }
  return error.code === "plugin_not_found" ? "plugin_not_found" : "plugin_load_failed";
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
    manifest?: CodeSyncManifest | null;
    reasonCode: CodeSyncStatusReason;
    capabilityDenials: CodeSyncCapabilityGrant[];
  }
): CodeSyncBindingStatus {
  const metadata = requireCodeSyncMetadata(binding);
  const manifest = input.manifest ?? null;
  const declaredCapabilities = metadata.declaredCapabilities;
  const grantedCapabilities = metadata.grantedCapabilities
    .filter((entry) => entry.granted)
    .map((entry) => entry.capability);
  return {
    bindingId: binding.id,
    nodeId: binding.nodeId,
    repoPath: metadata.repoPath,
    adapter: metadata.adapter,
    frameworkAdapterId: metadata.frameworkAdapterId,
    frameworkId: metadata.frameworkId,
    sourceFamily: metadata.sourceFamily,
    adapterKind: metadata.adapterKind,
    adapterVersion: metadata.adapterVersion,
    syncMode: metadata.syncMode,
    projection: metadata.projection ?? "canvas_html",
    state: input.state,
    driftState: input.driftState,
    watchEnabled: input.watchEnabled,
    lastImportedAt: input.lastImportedAt,
    lastPushedAt: input.lastPushedAt,
    conflictCount: input.conflictCount,
    unsupportedCount: input.unsupportedCount,
    pluginId: metadata.pluginId,
    libraryAdapterIds: manifest?.libraryAdapterIds ?? metadata.libraryAdapterIds,
    manifestVersion: manifest?.manifestVersion ?? metadata.manifestVersion,
    declaredCapabilities,
    grantedCapabilities,
    capabilityDenials: input.capabilityDenials,
    reasonCode: input.reasonCode
  };
}

function readActiveTokenModeId(document: CanvasDocument): string | null {
  const metadata = document.tokens.metadata;
  return typeof metadata.activeModeId === "string" && metadata.activeModeId.trim().length > 0
    ? metadata.activeModeId
    : null;
}

function findCanvasNode(document: CanvasDocument, nodeId: string): CanvasNode {
  for (const page of document.pages) {
    const node = page.nodes.find((entry) => entry.id === nodeId);
    if (node) {
      return node;
    }
  }
  throw new Error(`Unknown canvas node: ${nodeId}`);
}

function documentSubtreeHasTokenRefs(document: CanvasDocument, nodeId: string): boolean {
  const pending = [findCanvasNode(document, nodeId)];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (hasCanvasTokenReferences(node.tokenRefs)) {
      return true;
    }
    for (const childId of node.childIds) {
      pending.push(findCanvasNode(document, childId));
    }
  }
  return false;
}

function defaultFrameworkCapabilities(frameworkAdapterId: string): CodeSyncCapability[] {
  const capabilityMap: Record<CodeSyncBuiltInFrameworkAdapterId, CodeSyncCapability[]> = {
    "builtin:react-tsx-v2": ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"],
    "builtin:html-static-v1": ["preview", "inventory_extract", "code_pull"],
    "builtin:custom-elements-v1": ["preview", "inventory_extract", "code_pull"],
    "builtin:vue-sfc-v1": ["preview", "inventory_extract", "code_pull"],
    "builtin:svelte-sfc-v1": ["preview", "inventory_extract", "code_pull"]
  };
  return capabilityMap[frameworkAdapterId as CodeSyncBuiltInFrameworkAdapterId] ?? ["preview"];
}

function tokenRoundTripDenials(
  metadata: CanvasCodeSyncBindingMetadata,
  libraryAdapterIds: string[],
  libraryRegistry: ReturnType<typeof createLibraryAdapterRegistry>
): CodeSyncCapabilityGrant[] {
  const frameworkCapabilities = new Set(defaultFrameworkCapabilities(metadata.frameworkAdapterId));
  const denials = capabilityDenialsFor(metadata, "token_roundtrip");
  if (!frameworkCapabilities.has("token_roundtrip")) {
    denials.push({
      capability: "token_roundtrip",
      granted: false,
      reasonCode: "capability_denied",
      details: {
        frameworkAdapterId: metadata.frameworkAdapterId
      }
    });
  }
  for (const libraryAdapterId of libraryAdapterIds) {
    const adapter = libraryRegistry.get(libraryAdapterId);
    if (adapter && adapter.capabilities.includes("token_roundtrip")) {
      continue;
    }
    denials.push({
      capability: "token_roundtrip",
      granted: false,
      reasonCode: "capability_denied",
      details: {
        libraryAdapterId
      }
    });
  }
  return uniqueCapabilityDenials(denials);
}

function uniqueCapabilityDenials(denials: CodeSyncCapabilityGrant[]): CodeSyncCapabilityGrant[] {
  const seen = new Set<string>();
  return denials.filter((entry) => {
    const scope = typeof entry.details?.libraryAdapterId === "string"
      ? `library:${entry.details.libraryAdapterId}`
      : typeof entry.details?.frameworkAdapterId === "string"
        ? `framework:${entry.details.frameworkAdapterId}`
        : "binding";
    const key = `${entry.capability}:${scope}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function describeTokenRoundTripDenial(
  frameworkAdapterId: string,
  denials: CodeSyncCapabilityGrant[]
): string {
  const libraryDenial = denials.find((entry) => typeof entry.details?.libraryAdapterId === "string");
  if (libraryDenial && typeof libraryDenial.details?.libraryAdapterId === "string") {
    return `Library adapter ${libraryDenial.details.libraryAdapterId} does not declare token_roundtrip.`;
  }
  return `Framework adapter ${frameworkAdapterId} does not support token_roundtrip.`;
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
