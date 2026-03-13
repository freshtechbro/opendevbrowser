import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import type { OpenDevBrowserConfig } from "../config";
import type { RelayLike } from "../relay/relay-types";
import { resolveRelayEndpoint } from "../relay/relay-endpoints";
import type { BrowserManagerLike } from "./manager-types";
import { CanvasClient } from "./canvas-client";
import {
  buildDocumentContext,
  buildGovernanceBlockStates,
  CANVAS_PROJECT_DEFAULTS,
  CanvasDocumentStore,
  createDefaultCanvasDocument,
  evaluateCanvasWarnings,
  missingRequiredSaveBlocks,
  normalizeCanvasDocument,
  readCanvasIconRoles,
  resolveCanvasLibraryPolicy,
  validateCanvasSave,
  validateGenerationPlan
} from "../canvas/document-store";
import {
  buildCanvasParityArtifact,
  renderCanvasBindingHtml,
  renderCanvasDocumentComponent,
  renderCanvasDocumentHtml
} from "../canvas/export";
import { loadCanvasDocument, loadCanvasDocumentById, resolveCanvasRepoPath, saveCanvasDocument } from "../canvas/repo-store";
import type {
  CanvasBlocker,
  CanvasBinding,
  CanvasDegradeReason,
  CanvasDocument,
  CanvasFeedbackItem,
  CanvasPatch,
  CanvasPlanStatus,
  CanvasPreflightState,
  CanvasPreviewState,
  CanvasPrototype,
  CanvasSessionMode,
  CanvasSessionSummary,
  CanvasTargetState,
  CanvasValidationWarning
} from "../canvas/types";
import { CANVAS_SCHEMA_VERSION } from "../canvas/types";
import { CanvasCodeSyncManager } from "./canvas-code-sync-manager";
import { CanvasSessionSyncManager } from "./canvas-session-sync-manager";
import type { CodeSyncAttachMode, CodeSyncOwnership, CodeSyncResolutionPolicy } from "../canvas/code-sync/types";
import { applyRuntimePreviewBridge } from "./canvas-runtime-preview-bridge";

type CanvasCommandParams = Record<string, unknown>;

export const PUBLIC_CANVAS_COMMANDS = [
  "canvas.session.open",
  "canvas.session.attach",
  "canvas.session.status",
  "canvas.session.close",
  "canvas.capabilities.get",
  "canvas.plan.set",
  "canvas.plan.get",
  "canvas.document.load",
  "canvas.document.patch",
  "canvas.document.save",
  "canvas.document.export",
  "canvas.tab.open",
  "canvas.tab.close",
  "canvas.overlay.mount",
  "canvas.overlay.unmount",
  "canvas.overlay.select",
  "canvas.preview.render",
  "canvas.preview.refresh",
  "canvas.feedback.poll",
  "canvas.feedback.subscribe",
  "canvas.code.bind",
  "canvas.code.unbind",
  "canvas.code.pull",
  "canvas.code.push",
  "canvas.code.status",
  "canvas.code.resolve"
] as const;

type CanvasSession = {
  canvasSessionId: string;
  browserSessionId: string | null;
  documentRepoPath: string | null;
  leaseId: string;
  mode: CanvasSessionMode;
  store: CanvasDocumentStore;
  preflightState: CanvasPreflightState;
  planStatus: CanvasPlanStatus;
  activeTargets: Map<string, CanvasTargetState>;
  overlayMounts: Map<string, { mountId: string; targetId: string; mountedAt: string }>;
  designTabTargetId: string | null;
  feedback: CanvasFeedbackItem[];
  nextFeedbackSeq: number;
  editorSelection: {
    pageId: string | null;
    nodeId: string | null;
    targetId: string | null;
    updatedAt: string | null;
  };
  feedbackSubscriptions: Map<string, CanvasFeedbackSubscription>;
};

type CanvasFeedbackStreamEvent =
  | {
    eventType: "feedback.item";
    item: CanvasFeedbackItem;
  }
  | {
    eventType: "feedback.heartbeat";
    cursor: string | null;
    ts: string;
    activeTargetIds: string[];
  }
  | {
    eventType: "feedback.complete";
    cursor: string | null;
    ts: string;
    reason: "session_closed" | "lease_revoked" | "subscription_replaced" | "document_unloaded";
  };

type CanvasFeedbackSubscription = {
  id: string;
  categories: Set<string>;
  targetIds: Set<string>;
  queue: CanvasFeedbackStreamEvent[];
  waiters: Array<(event: CanvasFeedbackStreamEvent | null) => void>;
  cursor: string | null;
  heartbeatTimer: NodeJS.Timeout;
  active: boolean;
};

type ExtensionOverlayResult = {
  mountId?: string;
  targetId?: string;
  overlayState?: string;
  previewState?: CanvasPreviewState;
  capabilities?: Record<string, unknown>;
  selection?: Record<string, unknown>;
  warnings?: CanvasValidationWarning[];
  ok?: boolean;
};

type DirectPageLike = {
  addStyleTag: (options: { content: string }) => Promise<unknown>;
  evaluate: <TArg, TResult>(pageFunction: (arg: TArg) => TResult | Promise<TResult>, arg: TArg) => Promise<TResult>;
};

type PreviewSyncSource = "agent" | "editor";

type PreviewRenderContext = {
  cause: "manual" | "patch_sync";
  source?: PreviewSyncSource;
  syncAfter?: boolean;
};

const DIRECT_OVERLAY_STYLE = `
#opendevbrowser-canvas-overlay {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  max-width: 320px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(7,17,29,0.92);
  color: #f3f6fb;
  font: 12px/1.4 "Segoe UI", sans-serif;
  box-shadow: 0 18px 40px rgba(0,0,0,0.3);
}
#opendevbrowser-canvas-overlay strong { display:block; margin-bottom:4px; }
.opendevbrowser-canvas-highlight {
  outline: 2px solid #20d5c6 !important;
  outline-offset: 3px !important;
}
`;

const FEEDBACK_BATCH_SIZE = 25;
const FEEDBACK_RETENTION_LIMIT = 200;

export type CanvasManagerLike = {
  execute: (command: string, params?: CanvasCommandParams) => Promise<unknown>;
};

export class CanvasManager implements CanvasManagerLike {
  private readonly worktree: string;
  private readonly browserManager: BrowserManagerLike;
  private readonly config: OpenDevBrowserConfig;
  private readonly relay?: RelayLike;
  private readonly sessionSyncManager = new CanvasSessionSyncManager();
  private readonly codeSyncManager: CanvasCodeSyncManager;
  private readonly sessions = new Map<string, CanvasSession>();
  private canvasClient: CanvasClient | null = null;
  private canvasEndpoint: string | null = null;

  constructor(options: {
    worktree: string;
    browserManager: BrowserManagerLike;
    config: OpenDevBrowserConfig;
    relay?: RelayLike;
  }) {
    this.worktree = options.worktree;
    this.browserManager = options.browserManager;
    this.config = options.config;
    this.relay = options.relay;
    this.codeSyncManager = new CanvasCodeSyncManager({
      worktree: this.worktree,
      onWatchedSourceChanged: async (canvasSessionId, bindingId) => {
        await this.handleWatchedSourceChange(canvasSessionId, bindingId);
      }
    });
  }

  async execute(command: string, params: CanvasCommandParams = {}): Promise<unknown> {
    switch (command) {
      case "canvas.session.open":
        return await this.openSession(params);
      case "canvas.session.attach":
        return this.attachSession(params);
      case "canvas.session.status":
        return this.getSessionStatus(params);
      case "canvas.session.close":
        return await this.closeSession(params);
      case "canvas.capabilities.get":
        return this.getCapabilities(params);
      case "canvas.plan.set":
        return this.setPlan(params);
      case "canvas.plan.get":
        return this.getPlan(params);
      case "canvas.document.load":
        return await this.loadDocument(params);
      case "canvas.document.patch":
        return await this.patchDocument(params);
      case "canvas.document.save":
        return await this.saveDocument(params);
      case "canvas.document.export":
        return await this.exportDocument(params);
      case "canvas.tab.open":
        return await this.openTab(params);
      case "canvas.tab.close":
        return await this.closeTab(params);
      case "canvas.overlay.mount":
        return await this.mountOverlay(params);
      case "canvas.overlay.unmount":
        return await this.unmountOverlay(params);
      case "canvas.overlay.select":
        return await this.selectOverlay(params);
      case "canvas.preview.render":
        return await this.renderPreview(params);
      case "canvas.preview.refresh":
        return await this.refreshPreview(params);
      case "canvas.feedback.poll":
        return this.pollFeedback(params);
      case "canvas.feedback.subscribe":
        return this.subscribeFeedback(params);
      case "canvas.code.bind":
        return await this.bindCodeSync(params);
      case "canvas.code.unbind":
        return await this.unbindCodeSync(params);
      case "canvas.code.pull":
        return await this.pullCodeSync(params);
      case "canvas.code.push":
        return await this.pushCodeSync(params);
      case "canvas.code.status":
        return await this.codeSyncStatus(params);
      case "canvas.code.resolve":
        return await this.resolveCodeSync(params);
      default:
        throw new Error(`Unsupported canvas command: ${command}`);
    }
  }

  private async openSession(params: CanvasCommandParams): Promise<unknown> {
    const browserSessionId = optionalString(params.browserSessionId);
    const requestedDocumentId = optionalString(params.documentId);
    const repoPath = optionalString(params.repoPath);
    const mode = (optionalString(params.mode) as CanvasSessionMode | null) ?? "dual-track";
    const document = repoPath
      ? normalizeCanvasDocument(await loadCanvasDocument(this.worktree, repoPath))
      : createDefaultCanvasDocument(requestedDocumentId ?? undefined);
    const sessionId = `canvas_${randomUUID()}`;
    const leaseId = `lease_${randomUUID()}`;
    const session: CanvasSession = {
      canvasSessionId: sessionId,
      browserSessionId,
      documentRepoPath: repoPath ?? null,
      leaseId,
      mode,
      store: new CanvasDocumentStore(document),
      preflightState: "handshake_read",
      planStatus: isNonEmptyRecord(document.designGovernance.generationPlan) ? "accepted" : "missing",
      activeTargets: new Map<string, CanvasTargetState>(),
      overlayMounts: new Map(),
      designTabTargetId: null,
      feedback: [],
      nextFeedbackSeq: 1,
      editorSelection: {
        pageId: document.pages[0]?.id ?? null,
        nodeId: null,
        targetId: null,
        updatedAt: null
      },
      feedbackSubscriptions: new Map()
    };
    this.sessions.set(sessionId, session);
    this.sessionSyncManager.initializeSession(sessionId, leaseId, optionalString(params.clientId));
    await this.registerDocumentCodeSyncBindings(session);
    return this.buildHandshake(session);
  }

  private attachSession(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    const attachMode = requireAttachMode(params.attachMode);
    const nextLeaseId = attachMode === "lease_reclaim" ? `lease_${randomUUID()}` : session.leaseId;
    const attached = this.sessionSyncManager.attach(
      session.canvasSessionId,
      nextLeaseId,
      optionalString(params.clientId),
      attachMode
    );
    session.leaseId = attached.leaseId;
    return {
      clientId: attached.clientId,
      attachMode: attached.attachMode,
      leaseId: attached.leaseId,
      role: attached.role,
      documentRevision: session.store.getRevision(),
      document: session.store.getDocument(),
      summary: this.buildSessionSummary(session)
    };
  }

  private getSessionStatus(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    this.sessionSyncManager.touch(session.canvasSessionId, optionalString(params.clientId));
    return this.buildSessionSummary(session);
  }

  private async closeSession(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const releasedTargets = [...session.activeTargets.keys()];
    for (const mount of session.overlayMounts.values()) {
      await this.unmountOverlay({ canvasSessionId: session.canvasSessionId, leaseId: session.leaseId, mountId: mount.mountId, targetId: mount.targetId });
    }
    if (session.designTabTargetId) {
      await this.closeTab({
        canvasSessionId: session.canvasSessionId,
        leaseId: session.leaseId,
        targetId: session.designTabTargetId
      });
    }
    this.completeFeedbackSubscriptions(session, "session_closed");
    this.sessionSyncManager.removeSession(session.canvasSessionId);
    this.codeSyncManager.disposeSession(session.canvasSessionId);
    this.sessions.delete(session.canvasSessionId);
    return { ok: true, releasedTargets, releasedOverlays: true };
  }

  private getCapabilities(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    return this.buildHandshake(session);
  }

  private setPlan(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const plan = requireRecord(params.generationPlan, "generationPlan");
    session.planStatus = "submitted";
    session.preflightState = "plan_submitted";
    const validation = validateGenerationPlan(plan);
    if (!validation.ok) {
      throw new Error(`Generation plan missing fields: ${validation.missing.join(", ")}`);
    }
    const result = session.store.setGenerationPlan(plan);
    session.planStatus = result.planStatus;
    session.preflightState = "plan_accepted";
    this.emitWarnings(session, result.warnings, { category: "validation" });
    void this.syncLiveViews(session).catch(() => {});
    return {
      planStatus: result.planStatus,
      documentRevision: result.documentRevision,
      preflightState: session.preflightState,
      warnings: result.warnings
    };
  }

  private getPlan(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    return {
      generationPlan: session.store.getDocument().designGovernance.generationPlan,
      planStatus: session.planStatus,
      documentRevision: session.store.getRevision(),
      preflightState: session.preflightState
    };
  }

  private async loadDocument(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const documentId = optionalString(params.documentId);
    const repoPath = optionalString(params.repoPath);
    if (Boolean(documentId) === Boolean(repoPath)) {
      throw new Error("Provide exactly one of documentId or repoPath.");
    }
    const sessionRepoPath = !repoPath && documentId === session.store.getDocumentId()
      ? session.documentRepoPath
      : null;
    const resolvedRepoPath = repoPath ?? sessionRepoPath;
    const document = resolvedRepoPath
      ? normalizeCanvasDocument(await loadCanvasDocument(this.worktree, resolvedRepoPath))
      : normalizeCanvasDocument(await loadCanvasDocumentById(this.worktree, documentId as string) ?? createDefaultCanvasDocument(documentId as string));
    session.store.loadDocument(document);
    session.documentRepoPath = resolvedRepoPath;
    session.planStatus = isNonEmptyRecord(document.designGovernance.generationPlan) ? "accepted" : "missing";
    session.preflightState = session.planStatus === "accepted" ? "plan_accepted" : "handshake_read";
    session.editorSelection = {
      pageId: document.pages[0]?.id ?? null,
      nodeId: null,
      targetId: null,
      updatedAt: new Date().toISOString()
    };
    await this.registerDocumentCodeSyncBindings(session);
    await this.syncLiveViews(session);
    return {
      documentId: session.store.getDocumentId(),
      documentRevision: session.store.getRevision(),
      document: session.store.getDocument(),
      handshake: this.buildHandshake(session)
    };
  }

  private async patchDocument(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    if (session.planStatus !== "accepted") {
      throw this.planRequired("canvas.document.patch", session);
    }
    const baseRevision = requireNumber(params.baseRevision, "baseRevision");
    const patches = requirePatches(params.patches);
    try {
      return await this.applyDocumentPatches(session, baseRevision, patches, "agent");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Revision conflict")) {
        throw this.revisionConflict("canvas.document.patch", session);
      }
      throw error;
    }
  }

  private async applyDocumentPatches(
    session: CanvasSession,
    baseRevision: number,
    patches: CanvasPatch[],
    source: "agent" | "editor"
  ): Promise<{
    transactionId: string;
    appliedRevision: number;
    warnings: CanvasValidationWarning[];
    evidenceRefs: string[];
  }> {
    const result = session.store.applyPatches(baseRevision, patches);
    session.preflightState = "patching_enabled";
    this.pushFeedback(session, {
      category: "validation",
      class: source === "editor" ? "editor-document-patched" : "document-patched",
      severity: "info",
      message: `Applied ${patches.length} canvas patch${patches.length === 1 ? "" : "es"} from ${source}.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: { source }
    });
    this.emitWarnings(session, result.warnings, { category: "validation" });
    await this.registerDocumentCodeSyncBindings(session);
    await this.syncLiveViews(session, { refreshPreviewTargets: true, source });
    return result;
  }

  private async bindCodeSync(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const nodeId = requireString(params.nodeId, "nodeId");
    const bindingId = optionalString(params.bindingId) ?? `binding_sync_${randomUUID().slice(0, 8)}`;
    const binding = createCodeSyncBinding(params, nodeId, bindingId);
    const baseRevision = session.store.getRevision();
    await this.applyDocumentPatches(session, baseRevision, [{
      op: "binding.set",
      nodeId,
      binding
    }], "agent");
    const nextBinding = requireCanvasBinding(session.store.getDocument(), binding.id);
    const bindingStatus = await this.codeSyncManager.bind({
      canvasSessionId: session.canvasSessionId,
      document: session.store.getDocument(),
      documentRevision: session.store.getRevision(),
      binding: nextBinding
    });
    this.pushFeedback(session, {
      category: "code-sync",
      class: "code-sync-bound",
      severity: "info",
      message: `Bound ${binding.codeSync?.repoPath ?? binding.selector ?? binding.id} for code sync.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: {
        bindingId: binding.id,
        nodeId
      }
    });
    return {
      ok: true,
      binding: nextBinding,
      bindingStatus,
      documentRevision: session.store.getRevision(),
      summary: this.buildSessionSummary(session)
    };
  }

  private async unbindCodeSync(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const bindingId = requireString(params.bindingId, "bindingId");
    requireCanvasBinding(session.store.getDocument(), bindingId);
    await this.applyDocumentPatches(session, session.store.getRevision(), [{
      op: "binding.remove",
      bindingId
    }], "agent");
    this.codeSyncManager.unbind(session.canvasSessionId, bindingId);
    this.pushFeedback(session, {
      category: "code-sync",
      class: "code-sync-unbound",
      severity: "info",
      message: `Removed code-sync binding ${bindingId}.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: { bindingId }
    });
    return {
      ok: true,
      bindingId,
      documentRevision: session.store.getRevision(),
      summary: this.buildSessionSummary(session)
    };
  }

  private async pullCodeSync(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const binding = requireCodeSyncBinding(session.store.getDocument(), requireString(params.bindingId, "bindingId"));
    this.pushFeedback(session, {
      category: "code-sync",
      class: "code-sync-started",
      severity: "info",
      message: `Pulling source into canvas for ${binding.id}.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: { bindingId: binding.id, direction: "pull" }
    });
    const result = await this.codeSyncManager.pull({
      canvasSessionId: session.canvasSessionId,
      document: session.store.getDocument(),
      documentRevision: session.store.getRevision(),
      binding,
      resolutionPolicy: requireResolutionPolicy(optionalString(params.resolutionPolicy)),
      applyPatches: async (patches) => {
        const applied = await this.applyDocumentPatches(session, session.store.getRevision(), patches, "agent");
        return { documentRevision: applied.appliedRevision };
      }
    });
    if (!result.ok) {
      this.pushFeedback(session, {
        category: "code-sync",
        class: "code-sync-conflict",
        severity: "warning",
        message: result.conflicts[0]?.message ?? "Code-sync pull failed.",
        pageId: session.editorSelection.pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: [],
        details: { bindingId: binding.id, conflicts: result.conflicts }
      });
      return { ...result, summary: this.buildSessionSummary(session) };
    }
    await this.syncLiveViews(session, { refreshPreviewTargets: true, source: "agent" });
    this.pushFeedback(session, {
      category: "code-sync",
      class: "code-sync-applied",
      severity: "info",
      message: `Pulled ${result.patchesApplied} code-sync patch${result.patchesApplied === 1 ? "" : "es"} into the canvas document.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: {
        bindingId: binding.id,
        repoPath: result.repoPath,
        changedNodeIds: result.changedNodeIds,
        unsupportedRegions: result.unsupportedRegions
      }
    });
    return { ...result, summary: this.buildSessionSummary(session) };
  }

  private async pushCodeSync(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const binding = requireCodeSyncBinding(session.store.getDocument(), requireString(params.bindingId, "bindingId"));
    this.pushFeedback(session, {
      category: "code-sync",
      class: "code-sync-started",
      severity: "info",
      message: `Pushing canvas changes into source for ${binding.id}.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: { bindingId: binding.id, direction: "push" }
    });
    const result = await this.codeSyncManager.push({
      canvasSessionId: session.canvasSessionId,
      document: session.store.getDocument(),
      documentRevision: session.store.getRevision(),
      binding,
      resolutionPolicy: requireResolutionPolicy(optionalString(params.resolutionPolicy))
    });
    if (!result.ok) {
      this.pushFeedback(session, {
        category: "code-sync",
        class: "code-sync-conflict",
        severity: "warning",
        message: result.conflicts[0]?.message ?? "Code-sync push failed.",
        pageId: session.editorSelection.pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: [],
        details: { bindingId: binding.id, conflicts: result.conflicts }
      });
      return { ...result, summary: this.buildSessionSummary(session) };
    }
    await this.syncLiveViews(session, { refreshPreviewTargets: true, source: "agent" });
    this.pushFeedback(session, {
      category: "code-sync",
      class: "code-sync-applied",
      severity: "info",
      message: `Pushed canvas changes into ${result.repoPath}.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [result.repoPath],
      details: {
        bindingId: binding.id,
        changedNodeIds: result.changedNodeIds
      }
    });
    return { ...result, summary: this.buildSessionSummary(session) };
  }

  private async codeSyncStatus(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    const bindingId = optionalString(params.bindingId);
    if (bindingId) {
      const binding = requireCodeSyncBinding(session.store.getDocument(), bindingId);
      let bindingStatus = await this.codeSyncManager.getBindingStatus(
        session.canvasSessionId,
        session.store.getDocument().documentId,
        binding,
        session.store.getRevision()
      );
      if (binding.codeSync?.syncMode === "watch" && bindingStatus.state === "drift_detected" && bindingStatus.driftState === "source_changed") {
        await this.handleWatchedSourceChange(session.canvasSessionId, binding.id);
        bindingStatus = await this.codeSyncManager.getBindingStatus(
          session.canvasSessionId,
          session.store.getDocument().documentId,
          binding,
          session.store.getRevision()
        );
      }
      return {
        bindingStatus,
        summary: this.buildSessionSummary(session)
      };
    }
    await this.registerDocumentCodeSyncBindings(session);
    for (const binding of session.store.getDocument().bindings) {
      if (binding.codeSync?.syncMode !== "watch") {
        continue;
      }
      const bindingStatus = await this.codeSyncManager.getBindingStatus(
        session.canvasSessionId,
        session.store.getDocument().documentId,
        binding,
        session.store.getRevision()
      );
      if (bindingStatus.state === "drift_detected" && bindingStatus.driftState === "source_changed") {
        await this.handleWatchedSourceChange(session.canvasSessionId, binding.id);
      }
    }
    return this.buildSessionSummary(session);
  }

  private async resolveCodeSync(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const binding = requireCodeSyncBinding(session.store.getDocument(), requireString(params.bindingId, "bindingId"));
    const resolutionPolicy = requireResolutionPolicy(requireString(params.resolutionPolicy, "resolutionPolicy")) ?? "manual";
    const result = await this.codeSyncManager.resolve({
      canvasSessionId: session.canvasSessionId,
      document: session.store.getDocument(),
      documentRevision: session.store.getRevision(),
      binding,
      resolutionPolicy,
      applyPatches: async (patches) => {
        const applied = await this.applyDocumentPatches(session, session.store.getRevision(), patches, "agent");
        return { documentRevision: applied.appliedRevision };
      }
    });
    if (result.ok) {
      await this.syncLiveViews(session, { refreshPreviewTargets: true, source: "agent" });
    }
    return { ...result, summary: this.buildSessionSummary(session) };
  }

  private async registerDocumentCodeSyncBindings(session: CanvasSession): Promise<void> {
    const attachedClients = this.sessionSyncManager.listAttachedClients(session.canvasSessionId);
    const leaseHolderClientId = this.sessionSyncManager.getLeaseHolderClientId(session.canvasSessionId);
    const knownBindings = new Set(
      this.codeSyncManager.getSessionStatus(session.canvasSessionId, attachedClients.length, leaseHolderClientId).bindings
        .map((entry) => entry.bindingId)
    );
    const nextBindings = session.store.getDocument().bindings.filter((binding) => Boolean(binding.codeSync));
    for (const binding of nextBindings) {
      knownBindings.delete(binding.id);
      await this.codeSyncManager.bind({
        canvasSessionId: session.canvasSessionId,
        document: session.store.getDocument(),
        documentRevision: session.store.getRevision(),
        binding
      });
    }
    for (const staleBindingId of knownBindings) {
      this.codeSyncManager.unbind(session.canvasSessionId, staleBindingId);
    }
  }

  private async handleWatchedSourceChange(canvasSessionId: string, bindingId: string): Promise<void> {
    const session = this.sessions.get(canvasSessionId);
    if (!session) {
      return;
    }
    const binding = requireCodeSyncBinding(session.store.getDocument(), bindingId);
    const result = await this.codeSyncManager.pull({
      canvasSessionId: session.canvasSessionId,
      document: session.store.getDocument(),
      documentRevision: session.store.getRevision(),
      binding,
      resolutionPolicy: "prefer_code",
      applyPatches: async (patches) => {
        const applied = await this.applyDocumentPatches(session, session.store.getRevision(), patches, "agent");
        return { documentRevision: applied.appliedRevision };
      }
    });
    if (!result.ok) {
      this.pushFeedback(session, {
        category: "code-sync",
        class: "code-sync-watch-conflict",
        severity: "warning",
        message: result.conflicts[0]?.message ?? "Watched source change could not be imported.",
        pageId: session.editorSelection.pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: [],
        details: { bindingId, conflicts: result.conflicts }
      });
      return;
    }
    await this.syncLiveViews(session, { refreshPreviewTargets: true, source: "agent" });
  }

  private async saveDocument(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const document = session.store.getDocument();
    const validation = validateCanvasSave(document);
    if (validation.missingBlocks.length > 0) {
      throw this.policyViolation("canvas.document.save", session, validation.missingBlocks, validation.warnings);
    }
    const repoPath = await saveCanvasDocument(this.worktree, document, optionalString(params.repoPath));
    session.documentRepoPath = repoPath;
    this.emitWarnings(session, validation.warnings, { category: "validation" });
    return {
      repoPath,
      documentRevision: session.store.getRevision(),
      schemaVersion: document.schemaVersion,
      migrationWarnings: [],
      warnings: validation.warnings
    };
  }

  private async exportDocument(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const exportTarget = requireString(params.exportTarget, "exportTarget");
    const document = session.store.getDocument();
    const warnings = evaluateCanvasWarnings(document, { forSave: exportTarget === "design_document" });
    const exportBase = resolveCanvasRepoPath(this.worktree, document.documentId, ".opendevbrowser/canvas/exports");
    await mkdir(dirname(exportBase), { recursive: true });
    if (exportTarget === "design_document") {
      const validation = validateCanvasSave(document);
      if (validation.missingBlocks.length > 0) {
        throw this.policyViolation("canvas.document.export", session, validation.missingBlocks, validation.warnings);
      }
      const repoPath = await saveCanvasDocument(this.worktree, document, optionalString(params.repoPath));
      this.emitWarnings(session, validation.warnings, { category: "validation" });
      return {
        exportTarget,
        documentRevision: session.store.getRevision(),
        artifactRefs: [repoPath],
        resolvedSavePath: repoPath,
        schemaVersion: document.schemaVersion,
        migrationWarnings: [],
        warnings: validation.warnings
      };
    }
    if (exportTarget === "react_component") {
      const repoPath = `${exportBase}-${session.canvasSessionId}.tsx`;
      await saveText(repoPath, renderCanvasDocumentComponent(document));
      this.emitWarnings(session, warnings, { category: "export" });
      return {
        exportTarget,
        documentRevision: session.store.getRevision(),
        artifactRefs: [repoPath],
        exportMetadata: { format: "tsx", documentId: document.documentId },
        warnings
      };
    }
    if (exportTarget === "html_bundle") {
      const repoPath = `${exportBase}-${session.canvasSessionId}.html`;
      await saveText(repoPath, renderCanvasDocumentHtml(document));
      this.emitWarnings(session, warnings, { category: "export" });
      return {
        exportTarget,
        documentRevision: session.store.getRevision(),
        artifactRefs: [repoPath],
        exportMetadata: { format: "html", documentId: document.documentId },
        warnings
      };
    }
    throw new Error(`Unsupported exportTarget: ${exportTarget}`);
  }

  private async openTab(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const prototypeId = requireString(params.prototypeId, "prototypeId");
    const previewMode = requireTabPreviewMode(params.previewMode, "previewMode");
    const html = renderCanvasDocumentHtml(session.store.getDocument());
    if (session.browserSessionId) {
      const status = await this.browserManager.status(session.browserSessionId);
      if (status.mode === "extension") {
        const result = await this.requestCanvasExtension(session, "canvas.tab.open", {
          prototypeId,
          previewMode,
          html,
          document: session.store.getDocument(),
          documentRevision: session.store.getRevision(),
          summary: this.buildSessionSummary(session),
          targets: [...session.activeTargets.values()],
          overlayMounts: [...session.overlayMounts.values()],
          feedback: this.buildFeedbackSnapshot(session),
          feedbackCursor: this.getLatestFeedbackCursor(session),
          selection: session.editorSelection
        });
        session.designTabTargetId = typeof result.targetId === "string" ? result.targetId : null;
        if (session.designTabTargetId && typeof this.browserManager.registerCanvasTarget === "function") {
          await this.browserManager.registerCanvasTarget(session.browserSessionId, session.designTabTargetId);
        }
        return {
          targetId: session.designTabTargetId,
          targetIds: session.designTabTargetId ? [session.designTabTargetId] : [],
          previewState: result.previewState ?? previewMode,
          designTab: true
        };
      }
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      const page = await this.browserManager.page(session.browserSessionId, `canvas-${prototypeId}`, url);
      session.designTabTargetId = page.targetId;
      return {
        targetId: page.targetId,
        targetIds: [page.targetId],
        previewState: previewMode,
        designTab: true
      };
    }
    throw new Error("canvas.tab.open requires a browserSessionId.");
  }

  private async closeTab(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const targetId = requireString(params.targetId, "targetId");
    if (!session.browserSessionId) {
      throw new Error("canvas.tab.close requires a browserSessionId.");
    }
    const status = await this.browserManager.status(session.browserSessionId);
    if (status.mode === "extension" && session.designTabTargetId === targetId) {
      await this.requestCanvasExtension(session, "canvas.tab.close", { targetId });
    } else {
      await this.browserManager.closeTarget(session.browserSessionId, targetId);
    }
    if (session.designTabTargetId === targetId) {
      session.designTabTargetId = null;
    }
    session.activeTargets.delete(targetId);
    return {
      ok: true,
      targetId,
      targetIds: [...session.activeTargets.keys()],
      releasedTargetIds: [targetId],
      previewState: "background"
    };
  }

  private async mountOverlay(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const targetId = requireString(params.targetId, "targetId");
    const prototypeId = requireString(params.prototypeId, "prototypeId");
    if (!session.browserSessionId) {
      throw new Error("canvas.overlay.mount requires a browserSessionId.");
    }
    const status = await this.browserManager.status(session.browserSessionId);
    let result: ExtensionOverlayResult;
    if (status.mode === "extension") {
      result = await this.requestCanvasExtension(session, "canvas.overlay.mount", {
        targetId,
        prototypeId,
        document: session.store.getDocument(),
        documentRevision: session.store.getRevision()
      });
    } else {
      result = await this.mountDirectOverlay(session.browserSessionId, targetId, session.store.getDocument(), prototypeId);
    }
    const mountId = typeof result.mountId === "string" ? result.mountId : `mount_${randomUUID()}`;
    session.overlayMounts.set(mountId, { mountId, targetId, mountedAt: new Date().toISOString() });
    const previewState = session.activeTargets.get(targetId)?.previewState ?? "background";
    await this.syncLiveViews(session);
    return {
      mountId,
      targetId,
      previewState,
      overlayState: result.overlayState ?? "mounted",
      capabilities: result.capabilities ?? { selection: true, guides: true }
    };
  }

  private async unmountOverlay(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const mountId = requireString(params.mountId, "mountId");
    const targetId = optionalString(params.targetId);
    const mount = session.overlayMounts.get(mountId);
    if (!mount || !session.browserSessionId) {
      return { ok: true, mountId, previewState: (targetId ? session.activeTargets.get(targetId)?.previewState : null) ?? "background", overlayState: "idle" };
    }
    const status = await this.browserManager.status(session.browserSessionId);
    if (status.mode === "extension") {
      await this.requestCanvasExtension(session, "canvas.overlay.unmount", { mountId, targetId: mount.targetId });
    } else {
      await this.unmountDirectOverlay(session.browserSessionId, mount.targetId);
    }
    session.overlayMounts.delete(mountId);
    await this.syncLiveViews(session);
    return { ok: true, mountId, previewState: session.activeTargets.get(mount.targetId)?.previewState ?? "background", overlayState: "idle" };
  }

  private async selectOverlay(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const mountId = requireString(params.mountId, "mountId");
    const targetId = requireString(params.targetId, "targetId");
    const nodeId = optionalString(params.nodeId);
    const hint = isRecord(params.selectionHint) ? params.selectionHint : {};
    if (!nodeId && !isNonEmptyRecord(hint)) {
      throw new Error("canvas.overlay.select requires nodeId or selectionHint.");
    }
    if (!session.browserSessionId) {
      throw new Error("canvas.overlay.select requires a browserSessionId.");
    }
    const status = await this.browserManager.status(session.browserSessionId);
    const selection = status.mode === "extension"
      ? await this.requestCanvasExtension(session, "canvas.overlay.select", { mountId, targetId, nodeId, selectionHint: hint })
      : { selection: await this.selectDirectOverlay(session.browserSessionId, targetId, nodeId, hint) };
    if (nodeId) {
      session.editorSelection = {
        pageId: session.editorSelection.pageId ?? session.store.getDocument().pages[0]?.id ?? null,
        nodeId,
        targetId,
        updatedAt: new Date().toISOString()
      };
      await this.syncLiveViews(session);
    }
    return {
      targetId,
      selection: selection.selection ?? selection,
      mountId
    };
  }

  private async renderPreview(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const prototypeId = requireString(params.prototypeId, "prototypeId");
    const targetId = requireString(params.targetId, "targetId");
    if (!session.browserSessionId) {
      throw new Error("canvas.preview.render requires a browserSessionId.");
    }
    if (session.planStatus !== "accepted") {
      throw this.planRequired("canvas.preview.render", session);
    }
    return await this.renderPreviewTarget(session, targetId, prototypeId, { cause: "manual", syncAfter: true });
  }

  private async refreshPreview(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const targetId = requireString(params.targetId, "targetId");
    const refreshMode = requireRefreshMode(params.refreshMode, "refreshMode");
    const existing = session.activeTargets.get(targetId);
    if (!existing) {
      throw this.unsupportedTarget("canvas.preview.refresh", session, targetId);
    }
    if (refreshMode === "full") {
      if (typeof existing.prototypeId !== "string" || existing.prototypeId.length === 0) {
        throw this.unsupportedTarget("canvas.preview.refresh", session, targetId);
      }
      return await this.renderPreviewTarget(session, targetId, existing.prototypeId, { cause: "manual", syncAfter: true });
    }
    const screenshot = await this.browserManager.screenshot(
      requireString(session.browserSessionId, "browserSessionId"),
      undefined,
      targetId
    );
    this.pushFeedback(session, {
      category: "render",
      class: "thumbnail-refresh",
      severity: "info",
      message: "Thumbnail refresh completed.",
      pageId: null,
      prototypeId: existing.prototypeId,
      targetId,
      evidenceRefs: screenshot.path ? [screenshot.path] : []
    });
    await this.syncLiveViews(session);
    return {
      targetId,
      previewState: existing.previewState,
      renderStatus: existing.renderStatus,
      documentRevision: session.store.getRevision(),
      degradeReason: existing.degradeReason
    };
  }

  private async renderPreviewTarget(
    session: CanvasSession,
    targetId: string,
    prototypeId: string,
    context: PreviewRenderContext
  ): Promise<{
    renderStatus: CanvasTargetState["renderStatus"];
    targetId: string;
    prototypeId: string;
    previewState: CanvasPreviewState;
    previewMode: CanvasPreviewState;
    documentRevision: number;
    degradeReason: CanvasDegradeReason | null;
    warnings: CanvasValidationWarning[];
  }> {
    const browserSessionId = requireString(session.browserSessionId, "browserSessionId");
    const document = session.store.getDocument();
    const prototype = this.requirePrototype(document, prototypeId);
    const status = await this.browserManager.status(browserSessionId);
    const existingTarget = session.activeTargets.get(targetId);
    const previewTarget = this.allocatePreviewTarget(session, targetId, status.activeTargetId);
    const telemetryMode = previewTarget.previewState === "degraded"
      ? "paused"
      : previewTarget.previewState === "background"
        ? "sampled"
        : "full";
    const sourceUrl = resolvePreviewUrl(selectPreviewSourceCandidate(status.url, existingTarget?.sourceUrl), prototype.route);
    const runtimeBinding = findPrototypeRuntimeBinding(document, prototype);
    const html = this.buildPreviewHtml(document, prototype, targetId, sourceUrl);
    let projection: CanvasTargetState["projection"] = "canvas_html";
    let fallbackReason: string | null = null;
    let parityArtifact = runtimeBinding ? buildCanvasParityArtifact(document, runtimeBinding.id, "canvas_html") : null;
    if (
      runtimeBinding?.codeSync?.projection === "bound_app_runtime"
      && sourceUrl
      && runtimeBinding.codeSync.runtimeRootSelector
    ) {
      try {
        await this.browserManager.goto(browserSessionId, sourceUrl, "load", 30000, undefined, targetId);
        const bindingHtml = renderCanvasBindingHtml(document, runtimeBinding.id);
        if (!bindingHtml) {
          fallbackReason = "runtime_projection_unsupported";
        } else {
          const bridgeResult = typeof this.browserManager.applyRuntimePreviewBridge === "function"
            ? await this.browserManager.applyRuntimePreviewBridge(browserSessionId, targetId, {
              bindingId: runtimeBinding.id,
              rootSelector: runtimeBinding.codeSync?.runtimeRootSelector ?? `[data-binding-id="${runtimeBinding.id}"]`,
              html: bindingHtml
            })
            : await this.browserManager.withPage(browserSessionId, targetId, async (page) => {
              return await applyRuntimePreviewBridge(page as { evaluate: typeof page.evaluate }, {
                bindingId: runtimeBinding.id,
                rootSelector: runtimeBinding.codeSync?.runtimeRootSelector ?? `[data-binding-id="${runtimeBinding.id}"]`,
                html: bindingHtml
              });
            });
          if (bridgeResult.ok) {
            projection = "bound_app_runtime";
            fallbackReason = null;
            parityArtifact = bridgeResult.artifact;
          } else {
            fallbackReason = bridgeResult.fallbackReason;
          }
        }
      } catch (error) {
        fallbackReason = "runtime_projection_failed";
        this.pushFeedback(session, {
          category: "parity",
          class: "runtime-preview-bridge-failed",
          severity: "warning",
          message: error instanceof Error ? error.message : String(error),
          pageId: prototype.pageId,
          prototypeId,
          targetId,
          evidenceRefs: [],
          details: {
            bindingId: runtimeBinding.id,
            projection: "bound_app_runtime"
          }
        });
      }
    } else if (runtimeBinding?.codeSync?.projection === "bound_app_runtime") {
      fallbackReason = sourceUrl ? "runtime_bridge_unavailable" : "runtime_projection_unsupported";
    }
    if (projection === "canvas_html") {
      const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      await this.browserManager.goto(browserSessionId, previewUrl, "load", 30000, undefined, targetId);
    }
    const screenshot = await this.browserManager.screenshot(browserSessionId, undefined, targetId);
    const consoleData = telemetryMode === "paused"
      ? { events: [], nextSeq: 0 }
      : await this.browserManager.consolePoll(browserSessionId, 0, telemetryMode === "sampled" ? 5 : 25);
    const networkData = telemetryMode === "paused"
      ? { events: [], nextSeq: 0 }
      : await this.browserManager.networkPoll(browserSessionId, 0, telemetryMode === "sampled" ? 5 : 25);
    const perfData = telemetryMode === "paused"
      ? { metrics: [] }
      : await this.collectPerfMetrics(browserSessionId, targetId);
    const previewState: CanvasTargetState = {
      targetId,
      prototypeId,
      previewMode: previewTarget.previewMode,
      previewState: previewTarget.previewState,
      renderStatus: previewTarget.previewState === "degraded" ? "degraded" : "rendered",
      degradeReason: previewTarget.degradeReason,
      lastRenderedAt: new Date().toISOString(),
      sourceUrl: isPreviewSourceCandidate(sourceUrl) ? sourceUrl : existingTarget?.sourceUrl ?? null,
      projection,
      fallbackReason,
      parityArtifact
    };
    session.activeTargets.set(targetId, previewState);
    if (consoleData.events.length > 0) {
      this.pushFeedback(session, {
        category: "console",
        class: "console-signal",
        severity: "warning",
        message: `Preview emitted ${consoleData.events.length} console event${consoleData.events.length === 1 ? "" : "s"}.`,
        pageId: prototype.pageId,
        prototypeId,
        targetId,
        evidenceRefs: [],
        details: {
          cause: context.cause,
          source: context.source ?? null,
          previewState: previewState.previewState
        }
      });
    }
    if (networkData.events.some((event) => typeof event.status === "number" && event.status >= 400)) {
      this.pushFeedback(session, {
        category: "network",
        class: "network-failure",
        severity: "warning",
        message: "Preview reported network failures.",
        pageId: prototype.pageId,
        prototypeId,
        targetId,
        evidenceRefs: [],
        details: {
          cause: context.cause,
          source: context.source ?? null,
          previewState: previewState.previewState
        }
      });
    }
    if (perfData.metrics.length > 0) {
      this.pushFeedback(session, {
        category: "performance",
        class: "perf-summary",
        severity: "info",
        message: `Captured ${perfData.metrics.length} performance metrics for ${previewState.previewState} preview.`,
        pageId: prototype.pageId,
        prototypeId,
        targetId,
        evidenceRefs: [],
        details: {
          cause: context.cause,
          source: context.source ?? null,
          previewState: previewState.previewState,
          metrics: perfData.metrics
        }
      });
    }
    const warnings = evaluateCanvasWarnings(document, { degradeReason: previewState.degradeReason ?? null });
    this.emitWarnings(session, warnings, {
      pageId: prototype.pageId,
      prototypeId,
      targetId
    });
    this.pushFeedback(session, {
      category: "render",
      class: previewState.renderStatus === "degraded" ? "render-degraded" : "render-complete",
      severity: previewState.renderStatus === "degraded" ? "warning" : "info",
      message: previewState.renderStatus === "degraded"
        ? context.cause === "patch_sync"
          ? "Live preview refresh completed in degraded thumbnail-only mode."
          : "Preview render completed in degraded thumbnail-only mode."
        : context.cause === "patch_sync"
          ? "Live preview refresh completed."
          : "Preview render completed.",
      pageId: prototype.pageId,
      prototypeId,
      targetId,
      evidenceRefs: screenshot.path ? [screenshot.path] : [],
        details: {
          cause: context.cause,
          source: context.source ?? null,
          previewState: previewState.previewState,
          degradeReason: previewState.degradeReason ?? null,
          projection,
          fallbackReason,
          sourceUrl
        }
      });
    if (context.syncAfter) {
      await this.syncLiveViews(session);
    }
    return {
      renderStatus: previewState.renderStatus,
      targetId,
      prototypeId,
      previewState: previewState.previewState,
      previewMode: previewState.previewMode,
      documentRevision: session.store.getRevision(),
      degradeReason: previewState.degradeReason ?? null,
      warnings
    };
  }

  private pollFeedback(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    const afterCursor = optionalString(params.afterCursor);
    const items = this.filterFeedback(session, params);
    const startIndex = afterCursor ? items.findIndex((item) => item.cursor === afterCursor) + 1 : 0;
    const batch = items.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + FEEDBACK_BATCH_SIZE);
    const nextCursor = batch.length > 0 ? batch[batch.length - 1]!.cursor : afterCursor;
    const retentionByTarget: Record<string, number> = {};
    for (const item of session.feedback) {
      const targetKey = item.targetId ?? "session";
      retentionByTarget[targetKey] = (retentionByTarget[targetKey] ?? 0) + 1;
    }
    const targetIds = normalizeStringArray(params.targetIds);
    const singleTarget = optionalString(params.targetId);
    if (singleTarget) {
      targetIds.push(singleTarget);
    }
    const activeTargetIds = [...session.activeTargets.keys()];
    return {
      items: batch,
      nextCursor: nextCursor ?? null,
      retention: {
        total: session.feedback.length,
        filteredTotal: items.length,
        byTarget: targetIds.length > 0
          ? Object.fromEntries(Object.entries(retentionByTarget).filter(([key]) => key === "session" || targetIds.includes(key)))
          : retentionByTarget,
        activeTargetIds
      }
    };
  }

  private subscribeFeedback(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    const polled = this.pollFeedback(params) as { items: CanvasFeedbackItem[]; nextCursor: string | null };
    const subscriptionId = `canvas_sub_${randomUUID()}`;
    const subscription: CanvasFeedbackSubscription = {
      id: subscriptionId,
      categories: new Set(normalizeStringArray(params.categories)),
      targetIds: new Set([...normalizeStringArray(params.targetIds), ...normalizeOptionalString(optionalString(params.targetId))]),
      queue: [],
      waiters: [],
      cursor: polled.nextCursor,
      heartbeatTimer: setInterval(() => {
        if (!subscription.active) {
          return;
        }
        this.enqueueFeedbackEvent(subscription, {
          eventType: "feedback.heartbeat",
          cursor: subscription.cursor,
          ts: new Date().toISOString(),
          activeTargetIds: [...session.activeTargets.keys()]
        });
      }, 15000),
      active: true
    };
    subscription.heartbeatTimer.unref?.();
    session.feedbackSubscriptions.set(subscriptionId, subscription);
    const response: Record<string, unknown> = {
      subscriptionId,
      items: polled.items,
      cursor: polled.nextCursor,
      eventTypes: ["feedback.item", "feedback.heartbeat", "feedback.complete"],
      heartbeatMs: 15000,
      activeTargetIds: [...session.activeTargets.keys()],
      completeReason: null
    };
    Object.defineProperty(response, "stream", {
      enumerable: false,
      value: this.createFeedbackStream(subscription)
    });
    Object.defineProperty(response, "unsubscribe", {
      enumerable: false,
      value: () => {
        this.completeFeedbackSubscription(session, subscriptionId, "subscription_replaced");
      }
    });
    return response;
  }

  private createFeedbackStream(subscription: CanvasFeedbackSubscription): AsyncIterable<CanvasFeedbackStreamEvent> {
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        while (subscription.active || subscription.queue.length > 0) {
          if (subscription.queue.length > 0) {
            const next = subscription.queue.shift();
            if (next) {
              yield next;
            }
            continue;
          }
          const awaited = await new Promise<CanvasFeedbackStreamEvent | null>((resolve) => {
            subscription.waiters.push(resolve);
          });
          if (awaited) {
            yield awaited;
          }
        }
        self.flushSubscriptionWaiters(subscription, null);
      }
    };
  }

  private enqueueFeedbackEvent(subscription: CanvasFeedbackSubscription, event: CanvasFeedbackStreamEvent): void {
    if (!subscription.active && event.eventType !== "feedback.complete") {
      return;
    }
    subscription.cursor = event.eventType === "feedback.item"
      ? event.item.cursor
      : event.cursor;
    const waiter = subscription.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    subscription.queue.push(event);
  }

  private flushSubscriptionWaiters(subscription: CanvasFeedbackSubscription, event: CanvasFeedbackStreamEvent | null): void {
    while (subscription.waiters.length > 0) {
      const waiter = subscription.waiters.shift();
      waiter?.(event);
    }
  }

  private completeFeedbackSubscription(
    session: CanvasSession,
    subscriptionId: string,
    reason: "session_closed" | "lease_revoked" | "subscription_replaced" | "document_unloaded"
  ): void {
    const subscription = session.feedbackSubscriptions.get(subscriptionId);
    if (!subscription || !subscription.active) {
      return;
    }
    subscription.active = false;
    clearInterval(subscription.heartbeatTimer);
    this.enqueueFeedbackEvent(subscription, {
      eventType: "feedback.complete",
      cursor: subscription.cursor,
      ts: new Date().toISOString(),
      reason
    });
    session.feedbackSubscriptions.delete(subscriptionId);
  }

  private completeFeedbackSubscriptions(
    session: CanvasSession,
    reason: "session_closed" | "lease_revoked" | "subscription_replaced" | "document_unloaded"
  ): void {
    for (const subscriptionId of [...session.feedbackSubscriptions.keys()]) {
      this.completeFeedbackSubscription(session, subscriptionId, reason);
    }
  }

  private buildHandshake(session: CanvasSession): Record<string, unknown> {
    const document = session.store.getDocument();
    const governanceBlockStates = buildGovernanceBlockStates(document);
    const runtimeBudgets = getRuntimeBudgets(document);
    const libraryPolicy = resolveCanvasLibraryPolicy(document);
    const attachedClients = this.sessionSyncManager.listAttachedClients(session.canvasSessionId);
    const leaseHolderClientId = this.sessionSyncManager.getLeaseHolderClientId(session.canvasSessionId);
    const codeSyncStatus = this.codeSyncManager.getSessionStatus(
      session.canvasSessionId,
      attachedClients.length,
      leaseHolderClientId
    );
    return {
      canvasSessionId: session.canvasSessionId,
      browserSessionId: session.browserSessionId,
      leaseId: session.leaseId,
      attachModes: ["observer", "lease_reclaim"],
      schemaVersion: CANVAS_SCHEMA_VERSION,
      policyVersion: "2026-03-09",
      documentId: session.store.getDocumentId(),
      preflightState: session.preflightState,
      governanceRequirements: {
        requiredBeforeMutation: [
          "intent",
          "generationPlan",
          "designLanguage",
          "contentModel",
          "layoutSystem",
          "typographySystem",
          "motionSystem",
          "responsiveSystem",
          "accessibilityPolicy"
        ],
        requiredBeforeSave: [
          "intent",
          "generationPlan",
          "designLanguage",
          "contentModel",
          "layoutSystem",
          "typographySystem",
          "colorSystem",
          "surfaceSystem",
          "iconSystem",
          "motionSystem",
          "responsiveSystem",
          "accessibilityPolicy",
          "libraryPolicy",
          "runtimeBudgets"
        ],
        optionalInherited: ["colorSystem", "surfaceSystem", "iconSystem", "libraryPolicy", "runtimeBudgets"]
      },
      generationPlanRequirements: {
        requiredBeforeMutation: [
          "targetOutcome",
          "visualDirection",
          "layoutStrategy",
          "contentStrategy",
          "componentStrategy",
          "motionPosture",
          "responsivePosture",
          "accessibilityPosture",
          "validationTargets"
        ]
      },
      supportedVariantDimensions: ["viewport", "theme", "interaction", "content"],
      allowedLibraries: libraryPolicy,
      governanceBlockStates,
      runtimeBudgets,
      warningClasses: [
        "missing-generation-plan",
        "missing-governance-block",
        "missing-intent",
        "missing-typography-system",
        "hierarchy-weak",
        "overflow",
        "token-missing",
        "contrast-failure",
        "broken-asset-reference",
        "font-policy-missing",
        "font-load-failure",
        "missing-state-coverage",
        "reduced-motion-violation",
        "unresolved-component-binding",
        "library-policy-violation",
        "responsive-mismatch",
        "runtime-budget-exceeded",
        "unsupported-target"
      ],
      mutationPolicy: {
        planRequiredBeforePatch: true,
        allowedBeforePlan: [
          "canvas.capabilities.get",
          "canvas.plan.get",
          "canvas.plan.set",
          "canvas.document.load",
          "canvas.session.attach",
          "canvas.session.status"
        ]
      },
      documentContext: buildDocumentContext(document),
      attachedClients,
      leaseHolderClientId,
      codeSyncStatus
    };
  }

  private buildSessionSummary(session: CanvasSession): CanvasSessionSummary {
    const document = session.store.getDocument();
    const attachedClients = this.sessionSyncManager.listAttachedClients(session.canvasSessionId);
    const leaseHolderClientId = this.sessionSyncManager.getLeaseHolderClientId(session.canvasSessionId);
    const codeSyncStatus = this.codeSyncManager.getSessionStatus(
      session.canvasSessionId,
      attachedClients.length,
      leaseHolderClientId
    );
    return {
      canvasSessionId: session.canvasSessionId,
      browserSessionId: session.browserSessionId,
      documentId: session.store.getDocumentId(),
      leaseId: session.leaseId,
      attachModes: ["observer", "lease_reclaim"],
      preflightState: session.preflightState,
      planStatus: session.planStatus,
      mode: session.mode,
      documentRevision: session.store.getRevision(),
      libraryPolicy: resolveCanvasLibraryPolicy(document),
      componentInventoryCount: document.componentInventory.length,
      componentSourceKinds: getComponentSourceKinds(document),
      iconRoles: readCanvasIconRoles(document),
      targets: [...session.activeTargets.values()],
      overlayMounts: [...session.overlayMounts.values()],
      designTabTargetId: session.designTabTargetId,
      attachedClients,
      leaseHolderClientId,
      watchState: codeSyncStatus.watchState,
      codeSyncState: codeSyncStatus.state,
      boundFiles: codeSyncStatus.boundFiles,
      conflictCount: codeSyncStatus.conflictCount,
      driftState: codeSyncStatus.driftState,
      lastImportAt: codeSyncStatus.lastImportAt,
      lastPushAt: codeSyncStatus.lastPushAt,
      bindings: codeSyncStatus.bindings
    };
  }

  private requireSession(params: CanvasCommandParams): CanvasSession {
    const canvasSessionId = requireString(params.canvasSessionId, "canvasSessionId");
    const session = this.sessions.get(canvasSessionId);
    if (!session) {
      throw new Error(`Unknown canvas session: ${canvasSessionId}`);
    }
    return session;
  }

  private assertLease(session: CanvasSession, params: CanvasCommandParams): void {
    const leaseId = requireString(params.leaseId, "leaseId");
    if (leaseId !== session.leaseId) {
      throw this.leaseReclaimRequired(session);
    }
  }

  private planRequired(command: string, session: CanvasSession): Error {
    const blocker: CanvasBlocker = {
      code: "plan_required",
      blockingCommand: command,
      requiredNextCommands: ["canvas.plan.set"],
      latestRevision: session.store.getRevision(),
      message: "generationPlan must be accepted before mutation."
    };
    return attachDetails(new Error(blocker.message), { code: blocker.code, blocker, details: { auditId: "CANVAS-01" } });
  }

  private revisionConflict(command: string, session: CanvasSession): Error {
    const blocker: CanvasBlocker = {
      code: "revision_conflict",
      blockingCommand: command,
      requiredNextCommands: ["canvas.document.load"],
      latestRevision: session.store.getRevision(),
      message: "The canvas document revision changed before this patch batch was applied."
    };
    return attachDetails(new Error(blocker.message), { code: blocker.code, blocker, details: { auditId: "CANVAS-07" } });
  }

  private policyViolation(
    command: string,
    session: CanvasSession,
    missingBlocks: string[],
    warnings: CanvasValidationWarning[]
  ): Error {
    const blocker: CanvasBlocker = {
      code: "policy_violation",
      blockingCommand: command,
      requiredNextCommands: ["canvas.plan.get", "canvas.document.load"],
      latestRevision: session.store.getRevision(),
      message: `Required save governance blocks are missing: ${missingBlocks.join(", ")}.`
    };
    return attachDetails(new Error(blocker.message), {
      code: blocker.code,
      blocker,
      details: {
        auditId: "CANVAS-02",
        missingBlocks,
        warnings
      }
    });
  }

  private unsupportedTarget(command: string, session: CanvasSession, targetId: string): Error {
    const blocker: CanvasBlocker = {
      code: "unsupported_target",
      blockingCommand: command,
      requiredNextCommands: ["canvas.session.status"],
      latestRevision: session.store.getRevision(),
      message: `Canvas target is unavailable: ${targetId}.`
    };
    return attachDetails(new Error(blocker.message), {
      code: blocker.code,
      blocker,
      details: {
        auditId: "CANVAS-05",
        targetId
      }
    });
  }

  private leaseReclaimRequired(session: CanvasSession): Error {
    const blocker: CanvasBlocker = {
      code: "lease_reclaim_required",
      blockingCommand: "canvas.session.status",
      requiredNextCommands: ["canvas.session.status"],
      latestRevision: session.store.getRevision(),
      message: "The canvas lease was reclaimed or replaced."
    };
    return attachDetails(new Error(blocker.message), {
      code: blocker.code,
      blocker,
      details: {
        auditId: "CANVAS-08",
        leaseId: session.leaseId
      }
    });
  }

  private emitWarnings(
    session: CanvasSession,
    warnings: CanvasValidationWarning[],
    context: {
      category?: CanvasFeedbackItem["category"];
      pageId?: string | null;
      prototypeId?: string | null;
      targetId?: string | null;
    } = {}
  ): void {
    for (const warning of warnings) {
      this.pushFeedback(session, {
        category: context.category ?? categoryForWarning(warning),
        class: warning.code,
        severity: warning.severity,
        message: warning.message,
        pageId: context.pageId ?? null,
        prototypeId: context.prototypeId ?? null,
        targetId: context.targetId ?? null,
        evidenceRefs: [],
        details: {
          ...(warning.details ?? {}),
          auditId: warning.auditId ?? null
        }
      });
    }
  }

  private filterFeedback(session: CanvasSession, params: CanvasCommandParams): CanvasFeedbackItem[] {
    const categoryFilter = new Set(normalizeStringArray(params.categories));
    const targetFilter = new Set(normalizeStringArray(params.targetIds));
    const singleTarget = optionalString(params.targetId);
    if (singleTarget) {
      targetFilter.add(singleTarget);
    }
    const filtered = session.feedback.filter((item) => {
      if (categoryFilter.size > 0 && !categoryFilter.has(item.category)) {
        return false;
      }
      if (targetFilter.size > 0 && item.targetId && !targetFilter.has(item.targetId)) {
        return false;
      }
      return targetFilter.size === 0 || item.targetId === null || targetFilter.has(item.targetId);
    });
    const blocker = session.planStatus === "accepted" ? null : this.buildPreflightFeedback(session);
    return blocker ? dedupeFeedback([blocker, ...filtered]) : filtered;
  }

  private buildPreflightFeedback(session: CanvasSession): CanvasFeedbackItem {
    const blocker = {
      code: "plan_required",
      blockingCommand: "canvas.feedback.poll",
      requiredNextCommands: ["canvas.plan.set"],
      latestRevision: session.store.getRevision(),
      message: "generationPlan must be accepted before the live design loop is ready."
    } satisfies CanvasBlocker;
    return {
      id: `fb_preflight_${session.store.getRevision()}`,
      cursor: `fb_preflight_${session.store.getRevision()}`,
      severity: "warning",
      category: "validation",
      class: "preflight-blocker",
      documentId: session.store.getDocumentId(),
      pageId: null,
      prototypeId: null,
      targetId: null,
      documentRevision: session.store.getRevision(),
      message: blocker.message,
      evidenceRefs: [],
      details: {
        blocker,
        auditId: "CANVAS-01"
      }
    };
  }

  private pushFeedback(
    session: CanvasSession,
    payload: Omit<CanvasFeedbackItem, "id" | "cursor" | "documentId" | "documentRevision" | "details"> & { details?: Record<string, unknown> }
  ): void {
    const id = `fb_${session.nextFeedbackSeq++}`;
    const item: CanvasFeedbackItem = {
      id,
      cursor: id,
      documentId: session.store.getDocumentId(),
      documentRevision: session.store.getRevision(),
      details: payload.details ?? {},
      ...payload
    };
    session.feedback.push(item);
    if (session.feedback.length > FEEDBACK_RETENTION_LIMIT) {
      session.feedback.shift();
    }
    for (const subscription of session.feedbackSubscriptions.values()) {
      if (!this.subscriptionMatchesItem(subscription, item)) {
        continue;
      }
      this.enqueueFeedbackEvent(subscription, {
        eventType: "feedback.item",
        item
      });
    }
  }

  private subscriptionMatchesItem(subscription: CanvasFeedbackSubscription, item: CanvasFeedbackItem): boolean {
    if (subscription.categories.size > 0 && !subscription.categories.has(item.category)) {
      return false;
    }
    if (subscription.targetIds.size === 0) {
      return true;
    }
    return item.targetId === null || subscription.targetIds.has(item.targetId);
  }

  private buildFeedbackSnapshot(session: CanvasSession): CanvasFeedbackStreamEvent[] {
    const items = this.filterFeedback(session, {}).slice(-Math.min(FEEDBACK_BATCH_SIZE, 20));
    const snapshot: CanvasFeedbackStreamEvent[] = items.map((item) => ({
      eventType: "feedback.item" as const,
      item
    }));
    snapshot.push({
      eventType: "feedback.heartbeat",
      cursor: items.at(-1)?.cursor ?? null,
      ts: new Date().toISOString(),
      activeTargetIds: [...session.activeTargets.keys()]
    });
    return snapshot;
  }

  private getLatestFeedbackCursor(session: CanvasSession): string | null {
    return session.feedback.at(-1)?.cursor ?? null;
  }

  private allocatePreviewTarget(
    session: CanvasSession,
    targetId: string,
    activeTargetId: string | null | undefined
  ): { previewMode: CanvasPreviewState; previewState: CanvasPreviewState; degradeReason?: CanvasDegradeReason } {
    const existing = session.activeTargets.get(targetId);
    if (existing) {
      return {
        previewMode: existing.previewMode,
        previewState: existing.previewState,
        degradeReason: existing.degradeReason
      };
    }
    const budgets = getRuntimeBudgets(session.store.getDocument());
    const nonDesignTargets = [...session.activeTargets.values()].filter((entry) => entry.targetId !== session.designTabTargetId);
    const limit = budgets.defaultLivePreviewLimit + budgets.maxPinnedFullPreviewExtra;
    const previewMode: CanvasPreviewState = targetId === activeTargetId ? "focused" : "background";
    if (nonDesignTargets.length >= limit) {
      return {
        previewMode: "degraded",
        previewState: "degraded",
        degradeReason: "overflow"
      };
    }
    return {
      previewMode,
      previewState: previewMode
    };
  }

  private async collectPerfMetrics(sessionId: string, targetId: string): Promise<{ metrics: Array<{ name: string; value: number }> }> {
    const perfMetrics = (this.browserManager as { perfMetrics?: (sessionId: string, targetId?: string | null) => Promise<{ metrics: Array<{ name: string; value: number }> }> }).perfMetrics;
    if (typeof perfMetrics !== "function") {
      return { metrics: [] };
    }
    try {
      return await perfMetrics.call(this.browserManager, sessionId, targetId);
    } catch {
      return { metrics: [] };
    }
  }

  private async syncLiveViews(
    session: CanvasSession,
    options: { refreshPreviewTargets?: boolean; source?: PreviewSyncSource } = {}
  ): Promise<void> {
    await this.syncDesignTab(session);
    if (options.refreshPreviewTargets) {
      await this.syncPreviewTargets(session, options.source ?? "agent");
    }
    await this.syncOverlays(session);
  }

  private async syncDesignTab(session: CanvasSession): Promise<void> {
    if (!session.designTabTargetId || !session.browserSessionId) {
      return;
    }
    const status = await this.browserManager.status(session.browserSessionId);
    if (status.mode !== "extension") {
      const html = renderCanvasDocumentHtml(session.store.getDocument());
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      await this.browserManager.goto(session.browserSessionId, url, "load", 30000, undefined, session.designTabTargetId).catch(() => {});
      return;
    }
    const html = renderCanvasDocumentHtml(session.store.getDocument());
    await this.requestCanvasExtension(session, "canvas.tab.sync", {
      targetId: session.designTabTargetId,
      html,
      document: session.store.getDocument(),
      documentRevision: session.store.getRevision(),
      summary: this.buildSessionSummary(session),
      targets: [...session.activeTargets.values()],
      overlayMounts: [...session.overlayMounts.values()],
      feedback: this.buildFeedbackSnapshot(session),
      feedbackCursor: this.getLatestFeedbackCursor(session),
      selection: session.editorSelection
    }).catch(() => {});
  }

  private async syncOverlays(session: CanvasSession): Promise<void> {
    if (!session.browserSessionId || session.overlayMounts.size === 0) {
      return;
    }
    const status = await this.browserManager.status(session.browserSessionId);
    for (const mount of session.overlayMounts.values()) {
      if (status.mode === "extension") {
        await this.requestCanvasExtension(session, "canvas.overlay.sync", {
          mountId: mount.mountId,
          targetId: mount.targetId,
          selection: session.editorSelection
        }).catch(() => {});
        continue;
      }
      await this.syncDirectOverlay(
        session.browserSessionId,
        mount.mountId,
        mount.targetId,
        session.store.getDocument().title,
        session.editorSelection
      ).catch(() => {});
    }
  }

  private async syncPreviewTargets(session: CanvasSession, source: PreviewSyncSource): Promise<void> {
    if (!session.browserSessionId || session.activeTargets.size === 0) {
      return;
    }
    for (const target of [...session.activeTargets.values()]) {
      if (target.targetId === session.designTabTargetId || typeof target.prototypeId !== "string" || target.prototypeId.length === 0) {
        continue;
      }
      try {
        await this.renderPreviewTarget(session, target.targetId, target.prototypeId, {
          cause: "patch_sync",
          source,
          syncAfter: false
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pushFeedback(session, {
          category: "render",
          class: "preview-sync-failed",
          severity: "warning",
          message,
          pageId: null,
          prototypeId: target.prototypeId,
          targetId: target.targetId,
          evidenceRefs: [],
          details: {
            cause: "patch_sync",
            source
          }
        });
      }
    }
  }

  private requirePrototype(document: CanvasDocument, prototypeId: string): CanvasPrototype {
    const prototype = document.prototypes.find((entry) => entry.id === prototypeId);
    if (!prototype) {
      throw new Error(`Unknown prototype: ${prototypeId}`);
    }
    return prototype;
  }

  private buildPreviewHtml(
    document: CanvasDocument,
    prototype: CanvasPrototype,
    targetId: string,
    sourceUrl: string | null
  ): string {
    const baseHref = toAbsoluteUrl(sourceUrl);
    return renderCanvasDocumentHtml(document, {
      pageIds: [prototype.pageId],
      baseHref,
      rootAttributes: {
        "data-preview-target-id": targetId,
        "data-preview-prototype-id": prototype.id,
        "data-preview-route": prototype.route || "",
        "data-preview-source-url": sourceUrl ?? ""
      }
    });
  }

  private async requestCanvasExtension(
    session: CanvasSession,
    command: string,
    payload: Record<string, unknown>
  ): Promise<ExtensionOverlayResult> {
    const client = await this.ensureCanvasClient();
    return await client.request<ExtensionOverlayResult>(command, payload, session.canvasSessionId, 30000, session.leaseId);
  }

  private async ensureCanvasClient(): Promise<CanvasClient> {
    const url = this.relay?.getCanvasUrl?.();
    if (!url) {
      throw new Error("Canvas relay unavailable.");
    }
    if (!this.canvasClient || this.canvasEndpoint !== url) {
      const { connectEndpoint } = await resolveRelayEndpoint({
        wsEndpoint: url,
        path: "canvas",
        config: this.config
      });
      this.canvasClient?.disconnect();
      this.canvasClient = new CanvasClient(connectEndpoint, {
        onEvent: (event) => {
          void this.handleCanvasEvent(event).catch(() => {});
        }
      });
      this.canvasEndpoint = url;
      await this.canvasClient.connect();
    }
    return this.canvasClient;
  }

  private async handleCanvasEvent(event: { event: string; canvasSessionId?: string; payload?: unknown }): Promise<void> {
    if (event.event !== "canvas_patch_requested" || typeof event.canvasSessionId !== "string") {
      return;
    }
    const session = this.sessions.get(event.canvasSessionId);
    if (!session) {
      return;
    }
    const payload = isRecord(event.payload) ? event.payload : null;
    if (!payload) {
      return;
    }
    const baseRevision = requireNumber(payload.baseRevision, "baseRevision");
    const patches = requirePatches(payload.patches);
    if (isRecord(payload.selection)) {
      session.editorSelection = {
        pageId: optionalString(payload.selection.pageId) ?? session.editorSelection.pageId,
        nodeId: optionalString(payload.selection.nodeId),
        targetId: optionalString(payload.selection.targetId),
        updatedAt: new Date().toISOString()
      };
    }
    try {
      await this.applyDocumentPatches(session, baseRevision, patches, "editor");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushFeedback(session, {
        category: "validation",
        class: "editor-patch-rejected",
        severity: "warning",
        message,
        pageId: session.editorSelection.pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: [],
        details: { source: "editor" }
      });
      await this.syncLiveViews(session);
    }
  }

  private async mountDirectOverlay(
    sessionId: string,
    targetId: string,
    canvasDocument: CanvasDocument,
    prototypeId: string
  ): Promise<ExtensionOverlayResult> {
    return await this.browserManager.withPage(sessionId, targetId, async (page: DirectPageLike) => {
      await page.addStyleTag({ content: DIRECT_OVERLAY_STYLE });
      return await page.evaluate(({ title, prototype, targetId: pageTargetId }) => {
        const existing = document.getElementById("opendevbrowser-canvas-overlay");
        if (existing) existing.remove();
        const root = document.createElement("div");
        root.id = "opendevbrowser-canvas-overlay";
        root.innerHTML = `<strong>OpenDevBrowser Canvas</strong><div>${title}</div><div>${prototype}</div>`;
        document.body.append(root);
        return {
          mountId: `mount_${crypto.randomUUID()}`,
          targetId: pageTargetId,
          previewState: "background",
          overlayState: "mounted",
          capabilities: { selection: true, guides: true }
        };
      }, { title: canvasDocument.title, prototype: prototypeId, targetId });
    }) as ExtensionOverlayResult;
  }

  private async unmountDirectOverlay(sessionId: string, targetId: string): Promise<void> {
    await this.browserManager.withPage(sessionId, targetId, async (page: DirectPageLike) => {
      await page.evaluate(() => {
        document.getElementById("opendevbrowser-canvas-overlay")?.remove();
        document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
          element.classList.remove("opendevbrowser-canvas-highlight");
        });
      }, undefined);
      return null;
    });
  }

  private async syncDirectOverlay(
    sessionId: string,
    mountId: string,
    targetId: string,
    title: string,
    selection: CanvasSession["editorSelection"]
  ): Promise<void> {
    await this.browserManager.withPage(sessionId, targetId, async (page: DirectPageLike) => {
      await page.addStyleTag({ content: DIRECT_OVERLAY_STYLE });
      await page.evaluate((input) => {
        let root = document.getElementById(input.mountId);
        if (!(root instanceof HTMLElement)) {
          root = document.createElement("div");
          root.id = input.mountId;
          root.innerHTML = "<strong>OpenDevBrowser Canvas</strong><div></div><div></div>";
          document.body.append(root);
        }
        const [heading, titleDetail, selectionDetail] = Array.from(root.children);
        if (heading instanceof HTMLElement) {
          heading.textContent = "OpenDevBrowser Canvas";
        }
        if (titleDetail instanceof HTMLElement) {
          titleDetail.textContent = input.title;
        }
        if (selectionDetail instanceof HTMLElement) {
          selectionDetail.textContent = input.selection.nodeId ? `Selected ${input.selection.nodeId}` : "Canvas overlay synced";
        }
        document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
          element.classList.remove("opendevbrowser-canvas-highlight");
        });
        if (input.selection.nodeId) {
          const element = document.querySelector(`[data-node-id="${input.selection.nodeId}"]`);
          if (element instanceof HTMLElement) {
            element.classList.add("opendevbrowser-canvas-highlight");
          }
        }
      }, { mountId, title, selection });
      return null;
    });
  }

  private async selectDirectOverlay(
    sessionId: string,
    targetId: string,
    nodeId: string | null,
    selectionHint: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return await this.browserManager.withPage(sessionId, targetId, async (page: DirectPageLike) => {
      return await page.evaluate((input) => {
        document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
          element.classList.remove("opendevbrowser-canvas-highlight");
        });
        const selector = typeof input.selectionHint.selector === "string"
          ? input.selectionHint.selector
          : (input.nodeId ? `[data-node-id="${input.nodeId}"]` : null);
        const element = selector ? document.querySelector(selector) : null;
        if (!(element instanceof HTMLElement)) {
          return { matched: false };
        }
        element.classList.add("opendevbrowser-canvas-highlight");
        return {
          matched: true,
          selector,
          tagName: element.tagName.toLowerCase(),
          text: element.innerText.slice(0, 160),
          id: element.id || null,
          /* c8 ignore next -- the highlight class is always added immediately above */
          className: element.className || null
        };
      }, { nodeId, selectionHint });
    }) as Record<string, unknown>;
  }
}

function resolvePreviewUrl(currentUrl: string | undefined, route: string): string | null {
  if (!route) return currentUrl ?? null;
  try {
    const absolute = new URL(route);
    return absolute.toString();
  } catch {
    if (!currentUrl) {
      return route.startsWith("/") ? null : route;
    }
    try {
      const base = new URL(currentUrl);
      return new URL(route, `${base.origin}/`).toString();
    } catch {
      return null;
    }
  }
}

function selectPreviewSourceCandidate(currentUrl: string | undefined, existingSourceUrl: string | null | undefined): string | undefined {
  if (isPreviewSourceCandidate(currentUrl)) {
    return currentUrl;
  }
  if (isPreviewSourceCandidate(existingSourceUrl)) {
    return existingSourceUrl;
  }
  return currentUrl ?? existingSourceUrl ?? undefined;
}

function isPreviewSourceCandidate(url: string | null | undefined): url is string {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:";
  } catch {
    return false;
  }
}

function findPrototypeRuntimeBinding(document: CanvasDocument, prototype: CanvasPrototype): CanvasBinding | null {
  const page = document.pages.find((entry) => entry.id === prototype.pageId);
  if (!page) {
    return null;
  }
  const pageNodeIds = new Set(page.nodes.map((node) => node.id));
  const candidates = document.bindings.filter((binding) => {
    return binding.codeSync?.projection === "bound_app_runtime"
      && pageNodeIds.has(binding.nodeId);
  });
  if (candidates.length === 0) {
    return null;
  }
  const route = prototype.route.trim();
  const routeMatch = route
    ? candidates.find((binding) => binding.codeSync?.route?.trim() === route)
    : null;
  if (routeMatch) {
    return routeMatch;
  }
  const rootBinding = page.rootNodeId
    ? candidates.find((binding) => binding.nodeId === page.rootNodeId)
    : null;
  return rootBinding ?? candidates[0] ?? null;
}

function toAbsoluteUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

async function saveText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const { writeFileAtomic } = await import("../utils/fs");
  writeFileAtomic(path, `${content}\n`, { encoding: "utf-8" });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function requireAttachMode(value: unknown): CodeSyncAttachMode {
  const normalized = optionalString(value) ?? "observer";
  if (normalized !== "observer" && normalized !== "lease_reclaim") {
    throw new Error(`Unsupported attachMode: ${normalized}`);
  }
  return normalized;
}

function requireResolutionPolicy(value: unknown): CodeSyncResolutionPolicy | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized !== "prefer_code" && normalized !== "prefer_canvas" && normalized !== "manual") {
    throw new Error(`Unsupported resolutionPolicy: ${normalized}`);
  }
  return normalized;
}

function requireCanvasBinding(document: CanvasDocument, bindingId: string): CanvasBinding {
  const binding = document.bindings.find((entry) => entry.id === bindingId);
  if (!binding) {
    throw new Error(`Unknown canvas binding: ${bindingId}`);
  }
  return binding;
}

function requireCodeSyncBinding(document: CanvasDocument, bindingId: string): CanvasBinding {
  const binding = requireCanvasBinding(document, bindingId);
  if (!binding.codeSync) {
    throw attachDetails(new Error(`Binding ${bindingId} is not configured for code sync.`), {
      code: "code_sync_required",
      details: { bindingId }
    });
  }
  return binding;
}

function createCodeSyncBinding(params: CanvasCommandParams, nodeId: string, bindingId: string): Omit<CanvasBinding, "nodeId"> & Partial<Pick<CanvasBinding, "nodeId">> {
  const ownership: CodeSyncOwnership = isRecord(params.ownership)
    ? params.ownership as CodeSyncOwnership
    : {
      structure: "shared",
      text: "shared",
      style: "shared",
      tokens: "shared",
      behavior: "code",
      data: "code"
    };
  return {
    id: bindingId,
    nodeId,
    kind: "code-sync",
    selector: optionalString(params.selector) ?? undefined,
    componentName: optionalString(params.componentName) ?? undefined,
    metadata: {},
    codeSync: {
      adapter: "tsx-react-v1",
      repoPath: requireString(params.repoPath, "repoPath"),
      exportName: optionalString(params.exportName) ?? undefined,
      selector: optionalString(params.selector) ?? undefined,
      syncMode: (optionalString(params.syncMode) as "manual" | "watch" | null) ?? "manual",
      ownership,
      route: optionalString(params.route) ?? undefined,
      verificationTarget: optionalString(params.verificationTarget) ?? undefined,
      runtimeRootSelector: optionalString(params.runtimeRootSelector) ?? undefined,
      projection: (optionalString(params.projection) as "canvas_html" | "bound_app_runtime" | null) ?? "canvas_html"
    }
  };
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeOptionalString(value: string | null): string[] {
  return value ? [value] : [];
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function requirePatches(value: unknown): CanvasPatch[] {
  if (!Array.isArray(value)) {
    throw new Error("Missing patches");
  }
  return value as CanvasPatch[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

function requireTabPreviewMode(value: unknown, name: string): "focused" | "pinned" | "background" {
  if (value === "focused" || value === "pinned" || value === "background") {
    return value;
  }
  throw new Error(`Missing ${name}`);
}

function requireRefreshMode(value: unknown, name: string): "full" | "thumbnail" {
  if (value === "full" || value === "thumbnail") {
    return value;
  }
  throw new Error(`Missing ${name}`);
}

function categoryForWarning(warning: CanvasValidationWarning): CanvasFeedbackItem["category"] {
  switch (warning.code) {
    case "broken-asset-reference":
    case "asset-provenance-missing":
      return "asset";
    case "export-warning":
      return "export";
    default:
      return "validation";
  }
}

function dedupeFeedback(items: CanvasFeedbackItem[]): CanvasFeedbackItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function getRuntimeBudgets(document: CanvasDocument): {
  defaultLivePreviewLimit: number;
  maxPinnedFullPreviewExtra: number;
  reconnectGraceMs: number;
  overflowRenderMode: string;
  backgroundTelemetryMode: string;
} {
  const raw = document.designGovernance.runtimeBudgets;
  const runtimeBudgets = isRecord(raw) ? raw : {};
  return {
    defaultLivePreviewLimit: readNumber(runtimeBudgets.defaultLivePreviewLimit, CANVAS_PROJECT_DEFAULTS.runtimeBudgets.defaultLivePreviewLimit),
    maxPinnedFullPreviewExtra: readNumber(runtimeBudgets.maxPinnedFullPreviewExtra, CANVAS_PROJECT_DEFAULTS.runtimeBudgets.maxPinnedFullPreviewExtra),
    reconnectGraceMs: readNumber(runtimeBudgets.reconnectGraceMs, CANVAS_PROJECT_DEFAULTS.runtimeBudgets.reconnectGraceMs),
    overflowRenderMode: typeof runtimeBudgets.overflowRenderMode === "string"
      ? runtimeBudgets.overflowRenderMode
      : CANVAS_PROJECT_DEFAULTS.runtimeBudgets.overflowRenderMode,
    backgroundTelemetryMode: typeof runtimeBudgets.backgroundTelemetryMode === "string"
      ? runtimeBudgets.backgroundTelemetryMode
      : CANVAS_PROJECT_DEFAULTS.runtimeBudgets.backgroundTelemetryMode
  };
}

function getComponentSourceKinds(document: CanvasDocument): string[] {
  const kinds = new Set<string>();
  for (const component of document.componentInventory) {
    if (!isRecord(component)) {
      continue;
    }
    const sourceKind = optionalString(component.sourceKind);
    if (sourceKind) {
      kinds.add(sourceKind);
    }
  }
  return [...kinds].sort((left, right) => left.localeCompare(right));
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function attachDetails(error: Error, details: Record<string, unknown>): Error {
  Object.assign(error, details);
  return error;
}
