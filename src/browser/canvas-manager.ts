import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import type { Page } from "playwright-core";
import type { OpenDevBrowserConfig } from "../config";
import type { RelayLike } from "../relay/relay-types";
import { resolveRelayEndpoint } from "../relay/relay-endpoints";
import type {
  BrowserCanvasOverlayResult,
  BrowserCanvasOverlaySelection,
  BrowserManagerLike
} from "./manager-types";
import { CanvasClient } from "./canvas-client";
import {
  buildDocumentContext,
  buildGovernanceBlockStates,
  CANVAS_PROJECT_DEFAULTS,
  CanvasDocumentStore,
  createDefaultCanvasDocument,
  evaluateCanvasWarnings,
  mergeImportedCanvasState,
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
import {
  BUILT_IN_CANVAS_KITS,
  listBuiltInCanvasInventoryItems,
  listBuiltInCanvasKitIds
} from "../canvas/kits/catalog";
import { loadCanvasDocument, loadCanvasDocumentById, resolveCanvasRepoPath, saveCanvasDocument } from "../canvas/repo-store";
import {
  getBuiltInCanvasStarterDefinition,
  listBuiltInCanvasStarterTemplates
} from "../canvas/starters/catalog";
import type {
  CanvasAdapterCapability,
  CanvasAdapterErrorEnvelope,
  CanvasBlocker,
  CanvasBinding,
  CanvasCapabilityGrant,
  CanvasComponentInventoryItem,
  CanvasDegradeReason,
  CanvasDocument,
  CanvasDocumentImportMode,
  CanvasDocumentImportRequest,
  CanvasDocumentImportResult,
  CanvasFeedbackCompleteReason,
  CanvasFeedbackEvent,
  CanvasFeedbackItem,
  CanvasHistoryDirection,
  CanvasInventoryOrigin,
  CanvasImportFailureCode,
  CanvasImportProvenance,
  CanvasImportSource,
  CanvasFeedbackSubscribeResult,
  CanvasFeedbackUnsubscribeResult,
  CanvasNode,
  CanvasPage,
  CanvasPatch,
  CanvasPlanStatus,
  CanvasPreflightState,
  CanvasPreviewState,
  CanvasRect,
  CanvasPrototype,
  CanvasSessionMode,
  CanvasSessionSummary,
  CanvasStarterTemplate,
  CanvasTargetState,
  CanvasValidationWarning
} from "../canvas/types";
import { CANVAS_SCHEMA_VERSION } from "../canvas/types";
import { CanvasCodeSyncManager } from "./canvas-code-sync-manager";
import { CanvasSessionSyncManager } from "./canvas-session-sync-manager";
import {
  inferBuiltInFrameworkAdapterIdFromPath,
  isCodeSyncCapability,
  normalizeCodeSyncCapabilityGrant,
  normalizeCodeSyncRootLocator,
  normalizeFrameworkAdapterIdentity
} from "../canvas/code-sync/types";
import type {
  CodeSyncAttachMode,
  CodeSyncCapability,
  CodeSyncCapabilityGrant,
  CodeSyncOwnership,
  CodeSyncResolutionPolicy
} from "../canvas/code-sync/types";
import { applyRuntimePreviewBridge } from "./canvas-runtime-preview-bridge";
import { FigmaClient, isFigmaClientError } from "../integrations/figma/client";
import { materializeFigmaAssets } from "../integrations/figma/assets";
import { normalizeFigmaImportRequest } from "../integrations/figma/url";
import { mapFigmaImportToCanvas } from "../integrations/figma/mappers";
import { mapFigmaVariablesToTokenStore } from "../integrations/figma/variables";

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
  "canvas.document.import",
  "canvas.document.patch",
  "canvas.history.undo",
  "canvas.history.redo",
  "canvas.document.save",
  "canvas.document.export",
  "canvas.inventory.list",
  "canvas.inventory.insert",
  "canvas.starter.list",
  "canvas.starter.apply",
  "canvas.tab.open",
  "canvas.tab.close",
  "canvas.overlay.mount",
  "canvas.overlay.unmount",
  "canvas.overlay.select",
  "canvas.preview.render",
  "canvas.preview.refresh",
  "canvas.feedback.poll",
  "canvas.feedback.subscribe",
  "canvas.feedback.next",
  "canvas.feedback.unsubscribe",
  "canvas.code.bind",
  "canvas.code.unbind",
  "canvas.code.pull",
  "canvas.code.push",
  "canvas.code.status",
  "canvas.code.resolve"
] as const;

type CanvasEditorViewportState = {
  x: number;
  y: number;
  zoom: number;
};

type CanvasHistoryEntry = {
  id: string;
  source: PreviewSyncSource;
  createdAt: string;
  forwardPatches: CanvasPatch[];
  inversePatches: CanvasPatch[];
  beforeSelection: CanvasSession["editorSelection"];
  afterSelection: CanvasSession["editorSelection"];
  beforeViewport: CanvasEditorViewportState;
  afterViewport: CanvasEditorViewportState;
  expectedUndoRevision: number;
  expectedRedoRevision: number | null;
};

type CanvasHistoryStateInternal = {
  undoStack: CanvasHistoryEntry[];
  redoStack: CanvasHistoryEntry[];
  depthLimit: number;
};

type CanvasSession = {
  canvasSessionId: string;
  browserSessionId: string | null;
  repoRoot: string;
  documentRepoPath: string | null;
  leaseId: string;
  mode: CanvasSessionMode;
  usesCanvasRelay: boolean;
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
  editorViewport: CanvasEditorViewportState;
  history: CanvasHistoryStateInternal;
  feedbackSubscriptions: Map<string, CanvasFeedbackSubscription>;
};

type CanvasFeedbackStreamEvent = CanvasFeedbackEvent;

type CanvasFeedbackSubscription = {
  id: string;
  categories: Set<string>;
  targetIds: Set<string>;
  queue: CanvasFeedbackStreamEvent[];
  waiters: Array<(event: CanvasFeedbackStreamEvent | null) => void>;
  cursor: string | null;
  heartbeatTimer: NodeJS.Timeout;
  heartbeatMs: number;
  lastHeartbeatAt: number;
  active: boolean;
};

type ExtensionOverlayResult = BrowserCanvasOverlayResult;

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
const DIRECT_OVERLAY_ROOT_ID = "opendevbrowser-canvas-overlay";
const DIRECT_OVERLAY_STYLE_ID = "opendevbrowser-canvas-overlay-style";
const DIRECT_OVERLAY_EVAL_TIMEOUT_MS = 2_500;

const FEEDBACK_BATCH_SIZE = 25;
const FEEDBACK_RETENTION_LIMIT = 200;
const FEEDBACK_HEARTBEAT_MS = 15000;
const CANVAS_HISTORY_DEPTH_LIMIT = 100;
const DEFAULT_CANVAS_EDITOR_VIEWPORT: CanvasEditorViewportState = { x: 120, y: 96, zoom: 1 };

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
      configAdapterPluginDeclarations: this.config.canvas?.adapterPlugins ?? [],
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
      case "canvas.document.import":
        return await this.importDocument(params);
      case "canvas.document.patch":
        return await this.patchDocument(params);
      case "canvas.history.undo":
        return await this.applyHistoryDirection(params, "undo");
      case "canvas.history.redo":
        return await this.applyHistoryDirection(params, "redo");
      case "canvas.document.save":
        return await this.saveDocument(params);
      case "canvas.document.export":
        return await this.exportDocument(params);
      case "canvas.inventory.list":
        return this.listInventory(params);
      case "canvas.inventory.insert":
        return await this.insertInventory(params);
      case "canvas.starter.list":
        return this.listStarters(params);
      case "canvas.starter.apply":
        return await this.applyStarter(params);
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
      case "canvas.feedback.next":
        return await this.nextFeedback(params);
      case "canvas.feedback.unsubscribe":
        return this.unsubscribeFeedback(params);
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
    const repoRoot = optionalString(params.repoRoot) ?? this.worktree;
    const mode = requireCanvasSessionMode(params.mode);
    const document = repoPath
      ? normalizeCanvasDocument(await loadCanvasDocument(repoRoot, repoPath))
      : createDefaultCanvasDocument(requestedDocumentId ?? undefined);
    const sessionId = `canvas_${randomUUID()}`;
    const leaseId = `lease_${randomUUID()}`;
    const session: CanvasSession = {
      canvasSessionId: sessionId,
      browserSessionId,
      repoRoot,
      documentRepoPath: repoPath ?? null,
      leaseId,
      mode,
      usesCanvasRelay: false,
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
      editorViewport: { ...DEFAULT_CANVAS_EDITOR_VIEWPORT },
      history: {
        undoStack: [],
        redoStack: [],
        depthLimit: CANVAS_HISTORY_DEPTH_LIMIT
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
    const warnings: string[] = [];
    for (const mount of session.overlayMounts.values()) {
      await this.unmountOverlay({ canvasSessionId: session.canvasSessionId, leaseId: session.leaseId, mountId: mount.mountId, targetId: mount.targetId });
    }
    if (session.designTabTargetId) {
      try {
        await this.closeTab({
          canvasSessionId: session.canvasSessionId,
          leaseId: session.leaseId,
          targetId: session.designTabTargetId
        });
      } catch (error) {
        if (isAlreadyClosedCanvasTargetError(error)) {
          session.activeTargets.delete(session.designTabTargetId);
          session.designTabTargetId = null;
        } else {
          if (!isIgnorableCanvasSessionCloseError(error)) {
            throw error;
          }
          const detail = error instanceof Error ? error.message : String(error ?? "Canvas design tab close failed.");
          const recovered = await this.recoverCanvasDesignTabClose(session, session.designTabTargetId, detail);
          if (!recovered) {
            warnings.push(detail);
          }
          session.activeTargets.delete(session.designTabTargetId);
          session.designTabTargetId = null;
        }
      }
    }
    this.completeFeedbackSubscriptions(session, "session_closed");
    this.sessionSyncManager.removeSession(session.canvasSessionId);
    this.codeSyncManager.disposeSession(session.canvasSessionId);
    this.sessions.delete(session.canvasSessionId);
    this.disconnectCanvasClientIfIdle();
    return { ok: true, releasedTargets, releasedOverlays: true, warnings };
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
    const repoRoot = this.resolveSessionRepoRoot(session, params);
    if (Boolean(documentId) === Boolean(repoPath)) {
      throw new Error("Provide exactly one of documentId or repoPath.");
    }
    if (!repoPath && !session.documentRepoPath && documentId === session.store.getDocumentId()) {
      return {
        documentId: session.store.getDocumentId(),
        documentRevision: session.store.getRevision(),
        document: session.store.getDocument(),
        handshake: this.buildHandshake(session)
      };
    }
    const sessionRepoPath = !repoPath && documentId === session.store.getDocumentId()
      ? session.documentRepoPath
      : null;
    const resolvedRepoPath = repoPath ?? sessionRepoPath;
    const document = resolvedRepoPath
      ? normalizeCanvasDocument(await loadCanvasDocument(repoRoot, resolvedRepoPath))
      : normalizeCanvasDocument(await loadCanvasDocumentById(repoRoot, documentId as string) ?? createDefaultCanvasDocument(documentId as string));
    session.store.loadDocument(document);
    session.repoRoot = repoRoot;
    session.documentRepoPath = resolvedRepoPath;
    session.planStatus = isNonEmptyRecord(document.designGovernance.generationPlan) ? "accepted" : "missing";
    session.preflightState = session.planStatus === "accepted" ? "plan_accepted" : "handshake_read";
    session.editorSelection = {
      pageId: document.pages[0]?.id ?? null,
      nodeId: null,
      targetId: null,
      updatedAt: new Date().toISOString()
    };
    session.editorViewport = { ...DEFAULT_CANVAS_EDITOR_VIEWPORT };
    this.resetHistory(session);
    await this.registerDocumentCodeSyncBindings(session);
    await this.syncLiveViews(session);
    return {
      documentId: session.store.getDocumentId(),
      documentRevision: session.store.getRevision(),
      document: session.store.getDocument(),
      handshake: this.buildHandshake(session)
    };
  }

  private async importDocument(params: CanvasCommandParams): Promise<CanvasDocumentImportResult> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    if (session.planStatus !== "accepted") {
      throw this.planRequired("canvas.document.import", session);
    }
    const baseRevision = params.baseRevision === undefined
      ? session.store.getRevision()
      : requireNumber(params.baseRevision, "baseRevision");
    const importRequest = normalizeFigmaImportRequest(readCanvasDocumentImportRequest(params));
    const client = new FigmaClient({ config: this.config });
    this.pushFeedback(session, {
      category: "import",
      class: "figma-import-started",
      severity: "info",
      message: `Importing Figma ${importRequest.nodeIds.length > 0 ? "selection" : "file"} ${importRequest.fileKey}.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: {
        fileKey: importRequest.fileKey,
        nodeIds: importRequest.nodeIds,
        mode: importRequest.mode
      }
    });

    const payload = importRequest.nodeIds.length > 0
      ? await client.getNodes(importRequest.fileKey, importRequest.nodeIds, {
        branchData: importRequest.branchData,
        depth: importRequest.depth,
        geometryPaths: importRequest.geometryPaths
      })
      : await client.getFile(importRequest.fileKey, {
        branchData: importRequest.branchData,
        geometryPaths: importRequest.geometryPaths
      });

    const degradedFailureCodes = new Set<CanvasImportFailureCode>();
    let variableMapping: ReturnType<typeof mapFigmaVariablesToTokenStore> | null = null;
    if (importRequest.includeVariables) {
      try {
        const variables = await client.getLocalVariables(importRequest.fileKey);
        variableMapping = mapFigmaVariablesToTokenStore(variables);
      } catch (error) {
        if (!isFigmaClientError(error)) {
          throw error;
        }
        degradedFailureCodes.add(error.code);
        this.pushFeedback(session, {
          category: "validation",
          class: "figma-variables-degraded",
          severity: "warning",
          message: error.message,
          pageId: session.editorSelection.pageId,
          prototypeId: null,
          targetId: session.editorSelection.targetId,
          evidenceRefs: [],
          details: {
            fileKey: importRequest.fileKey,
            code: error.code,
            status: error.status,
            retryAfterMs: error.retryAfterMs,
            ...error.details
          }
        });
      }
    }

    const assetResult = await materializeFigmaAssets({
      worktree: this.resolveSessionRepoRoot(session),
      fileKey: importRequest.fileKey,
      nodes: payload.rootNodes,
      client
    });
    if (assetResult.assetReceipts.some((receipt) => receipt.status === "asset_fetch_failed")) {
      degradedFailureCodes.add("asset_fetch_failed");
      this.pushFeedback(session, {
        category: "asset",
        class: "figma-assets-degraded",
        severity: "warning",
        message: "One or more Figma assets could not be cached locally.",
        pageId: session.editorSelection.pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: assetResult.assetReceipts
          .flatMap((receipt) => receipt.repoPath ? [receipt.repoPath] : []),
        details: {
          fileKey: importRequest.fileKey,
          assetReceipts: assetResult.assetReceipts
        }
      });
    }

    const frameworkMaterialized = false;
    const mapping = mapFigmaImportToCanvas({
      payload,
      assets: assetResult.assets,
      variables: variableMapping,
      requestedFrameworkId: importRequest.frameworkId,
      requestedFrameworkAdapterId: importRequest.frameworkAdapterId,
      frameworkMaterialized
    });
    for (const code of mapping.degradedFailureCodes) {
      degradedFailureCodes.add(code);
    }

    const provenance = buildFigmaImportProvenance(importRequest, payload, assetResult.assetReceipts, [...degradedFailureCodes], frameworkMaterialized);
    const nextDocument = mergeImportedCanvasState(session.store.getDocument(), {
      mode: importRequest.mode,
      targetPageId: session.editorSelection.pageId,
      pages: mapping.pages,
      componentInventory: mapping.componentInventory,
      tokens: mapping.tokens,
      assets: mapping.assets,
      provenance
    });
    const result = session.store.replaceDocumentState(baseRevision, nextDocument);
    session.preflightState = "patching_enabled";
    session.editorSelection = {
      pageId: mapping.importedPageIds[0] ?? session.editorSelection.pageId,
      nodeId: mapping.importedNodeIds[0] ?? null,
      targetId: session.editorSelection.targetId,
      updatedAt: provenance.importedAt!
    };
    this.resetHistory(session);
    this.emitWarnings(session, result.warnings, { category: "validation" });
    await this.registerDocumentCodeSyncBindings(session);
    await this.syncLiveViews(session, { refreshPreviewTargets: true, source: "agent" });

    this.pushFeedback(session, {
      category: "import",
      class: [...degradedFailureCodes].length > 0 ? "figma-import-complete-degraded" : "figma-import-complete",
      severity: [...degradedFailureCodes].length > 0 ? "warning" : "info",
      message: [...degradedFailureCodes].length > 0
        ? `Imported Figma content from ${importRequest.fileKey} with degraded paths.`
        : `Imported Figma content from ${importRequest.fileKey}.`,
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: assetResult.assetReceipts
        .flatMap((receipt) => receipt.repoPath ? [receipt.repoPath] : []),
      details: {
        fileKey: importRequest.fileKey,
        mode: importRequest.mode,
        degradedFailureCodes: [...degradedFailureCodes],
        importedPageIds: mapping.importedPageIds,
        importedInventoryItemIds: mapping.importedInventoryItemIds,
        importedTokenCollectionIds: mapping.importedTokenCollectionIds
      }
    });

    return {
      ok: true,
      mode: importRequest.mode,
      documentRevision: result.appliedRevision,
      importedPageIds: mapping.importedPageIds,
      importedNodeIds: mapping.importedNodeIds,
      importedInventoryItemIds: mapping.importedInventoryItemIds,
      importedAssetIds: assetResult.assets.map((asset) => asset.id),
      importedTokenCollectionIds: mapping.importedTokenCollectionIds,
      degradedFailureCodes: [...degradedFailureCodes],
      provenance,
      summary: this.buildSessionSummary(session)
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
      return await this.applyDocumentPatches(session, baseRevision, patches, "agent", {
        recordHistory: true
      });
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
    source: "agent" | "editor",
    options: {
      recordHistory?: boolean;
      beforeSelection?: CanvasSession["editorSelection"];
      beforeViewport?: CanvasEditorViewportState;
    } = {}
  ): Promise<{
    transactionId: string;
    appliedRevision: number;
    warnings: CanvasValidationWarning[];
    evidenceRefs: string[];
  }> {
    const normalizedPatches = this.normalizeHistoryAwarePatches(session.store.getDocument(), patches);
    const beforeSelection = options.beforeSelection
      ? cloneEditorSelection(options.beforeSelection)
      : cloneEditorSelection(session.editorSelection);
    const beforeViewport = options.beforeViewport
      ? cloneEditorViewport(options.beforeViewport)
      : cloneEditorViewport(session.editorViewport);
    const beforeDocument = structuredClone(session.store.getDocument());
    const result = session.store.applyPatches(baseRevision, normalizedPatches);
    if (options.recordHistory) {
      this.recordHistoryEntry(session, beforeDocument, normalizedPatches, beforeSelection, beforeViewport, result.appliedRevision, source);
    }
    session.preflightState = "patching_enabled";
    this.pushFeedback(session, {
      category: "validation",
      class: source === "editor" ? "editor-document-patched" : "document-patched",
      severity: "info",
      message: `Applied ${normalizedPatches.length} canvas patch${normalizedPatches.length === 1 ? "" : "es"} from ${source}.`,
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
    const nextBinding = requireCodeSyncBinding(session.store.getDocument(), binding.id);
    const bindingStatus = await this.codeSyncManager.bind({
      canvasSessionId: session.canvasSessionId,
      worktree: this.resolveSessionRepoRoot(session, params),
      document: session.store.getDocument(),
      documentRevision: session.store.getRevision(),
      binding: nextBinding
    });
    this.pushFeedback(session, {
      category: "code-sync",
      class: "code-sync-bound",
      severity: "info",
      message: `Bound ${nextBinding.codeSync.repoPath} for code sync.`,
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
      worktree: this.resolveSessionRepoRoot(session, params),
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
      worktree: this.resolveSessionRepoRoot(session, params),
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
        this.resolveSessionRepoRoot(session, params),
        session.store.getDocument().documentId,
        binding,
        session.store.getRevision()
      );
      if (binding.codeSync?.syncMode === "watch" && bindingStatus.state === "drift_detected" && bindingStatus.driftState === "source_changed") {
        await this.handleWatchedSourceChange(session.canvasSessionId, binding.id);
        bindingStatus = await this.codeSyncManager.getBindingStatus(
          session.canvasSessionId,
          this.resolveSessionRepoRoot(session, params),
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
        this.resolveSessionRepoRoot(session, params),
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
    const resolutionPolicy = requireResolutionPolicy(requireString(params.resolutionPolicy, "resolutionPolicy")) as CodeSyncResolutionPolicy;
    const result = await this.codeSyncManager.resolve({
      canvasSessionId: session.canvasSessionId,
      worktree: this.resolveSessionRepoRoot(session, params),
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

  private resolveSessionRepoRoot(session: CanvasSession, params?: CanvasCommandParams): string {
    const repoRoot = optionalString(params?.repoRoot) ?? session.repoRoot ?? this.worktree;
    session.repoRoot = repoRoot;
    return repoRoot;
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
        worktree: this.resolveSessionRepoRoot(session),
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
      worktree: this.resolveSessionRepoRoot(session),
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
    const repoRoot = this.resolveSessionRepoRoot(session, params);
    const validation = validateCanvasSave(document);
    if (validation.missingBlocks.length > 0) {
      throw this.policyViolation("canvas.document.save", session, validation.missingBlocks, validation.warnings);
    }
    const repoPath = await saveCanvasDocument(repoRoot, document, optionalString(params.repoPath));
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
    const repoRoot = this.resolveSessionRepoRoot(session, params);
    const warnings = evaluateCanvasWarnings(document, { forSave: exportTarget === "design_document" });
    const exportBase = resolveCanvasRepoPath(repoRoot, document.documentId, ".opendevbrowser/canvas/exports");
    await mkdir(dirname(exportBase), { recursive: true });
    if (exportTarget === "design_document") {
      const validation = validateCanvasSave(document);
      if (validation.missingBlocks.length > 0) {
        throw this.policyViolation("canvas.document.export", session, validation.missingBlocks, validation.warnings);
      }
      const repoPath = await saveCanvasDocument(repoRoot, document, optionalString(params.repoPath));
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

  private listInventory(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    const document = session.store.getDocument();
    const availableInventory = getAvailableInventory(document);
    const query = optionalString(params.query)?.toLowerCase() ?? null;
    const sourceFamilies = new Set(normalizeStringArray(params.sourceFamilies));
    const origins = new Set<CanvasInventoryOrigin>(normalizeStringArray(params.origins) as CanvasInventoryOrigin[]);
    const frameworkIds = new Set(normalizeStringArray(params.frameworkIds));
    const adapterIds = new Set(normalizeStringArray(params.adapterIds));
    const pluginIds = new Set(normalizeStringArray(params.pluginIds));
    const items = availableInventory.filter((item) => {
      if (query) {
        const haystack = [
          item.id,
          item.name,
          item.componentName,
          item.description,
          item.sourceKind,
          item.framework?.id,
          item.adapter?.id,
          item.plugin?.id
        ]
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      if (sourceFamilies.size > 0 && !sourceFamilies.has(item.sourceFamily)) {
        return false;
      }
      if (origins.size > 0 && !origins.has(item.origin)) {
        return false;
      }
      if (frameworkIds.size > 0 && !frameworkIds.has(item.framework?.id ?? "")) {
        return false;
      }
      if (adapterIds.size > 0 && !adapterIds.has(item.adapter?.id ?? "")) {
        return false;
      }
      if (pluginIds.size > 0 && !pluginIds.has(item.plugin?.id ?? "")) {
        return false;
      }
      return true;
    });
    return {
      items,
      total: items.length,
      summary: this.buildSessionSummary(session)
    };
  }

  private async insertInventory(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    if (session.planStatus !== "accepted") {
      throw this.planRequired("canvas.inventory.insert", session);
    }
    const document = session.store.getDocument();
    const item = requireInventoryItem(getAvailableInventory(document), requireString(params.itemId, "itemId"));
    const pageId = optionalString(params.pageId) ?? session.editorSelection.pageId ?? document.pages[0]?.id ?? null;
    if (!pageId) {
      throw new Error("Missing pageId");
    }
    const page = requireCanvasPage(document, pageId);
    const parentId = optionalString(params.parentId)
      ?? session.editorSelection.nodeId
      ?? page.rootNodeId
      ?? null;
    if (parentId) {
      findNodeInPage(page, parentId);
    }
    const baseRevision = params.baseRevision === undefined
      ? session.store.getRevision()
      : requireNumber(params.baseRevision, "baseRevision");
    const placement = readInsertPlacement(params);
    const materialized = materializeInventoryItem(item, pageId, parentId, placement);
    const previousSelection = { ...session.editorSelection };
    session.editorSelection = {
      pageId,
      nodeId: materialized.rootNodeId,
      targetId: previousSelection.targetId,
      updatedAt: new Date().toISOString()
    };
    try {
      const result = await this.applyDocumentPatches(session, baseRevision, materialized.patches, "agent", {
        recordHistory: true,
        beforeSelection: previousSelection
      });
      this.pushFeedback(session, {
        category: "validation",
        class: "inventory-inserted",
        severity: "info",
        message: `Inserted inventory item ${item.name}.`,
        pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: [],
        details: {
          itemId: item.id,
          insertedNodeIds: materialized.insertedNodeIds
        }
      });
      return {
        ok: true,
        itemId: item.id,
        insertedNodeIds: materialized.insertedNodeIds,
        rootNodeId: materialized.rootNodeId,
        documentRevision: result.appliedRevision,
        summary: this.buildSessionSummary(session)
      };
    } catch (error) {
      session.editorSelection = previousSelection;
      throw error;
    }
  }

  private listStarters(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    const query = optionalString(params.query)?.toLowerCase() ?? null;
    const frameworkIds = new Set(normalizeStringArray(params.frameworkIds).map((entry) => canonicalizeStarterFrameworkId(entry)));
    const kitIds = new Set(normalizeStringArray(params.kitIds));
    const tags = new Set(normalizeStringArray(params.tags));
    const items = listBuiltInCanvasStarterTemplates().filter((starter) => {
      if (query) {
        const haystack = [
          starter.id,
          starter.name,
          starter.description,
          starter.defaultFrameworkId,
          ...starter.compatibleFrameworkIds,
          ...starter.kitIds,
          ...starter.tags
        ]
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      if (frameworkIds.size > 0 && !starter.compatibleFrameworkIds.some((entry) => frameworkIds.has(entry))) {
        return false;
      }
      if (kitIds.size > 0 && !starter.kitIds.some((entry) => kitIds.has(entry))) {
        return false;
      }
      if (tags.size > 0 && !starter.tags.some((entry) => tags.has(entry))) {
        return false;
      }
      return true;
    });
    return {
      items,
      total: items.length,
      summary: this.buildSessionSummary(session)
    };
  }

  private async applyStarter(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const starterId = requireString(params.starterId, "starterId");
    const definition = getBuiltInCanvasStarterDefinition(starterId);
    if (!definition) {
      throw new Error(`Unknown starter template: ${starterId}`);
    }

    const initialRevision = session.store.getRevision();
    const requestedBaseRevision = params.baseRevision === undefined
      ? initialRevision
      : requireNumber(params.baseRevision, "baseRevision");
    if (requestedBaseRevision !== initialRevision) {
      throw this.revisionConflict("canvas.starter.apply", session);
    }

    const document = session.store.getDocument();
    const pageId = optionalString(params.pageId) ?? session.editorSelection.pageId ?? document.pages[0]?.id ?? null;
    if (!pageId) {
      throw new Error("Missing pageId");
    }
    const page = requireCanvasPage(document, pageId);
    const parentId = optionalString(params.parentId)
      ?? session.editorSelection.nodeId
      ?? page.rootNodeId
      ?? null;
    if (parentId) {
      findNodeInPage(page, parentId);
    }
    const placement = readInsertPlacement(params);
    const requestedFrameworkId = optionalString(params.frameworkId);
    const requestedAdapterId = optionalString(params.libraryAdapterId) ?? optionalString(params.adapterId);
    const resolvedFramework = resolveStarterFramework(document, definition.template, requestedFrameworkId);
    const resolvedAdapter = resolveStarterAdapter(definition.template.kitIds, requestedAdapterId);
    const degradedReason = resolvedFramework.reason ?? resolvedAdapter.reason ?? null;
    const degraded = degradedReason !== null;
    let planSeeded = false;
    if (session.planStatus !== "accepted" || !isNonEmptyRecord(document.designGovernance.generationPlan)) {
      const result = session.store.setGenerationPlan(structuredClone(definition.generationPlan));
      session.planStatus = result.planStatus;
      session.preflightState = "plan_accepted";
      planSeeded = true;
      this.emitWarnings(session, result.warnings, { category: "validation" });
    }
    const shell = buildStarterShell(definition, pageId, parentId, placement);
    const inventoryPatches = buildStarterInventoryUpsertPatches(
      definition.template.kitIds,
      resolvedFramework.frameworkId,
      resolvedAdapter.adapterId
    );
    const tokenPatch = buildStarterTokenMergePatch(definition.template.kitIds);
    const seededItems = inventoryPatches.map((patch) => patch.item.id);
    const materialized = degraded
      ? { insertedNodeIds: shell.insertedNodeIds, rootNodeId: shell.rootNodeId, itemIds: [] as string[], patches: [] as CanvasPatch[] }
      : buildStarterMaterialization(
        definition,
        resolvedFramework.frameworkId,
        resolvedAdapter.adapterId,
        pageId,
        shell.rootNodeId,
        shell.rect
      );
    const insertedNodeIds = degraded
      ? shell.insertedNodeIds
      : [...shell.insertedNodeIds, ...materialized.insertedNodeIds];
    const starterAppliedAt = new Date().toISOString();
    const starterPatch: CanvasPatch = {
      op: "starter.apply",
      starter: {
        template: structuredClone(definition.template),
        frameworkId: resolvedFramework.frameworkId,
        appliedAt: starterAppliedAt,
        metadata: {
          adapterId: resolvedAdapter.adapterId,
          libraryAdapterId: resolvedAdapter.adapterId,
          degraded,
          reason: degradedReason,
          requestedFrameworkId,
          requestedAdapterId,
          installedKitIds: definition.template.kitIds,
          seededInventoryItemIds: seededItems,
          materializedItemIds: materialized.itemIds
        }
      }
    };
    const patches: CanvasPatch[] = [
      ...shell.patches,
      ...(tokenPatch ? [tokenPatch] : []),
      ...inventoryPatches,
      ...materialized.patches,
      starterPatch
    ];
    const previousSelection = { ...session.editorSelection };
    session.editorSelection = {
      pageId,
      nodeId: materialized.rootNodeId,
      targetId: previousSelection.targetId,
      updatedAt: starterAppliedAt
    };
    try {
      const result = await this.applyDocumentPatches(session, session.store.getRevision(), patches, "agent", {
        recordHistory: true,
        beforeSelection: previousSelection
      });
      this.pushFeedback(session, {
        category: "validation",
        class: degraded ? "starter-applied-degraded" : "starter-applied",
        severity: degraded ? "warning" : "info",
        message: degraded
          ? `Applied starter ${definition.template.name} with semantic fallback for ${resolvedFramework.frameworkId}.`
          : `Applied starter ${definition.template.name}.`,
        pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: [],
        details: {
          starterId: definition.template.id,
          frameworkId: resolvedFramework.frameworkId,
          adapterId: resolvedAdapter.adapterId,
          libraryAdapterId: resolvedAdapter.adapterId,
          degraded,
          reason: degradedReason,
          planSeeded,
          installedKitIds: definition.template.kitIds,
          seededInventoryItemIds: seededItems,
          insertedNodeIds
        }
      });
      return {
        ok: true,
        starterId: definition.template.id,
        frameworkId: resolvedFramework.frameworkId,
        adapterId: resolvedAdapter.adapterId,
        libraryAdapterId: resolvedAdapter.adapterId,
        degraded,
        reason: degradedReason,
        planSeeded,
        pageId,
        rootNodeId: materialized.rootNodeId,
        insertedNodeIds,
        seededInventoryItemIds: seededItems,
        installedKitIds: definition.template.kitIds,
        documentRevision: result.appliedRevision,
        summary: this.buildSessionSummary(session)
      };
    } catch (error) {
      session.editorSelection = previousSelection;
      throw error;
    }
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
          selection: session.editorSelection,
          viewport: session.editorViewport
        });
        session.designTabTargetId = typeof result.targetId === "string" ? result.targetId : null;
        const registerCanvasTarget = this.browserManager.registerCanvasTarget;
        if (
          session.designTabTargetId
          && typeof registerCanvasTarget === "function"
          && this.hasLiveOpsDesignTabTransport(session)
        ) {
          session.designTabTargetId = await this.ensureExtensionDesignTabRegistered(
            session.browserSessionId,
            session.designTabTargetId,
            registerCanvasTarget.bind(this.browserManager)
          );
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

  private async ensureExtensionDesignTabRegistered(
    browserSessionId: string,
    initialTargetId: string,
    registerCanvasTarget: (sessionId: string, targetId: string) => Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean }>
  ): Promise<string> {
    const register = async (targetId: string): Promise<string> => {
      const adopted = await registerCanvasTarget(browserSessionId, targetId);
      return typeof adopted.targetId === "string" && adopted.targetId.length > 0
        ? adopted.targetId
        : targetId;
    };

    let targetId = await register(initialTargetId);
    if (await this.isBrowserTargetRegistered(browserSessionId, targetId)) {
      return targetId;
    }

    targetId = await register(targetId);
    if (await this.isBrowserTargetRegistered(browserSessionId, targetId)) {
      return targetId;
    }

    throw new Error("canvas.tab.open could not register the design tab for /ops. Reload the unpacked extension and retry.");
  }

  private async isBrowserTargetRegistered(browserSessionId: string, targetId: string): Promise<boolean> {
    if (typeof this.browserManager.listTargets !== "function") {
      return true;
    }
    const listed = await this.browserManager.listTargets(browserSessionId, false);
    return listed.targets.some((target) => target.targetId === targetId);
  }

  private async closeTab(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const targetId = requireString(params.targetId, "targetId");
    if (!session.browserSessionId) {
      throw new Error("canvas.tab.close requires a browserSessionId.");
    }
    const useCanvasRelay = session.designTabTargetId === targetId && session.usesCanvasRelay;
    if (useCanvasRelay) {
      await this.requestCanvasExtension(session, "canvas.tab.close", {
        targetId,
        browserSessionId: session.browserSessionId
      });
    } else {
      await this.browserManager.closeTarget(session.browserSessionId, targetId);
    }
    if (session.designTabTargetId === targetId) {
      session.designTabTargetId = null;
    }
    session.activeTargets.delete(targetId);
    this.disconnectCanvasClientIfIdle();
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
    if (this.usesCanvasRelayOverlay(session, targetId, status.mode)) {
      result = await this.requestCanvasExtension(session, "canvas.overlay.mount", {
        targetId,
        prototypeId,
        document: session.store.getDocument(),
        documentRevision: session.store.getRevision()
      });
    } else if (status.mode === "extension" && this.supportsOpsOverlayTransport(session) && typeof this.browserManager.mountCanvasOverlay === "function") {
      const mountId = `mount_${randomUUID()}`;
      result = await this.browserManager.mountCanvasOverlay(session.browserSessionId, targetId, {
        mountId,
        title: session.store.getDocument().title,
        prototypeId,
        selection: this.buildOverlaySelection(session, targetId)
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
    if (this.usesCanvasRelayOverlay(session, mount.targetId, status.mode)) {
      await this.requestCanvasExtension(session, "canvas.overlay.unmount", { mountId, targetId: mount.targetId });
    } else if (status.mode === "extension" && this.supportsOpsOverlayTransport(session) && typeof this.browserManager.unmountCanvasOverlay === "function") {
      await this.browserManager.unmountCanvasOverlay(session.browserSessionId, mount.targetId, mountId);
    } else {
      await this.unmountDirectOverlay(session.browserSessionId, mount.targetId, mount.mountId);
    }
    session.overlayMounts.delete(mountId);
    await this.syncLiveViews(session);
    this.disconnectCanvasClientIfIdle();
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
    const selection = this.usesCanvasRelayOverlay(session, targetId, status.mode)
      ? await this.requestCanvasExtension(session, "canvas.overlay.select", { mountId, targetId, nodeId, selectionHint: hint })
      : status.mode === "extension" && this.supportsOpsOverlayTransport(session) && typeof this.browserManager.selectCanvasOverlay === "function"
        ? await this.browserManager.selectCanvasOverlay(session.browserSessionId, targetId, {
          mountId,
          nodeId,
          selectionHint: hint
        })
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
    let fallbackReason: CanvasTargetState["fallbackReason"] = null;
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

  private subscribeFeedback(params: CanvasCommandParams): CanvasFeedbackSubscribeResult & Record<string, unknown> {
    const session = this.requireSession(params);
    const polled = this.pollFeedback(params) as { items: CanvasFeedbackItem[]; nextCursor: string | null };
    const subscriptionId = `canvas_sub_${randomUUID()}`;
    const heartbeatMs = FEEDBACK_HEARTBEAT_MS;
    const subscription: CanvasFeedbackSubscription = {
      id: subscriptionId,
      categories: new Set(normalizeStringArray(params.categories)),
      targetIds: new Set([...normalizeStringArray(params.targetIds), ...normalizeOptionalString(optionalString(params.targetId))]),
      queue: [],
      waiters: [],
      cursor: polled.nextCursor,
      heartbeatMs,
      lastHeartbeatAt: Date.now(),
      heartbeatTimer: setInterval(() => {
        if (!subscription.active) {
          return;
        }
        if (Date.now() - subscription.lastHeartbeatAt < subscription.heartbeatMs) {
          return;
        }
        subscription.lastHeartbeatAt = Date.now();
        this.enqueueFeedbackEvent(subscription, {
          eventType: "feedback.heartbeat",
          cursor: subscription.cursor,
          ts: new Date().toISOString(),
          activeTargetIds: [...session.activeTargets.keys()]
        });
      }, heartbeatMs),
      active: true
    };
    subscription.heartbeatTimer.unref?.();
    session.feedbackSubscriptions.set(subscriptionId, subscription);
    const response: CanvasFeedbackSubscribeResult & Record<string, unknown> = {
      subscriptionId,
      cursor: polled.nextCursor,
      heartbeatMs,
      expiresAt: null,
      initialItems: polled.items,
      activeTargetIds: [...session.activeTargets.keys()]
    };
    Object.defineProperty(response, "stream", {
      enumerable: false,
      value: this.createFeedbackStream(subscription)
    });
    Object.defineProperty(response, "unsubscribe", {
      enumerable: false,
      value: () => {
        this.completeFeedbackSubscription(session, subscriptionId, "subscription_replaced");
        session.feedbackSubscriptions.delete(subscriptionId);
      }
    });
    return response;
  }

  private async nextFeedback(params: CanvasCommandParams): Promise<CanvasFeedbackEvent> {
    const session = this.requireSession(params);
    const subscription = this.requireFeedbackSubscription(session, requireString(params.subscriptionId, "subscriptionId"));
    const timeoutMs = params.timeoutMs === undefined ? undefined : requirePositiveNumber(params.timeoutMs, "timeoutMs");
    const nextEvent = await this.awaitFeedbackEvent(session, subscription, timeoutMs);
    if (!subscription.active && nextEvent.eventType === "feedback.complete" && subscription.queue.length === 0) {
      session.feedbackSubscriptions.delete(subscription.id);
    }
    return nextEvent;
  }

  private unsubscribeFeedback(params: CanvasCommandParams): CanvasFeedbackUnsubscribeResult {
    const session = this.requireSession(params);
    const subscriptionId = requireString(params.subscriptionId, "subscriptionId");
    this.completeFeedbackSubscription(session, subscriptionId, "subscription_replaced");
    session.feedbackSubscriptions.delete(subscriptionId);
    return { ok: true, subscriptionId };
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

  private requireFeedbackSubscription(session: CanvasSession, subscriptionId: string): CanvasFeedbackSubscription {
    const subscription = session.feedbackSubscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error(`Unknown feedback subscription: ${subscriptionId}`);
    }
    return subscription;
  }

  private async awaitFeedbackEvent(
    session: CanvasSession,
    subscription: CanvasFeedbackSubscription,
    timeoutMs?: number
  ): Promise<CanvasFeedbackEvent> {
    if (subscription.queue.length > 0) {
      return subscription.queue.shift() as CanvasFeedbackEvent;
    }
    if (!subscription.active) {
      return {
        eventType: "feedback.complete",
        cursor: subscription.cursor,
        ts: new Date().toISOString(),
        reason: "subscription_replaced"
      };
    }
    return await new Promise<CanvasFeedbackEvent>((resolve) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      const resolveWaiter = (event: CanvasFeedbackEvent | null) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (!event) {
          resolve({
            eventType: "feedback.complete",
            cursor: subscription.cursor,
            ts: new Date().toISOString(),
            reason: "subscription_replaced"
          });
          return;
        }
        resolve(event);
      };
      subscription.waiters.push(resolveWaiter);
      if (timeoutMs === undefined) {
        return;
      }
      timeoutHandle = setTimeout(() => {
        const waiterIndex = subscription.waiters.indexOf(resolveWaiter);
        if (waiterIndex >= 0) {
          subscription.waiters.splice(waiterIndex, 1);
        }
        subscription.lastHeartbeatAt = Date.now();
        resolve({
          eventType: "feedback.heartbeat",
          cursor: subscription.cursor,
          ts: new Date(subscription.lastHeartbeatAt).toISOString(),
          activeTargetIds: [...session.activeTargets.keys()]
        });
      }, timeoutMs);
      timeoutHandle.unref?.();
    });
  }

  private enqueueFeedbackEvent(subscription: CanvasFeedbackSubscription, event: CanvasFeedbackStreamEvent): void {
    if (!subscription.active && event.eventType !== "feedback.complete") {
      return;
    }
    if (event.eventType === "feedback.heartbeat") {
      subscription.lastHeartbeatAt = Date.now();
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
    reason: CanvasFeedbackCompleteReason
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
    reason: CanvasFeedbackCompleteReason
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
      availableInventoryCount: getAvailableInventory(document).length,
      catalogKitIds: listBuiltInCanvasKitIds(),
      availableStarterCount: listBuiltInCanvasStarterTemplates().length,
      componentSourceKinds: getComponentSourceKinds(document),
      frameworkIds: getFrameworkIds(document),
      pluginIds: getPluginIds(document),
      inventoryOrigins: getInventoryOrigins(document),
      declaredCapabilities: getDeclaredCapabilities(document),
      grantedCapabilities: getGrantedCapabilities(document),
      capabilityDenials: getCapabilityDenials(document),
      pluginErrors: getPluginErrors(document),
      importSources: getImportSources(document),
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
      lastImportAt: getLatestImportedAt(document) ?? codeSyncStatus.lastImportAt,
      lastPushAt: codeSyncStatus.lastPushAt,
      starterId: document.meta.starter?.template?.id ?? null,
      starterName: document.meta.starter?.template?.name ?? null,
      starterFrameworkId: document.meta.starter?.frameworkId ?? null,
      starterAppliedAt: document.meta.starter?.appliedAt ?? null,
      bindings: codeSyncStatus.bindings,
      history: this.buildHistorySummary(session)
    };
  }

  private buildHistorySummary(session: CanvasSession): NonNullable<CanvasSessionSummary["history"]> {
    const stale = this.isHistoryStale(session);
    return {
      canUndo: !stale && session.history.undoStack.length > 0,
      canRedo: !stale && session.history.redoStack.length > 0,
      undoDepth: session.history.undoStack.length,
      redoDepth: session.history.redoStack.length,
      stale,
      depthLimit: session.history.depthLimit
    };
  }

  private isHistoryStale(session: CanvasSession): boolean {
    const currentRevision = session.store.getRevision();
    const undoEntry = session.history.undoStack.at(-1);
    if (undoEntry && undoEntry.expectedUndoRevision !== currentRevision) {
      return true;
    }
    const redoEntry = session.history.redoStack.at(-1);
    if (redoEntry && redoEntry.expectedRedoRevision !== null && redoEntry.expectedRedoRevision !== currentRevision) {
      return true;
    }
    return false;
  }

  private resetHistory(session: CanvasSession): void {
    session.history.undoStack = [];
    session.history.redoStack = [];
  }

  private syncHistoryStackHeads(session: CanvasSession): void {
    const currentRevision = session.store.getRevision();
    const undoEntry = session.history.undoStack.at(-1);
    if (undoEntry) {
      undoEntry.expectedUndoRevision = currentRevision;
    }
    const redoEntry = session.history.redoStack.at(-1);
    if (redoEntry) {
      redoEntry.expectedRedoRevision = currentRevision;
    }
  }

  private normalizeHistoryAwarePatches(document: CanvasDocument, patches: CanvasPatch[]): CanvasPatch[] {
    return patches.map((patch) => {
      if (patch.op !== "node.duplicate") {
        return patch;
      }
      return ensureDuplicatePatchIds(document, patch);
    });
  }

  private recordHistoryEntry(
    session: CanvasSession,
    beforeDocument: CanvasDocument,
    patches: CanvasPatch[],
    beforeSelection: CanvasSession["editorSelection"],
    beforeViewport: CanvasEditorViewportState,
    appliedRevision: number,
    source: PreviewSyncSource
  ): void {
    const entry = buildCanvasHistoryEntry(beforeDocument, patches, {
      beforeSelection,
      beforeViewport,
      afterSelection: cloneEditorSelection(session.editorSelection),
      afterViewport: cloneEditorViewport(session.editorViewport),
      appliedRevision,
      source
    });
    if (!entry) {
      this.resetHistory(session);
      return;
    }
    session.history.undoStack.push(entry);
    if (session.history.undoStack.length > session.history.depthLimit) {
      session.history.undoStack.shift();
    }
    session.history.redoStack = [];
    this.syncHistoryStackHeads(session);
  }

  private async applyHistoryDirection(
    params: CanvasCommandParams,
    direction: CanvasHistoryDirection
  ): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    if (session.planStatus !== "accepted") {
      throw this.planRequired(direction === "undo" ? "canvas.history.undo" : "canvas.history.redo", session);
    }
    const stack = direction === "undo" ? session.history.undoStack : session.history.redoStack;
    if (stack.length === 0) {
      return {
        ok: false,
        direction,
        reason: "history_empty",
        summary: this.buildSessionSummary(session)
      };
    }
    if (this.isHistoryStale(session)) {
      this.resetHistory(session);
      this.pushFeedback(session, {
        category: "validation",
        class: "history-invalidated",
        severity: "warning",
        message: "Canvas history was invalidated because the document revision changed outside the recorded patch stack.",
        pageId: session.editorSelection.pageId,
        prototypeId: null,
        targetId: session.editorSelection.targetId,
        evidenceRefs: [],
        details: { direction }
      });
      await this.syncLiveViews(session, { refreshPreviewTargets: true, source: "editor" });
      return {
        ok: false,
        direction,
        reason: "history_invalidated",
        summary: this.buildSessionSummary(session)
      };
    }

    const entry = stack.pop() as CanvasHistoryEntry;
    const nextSelection = direction === "undo"
      ? cloneEditorSelection(entry.beforeSelection)
      : cloneEditorSelection(entry.afterSelection);
    const nextViewport = direction === "undo"
      ? cloneEditorViewport(entry.beforeViewport)
      : cloneEditorViewport(entry.afterViewport);
    session.editorSelection = nextSelection;
    session.editorViewport = nextViewport;
    const result = await this.applyDocumentPatches(
      session,
      session.store.getRevision(),
      direction === "undo" ? entry.inversePatches : entry.forwardPatches,
      "editor"
    );
    if (direction === "undo") {
      entry.expectedRedoRevision = result.appliedRevision;
      session.history.redoStack.push(entry);
    } else {
      entry.expectedUndoRevision = result.appliedRevision;
      entry.expectedRedoRevision = null;
      session.history.undoStack.push(entry);
    }
    this.syncHistoryStackHeads(session);
    this.pushFeedback(session, {
      category: "validation",
      class: direction === "undo" ? "history-undone" : "history-redone",
      severity: "info",
      message: direction === "undo" ? "Applied canvas undo." : "Applied canvas redo.",
      pageId: session.editorSelection.pageId,
      prototypeId: null,
      targetId: session.editorSelection.targetId,
      evidenceRefs: [],
      details: {
        direction,
        entryId: entry.id
      }
    });
    return {
      ok: true,
      direction,
      documentRevision: result.appliedRevision,
      summary: this.buildSessionSummary(session)
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
      selection: session.editorSelection,
      viewport: session.editorViewport
    }).catch(() => {});
  }

  private async syncOverlays(session: CanvasSession): Promise<void> {
    if (!session.browserSessionId || session.overlayMounts.size === 0) {
      return;
    }
    const status = await this.browserManager.status(session.browserSessionId);
    for (const mount of session.overlayMounts.values()) {
      if (this.usesCanvasRelayOverlay(session, mount.targetId, status.mode)) {
        await this.requestCanvasExtension(session, "canvas.overlay.sync", {
          mountId: mount.mountId,
          targetId: mount.targetId,
          selection: session.editorSelection
        }).catch(() => {});
        continue;
      }
      if (status.mode === "extension" && this.supportsOpsOverlayTransport(session) && typeof this.browserManager.syncCanvasOverlay === "function") {
        await this.browserManager.syncCanvasOverlay(session.browserSessionId, mount.targetId, {
          mountId: mount.mountId,
          title: session.store.getDocument().title,
          selection: this.buildOverlaySelection(session, mount.targetId)
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
    session.usesCanvasRelay = true;
    const client = await this.ensureCanvasClient();
    return await client.request<ExtensionOverlayResult>(command, payload, session.canvasSessionId, 30000, session.leaseId);
  }

  private usesCanvasRelayOverlay(
    session: CanvasSession,
    targetId: string,
    mode: string
  ): boolean {
    return mode === "extension" && session.designTabTargetId === targetId;
  }

  private supportsOpsOverlayTransport(session: CanvasSession): boolean {
    if (!session.browserSessionId) {
      return false;
    }
    const supports = (this.browserManager as {
      supportsOpsOverlayTransport?: (sessionId: string) => boolean;
    }).supportsOpsOverlayTransport;
    return typeof supports === "function" ? supports.call(this.browserManager, session.browserSessionId) : true;
  }

  private hasLiveOpsDesignTabTransport(session: CanvasSession): boolean {
    return this.supportsOpsOverlayTransport(session) && (this.relay?.status().opsConnected ?? false);
  }

  private buildOverlaySelection(session: CanvasSession, targetId: string): BrowserCanvasOverlaySelection {
    const updatedAt = typeof session.editorSelection.updatedAt === "string"
      ? session.editorSelection.updatedAt
      : undefined;
    return {
      pageId: session.editorSelection.pageId,
      nodeId: session.editorSelection.nodeId,
      targetId,
      ...(updatedAt ? { updatedAt } : {})
    };
  }

  private async recoverCanvasDesignTabClose(
    session: CanvasSession,
    targetId: string,
    detail: string
  ): Promise<boolean> {
    if (!isCanvasRelaySessionLookupError(detail) || !session.browserSessionId) {
      return false;
    }
    const listTargets = (this.browserManager as { listTargets?: (sessionId: string, includeUrls?: boolean) => Promise<{ targets: Array<{ targetId: string }> }> }).listTargets;
    if (typeof listTargets === "function") {
      try {
        const listed = await listTargets.call(this.browserManager, session.browserSessionId, true);
        if (!listed.targets.some((target) => target.targetId === targetId)) {
          return true;
        }
      } catch (error) {
        if (isIgnorableCanvasSessionCloseError(error)) {
          return false;
        }
        if (isAlreadyClosedCanvasTargetError(error)) {
          return true;
        }
        throw error;
      }
    }
    try {
      await this.browserManager.closeTarget(session.browserSessionId, targetId);
      return true;
    } catch (error) {
      if (isIgnorableCanvasSessionCloseError(error)) {
        return false;
      }
      if (isAlreadyClosedCanvasTargetError(error)) {
        return true;
      }
      throw error;
    }
  }

  private disconnectCanvasClientIfIdle(): void {
    if (!this.canvasClient) {
      return;
    }
    if (this.canvasClient.hasPendingRequests()) {
      return;
    }
    const relayStillNeeded = [...this.sessions.values()].some((session) => (
      session.usesCanvasRelay
      && session.designTabTargetId !== null
    ));
    if (relayStillNeeded) {
      return;
    }
    this.canvasClient.disconnect();
    this.canvasClient = null;
    this.canvasEndpoint = null;
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
    if (typeof event.canvasSessionId !== "string") {
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
    if (event.event === "canvas_target_closed") {
      const targetId = optionalString(payload.targetId);
      if (targetId) {
        if (session.designTabTargetId === targetId) {
          session.designTabTargetId = null;
        }
        session.activeTargets.delete(targetId);
        for (const [mountId, mount] of session.overlayMounts.entries()) {
          if (mount.targetId === targetId) {
            session.overlayMounts.delete(mountId);
          }
        }
        this.disconnectCanvasClientIfIdle();
      }
      return;
    }
    if (event.event === "canvas_session_closed" || event.event === "canvas_session_expired") {
      this.completeFeedbackSubscriptions(session, event.event === "canvas_session_closed" ? "session_closed" : "document_unloaded");
      this.sessionSyncManager.removeSession(session.canvasSessionId);
      this.codeSyncManager.disposeSession(session.canvasSessionId);
      this.sessions.delete(session.canvasSessionId);
      this.disconnectCanvasClientIfIdle();
      return;
    }
    if (event.event === "canvas_history_requested") {
      const direction = optionalString(payload.direction);
      if (direction === "undo" || direction === "redo") {
        await this.applyHistoryDirection({
          canvasSessionId: session.canvasSessionId,
          leaseId: session.leaseId
        }, direction);
      }
      return;
    }
    if (event.event !== "canvas_patch_requested") {
      return;
    }
    const baseRevision = requireNumber(payload.baseRevision, "baseRevision");
    const patches = requirePatches(payload.patches);
    const beforeSelection = cloneEditorSelection(session.editorSelection);
    const beforeViewport = cloneEditorViewport(session.editorViewport);
    if (isRecord(payload.selection)) {
      session.editorSelection = {
        pageId: optionalString(payload.selection.pageId) ?? session.editorSelection.pageId,
        nodeId: optionalString(payload.selection.nodeId),
        targetId: optionalString(payload.selection.targetId),
        updatedAt: new Date().toISOString()
      };
    }
    if (isRecord(payload.viewport)) {
      session.editorViewport = {
        x: typeof payload.viewport.x === "number" ? payload.viewport.x : session.editorViewport.x,
        y: typeof payload.viewport.y === "number" ? payload.viewport.y : session.editorViewport.y,
        zoom: typeof payload.viewport.zoom === "number" ? payload.viewport.zoom : session.editorViewport.zoom
      };
    }
    try {
      await this.applyDocumentPatches(session, baseRevision, patches, "editor", {
        recordHistory: true,
        beforeSelection,
        beforeViewport
      });
    } catch (error) {
      session.editorSelection = beforeSelection;
      session.editorViewport = beforeViewport;
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
    return await this.browserManager.withPage(sessionId, targetId, async (page: Page) => {
      return await this.evaluateDirectOverlay(page, ({ title, prototype, targetId: pageTargetId, overlayRootId, overlayStyleId, overlayStyle }) => {
        const ensureStyle = () => {
          if (document.getElementById(overlayStyleId)) {
            return;
          }
          const style = document.createElement("style");
          style.id = overlayStyleId;
          style.textContent = overlayStyle;
          document.body.append(style);
        };
        const buildRoot = () => {
          const root = document.createElement("div");
          root.id = overlayRootId;
          const heading = document.createElement("strong");
          heading.textContent = "OpenDevBrowser Canvas";
          const titleDetail = document.createElement("div");
          titleDetail.textContent = title;
          const prototypeDetail = document.createElement("div");
          prototypeDetail.textContent = prototype;
          root.append(heading, titleDetail, prototypeDetail);
          return root;
        };
        ensureStyle();
        const existing = document.getElementById(overlayRootId);
        if (existing) existing.remove();
        const root = buildRoot();
        document.body.append(root);
        return {
          mountId: `mount_${typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`,
          targetId: pageTargetId,
          previewState: "background",
          overlayState: "mounted",
          capabilities: { selection: true, guides: true }
        };
      }, {
        title: canvasDocument.title,
        prototype: prototypeId,
        targetId,
        overlayRootId: DIRECT_OVERLAY_ROOT_ID,
        overlayStyleId: DIRECT_OVERLAY_STYLE_ID,
        overlayStyle: DIRECT_OVERLAY_STYLE
      });
    }) as ExtensionOverlayResult;
  }

  private async unmountDirectOverlay(sessionId: string, targetId: string, mountId?: string): Promise<void> {
    await this.browserManager.withPage(sessionId, targetId, async (page: Page) => {
      await this.evaluateDirectOverlay(page, ({ mountId: overlayMountId, overlayRootId, overlayStyleId }) => {
        if (overlayMountId) {
          document.getElementById(overlayMountId)?.remove();
        }
        document.getElementById(overlayRootId)?.remove();
        document.getElementById(overlayStyleId)?.remove();
        document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
          element.classList.remove("opendevbrowser-canvas-highlight");
        });
      }, {
        mountId,
        overlayRootId: DIRECT_OVERLAY_ROOT_ID,
        overlayStyleId: DIRECT_OVERLAY_STYLE_ID
      });
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
    await this.browserManager.withPage(sessionId, targetId, async (page: Page) => {
      await this.evaluateDirectOverlay(page, (input) => {
        const ensureStyle = () => {
          if (document.getElementById(input.overlayStyleId)) {
            return;
          }
          const style = document.createElement("style");
          style.id = input.overlayStyleId;
          style.textContent = input.overlayStyle;
          document.body.append(style);
        };
        const buildRoot = () => {
          const root = document.createElement("div");
          root.id = input.overlayRootId;
          const heading = document.createElement("strong");
          const titleDetail = document.createElement("div");
          const selectionDetail = document.createElement("div");
          root.append(heading, titleDetail, selectionDetail);
          return root;
        };
        ensureStyle();
        let root = input.mountId
          ? document.getElementById(input.mountId) ?? document.getElementById(input.overlayRootId)
          : document.getElementById(input.overlayRootId);
        if (!(root instanceof HTMLElement)) {
          root = buildRoot();
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
      }, {
        mountId,
        title,
        selection,
        overlayRootId: DIRECT_OVERLAY_ROOT_ID,
        overlayStyleId: DIRECT_OVERLAY_STYLE_ID,
        overlayStyle: DIRECT_OVERLAY_STYLE
      });
      return null;
    });
  }

  private async selectDirectOverlay(
    sessionId: string,
    targetId: string,
    nodeId: string | null,
    selectionHint: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return await this.browserManager.withPage(sessionId, targetId, async (page: Page) => {
      return await this.evaluateDirectOverlay(page, (input) => {
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
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
          id: element.id || null,
          /* c8 ignore next -- the highlight class is always added immediately above */
          className: element.className || null
        };
      }, { nodeId, selectionHint });
    }) as Record<string, unknown>;
  }

  private async evaluateDirectOverlay<TArg, TResult>(
    page: Page,
    pageFunction: (arg: TArg) => TResult | Promise<TResult>,
    arg: TArg
  ): Promise<TResult> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      const timed = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("DIRECT_OVERLAY_EVAL_TIMEOUT")), DIRECT_OVERLAY_EVAL_TIMEOUT_MS);
        timeoutHandle.unref?.();
      });
      const result = await Promise.race([
        page.evaluate(pageFunction as never, arg as never) as Promise<TResult>,
        timed
      ]);
      return result;
    } catch (error) {
      if (!this.isDirectOverlayEvalFallbackError(error)) {
        throw error;
      }
      return await this.evaluateDirectOverlayViaCdp(page, pageFunction, arg);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async evaluateDirectOverlayViaCdp<TArg, TResult>(
    page: Page,
    pageFunction: (arg: TArg) => TResult | Promise<TResult>,
    arg: TArg
  ): Promise<TResult> {
    const session = await page.context().newCDPSession(page);
    try {
      const result = await session.send("Runtime.evaluate", {
        expression: `(${pageFunction.toString()})(${JSON.stringify(arg)})`,
        awaitPromise: true,
        returnByValue: true
      }) as {
        result?: { value?: TResult };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      const detail = result.exceptionDetails;
      if (detail) {
        throw new Error(detail.exception?.description ?? detail.text ?? "Direct overlay Runtime.evaluate failed.");
      }
      return result.result?.value as TResult;
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  private isDirectOverlayEvalFallbackError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("DIRECT_OVERLAY_EVAL_TIMEOUT");
  }
}

function requireCanvasPage(document: CanvasDocument, pageId: string): CanvasPage {
  const page = document.pages.find((entry) => entry.id === pageId);
  if (!page) {
    throw new Error(`Unknown page: ${pageId}`);
  }
  return page;
}

function findNodeInPage(page: CanvasPage, nodeId: string): CanvasNode {
  const node = page.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new Error(`Unknown node: ${nodeId}`);
  }
  return node;
}

function getAvailableInventory(document: CanvasDocument): CanvasComponentInventoryItem[] {
  const byId = new Map<string, CanvasComponentInventoryItem>();
  for (const item of listBuiltInCanvasInventoryItems()) {
    byId.set(item.id, item);
  }
  for (const item of document.componentInventory) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function requireInventoryItem(items: CanvasComponentInventoryItem[], itemId: string): CanvasComponentInventoryItem {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) {
    throw new Error(`Unknown inventory item: ${itemId}`);
  }
  return item;
}

function readInsertPlacement(params: CanvasCommandParams): { x?: number; y?: number } {
  const x = typeof params.x === "number" && Number.isFinite(params.x) ? params.x : undefined;
  const y = typeof params.y === "number" && Number.isFinite(params.y) ? params.y : undefined;
  return { x, y };
}

type InventoryTemplateNode = {
  id: string;
  kind: CanvasNode["kind"];
  name: string;
  parentId: string | null;
  childIds: string[];
  rect: CanvasRect;
  props: Record<string, unknown>;
  style: Record<string, unknown>;
  tokenRefs: Record<string, unknown>;
  variantPatches: CanvasNode["variantPatches"];
  metadata: Record<string, unknown>;
};

function materializeInventoryItem(
  item: CanvasComponentInventoryItem,
  pageId: string,
  parentId: string | null,
  placement: { x?: number; y?: number }
): { patches: CanvasPatch[]; insertedNodeIds: string[]; rootNodeId: string } {
  const template = readInventoryTemplate(item);
  const idMap = new Map(template.nodes.map((node) => [node.id, `node_inventory_${randomUUID().slice(0, 8)}`]));
  const root = template.nodes.find((node) => node.id === template.rootNodeId) ?? template.nodes[0]!;
  const offsetX = (placement.x ?? root.rect.x) - root.rect.x;
  const offsetY = (placement.y ?? root.rect.y) - root.rect.y;
  const patches: CanvasPatch[] = [];
  for (const node of template.nodes) {
    const nextId = idMap.get(node.id) as string;
    const nextParentId = node.id === template.rootNodeId
      ? parentId
      : node.parentId
        ? idMap.get(node.parentId) ?? null
        : null;
    patches.push({
      op: "node.insert",
      pageId,
      parentId: nextParentId,
      node: {
        id: nextId,
        kind: node.kind,
        name: node.id === template.rootNodeId ? item.name : node.name,
        rect: {
          x: Math.round(node.rect.x + offsetX),
          y: Math.round(node.rect.y + offsetY),
          width: node.rect.width,
          height: node.rect.height
        },
        props: structuredClone(node.props),
        style: structuredClone(node.style),
        tokenRefs: structuredClone(node.tokenRefs),
        bindingRefs: {},
        variantPatches: structuredClone(node.variantPatches),
        metadata: {
          ...structuredClone(node.metadata),
          inventory: {
            itemId: item.id,
            origin: item.origin
          }
        }
      }
    });
  }
  const rootNodeId = idMap.get(template.rootNodeId);
  if (!rootNodeId) {
    throw new Error(`Inventory template is missing root node: ${item.id}`);
  }
  return {
    patches,
    insertedNodeIds: [...idMap.values()],
    rootNodeId
  };
}

function readInventoryTemplate(item: CanvasComponentInventoryItem): { rootNodeId: string; nodes: InventoryTemplateNode[] } {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const template = isRecord(metadata.template) ? metadata.template : null;
  if (template) {
    const rootNodeId = optionalString(template.rootNodeId) ?? null;
    const nodes = Array.isArray(template.nodes)
      ? template.nodes
        .map((entry) => normalizeInventoryTemplateNode(entry))
        .filter((entry): entry is InventoryTemplateNode => entry !== null)
      : [];
    if (rootNodeId && nodes.length > 0) {
      return { rootNodeId, nodes };
    }
  }
  return {
    rootNodeId: item.id,
    nodes: [{
      id: item.id,
      kind: "component-instance",
      name: item.name,
      parentId: null,
      childIds: [],
      rect: { x: 96, y: 96, width: 320, height: 180 },
      props: defaultInventoryNodeProps(item),
      style: {},
      tokenRefs: {},
      variantPatches: [],
      metadata: {
        inventory: {
          itemId: item.id,
          origin: item.origin
        }
      }
    }]
  };
}

function normalizeInventoryTemplateNode(value: unknown): InventoryTemplateNode | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id);
  const kind = optionalString(value.kind);
  if (!id || !kind) {
    return null;
  }
  return {
    id,
    kind: kind as CanvasNode["kind"],
    name: optionalString(value.name) ?? id,
    parentId: optionalString(value.parentId),
    childIds: Array.isArray(value.childIds)
      ? value.childIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    rect: normalizeInventoryRect(value.rect),
    props: isRecord(value.props) ? structuredClone(value.props) : {},
    style: isRecord(value.style) ? structuredClone(value.style) : {},
    tokenRefs: isRecord(value.tokenRefs) ? structuredClone(value.tokenRefs) : {},
    variantPatches: Array.isArray(value.variantPatches)
      ? value.variantPatches
        .filter((entry): entry is CanvasNode["variantPatches"][number] => isRecord(entry))
        .map((entry) => structuredClone(entry))
      : [],
    metadata: isRecord(value.metadata) ? structuredClone(value.metadata) : {}
  };
}

function normalizeInventoryRect(value: unknown): CanvasRect {
  const rect = isRecord(value) ? value : {};
  return {
    x: typeof rect.x === "number" && Number.isFinite(rect.x) ? rect.x : 96,
    y: typeof rect.y === "number" && Number.isFinite(rect.y) ? rect.y : 96,
    width: typeof rect.width === "number" && Number.isFinite(rect.width) ? rect.width : 320,
    height: typeof rect.height === "number" && Number.isFinite(rect.height) ? rect.height : 180
  };
}

function defaultInventoryNodeProps(item: CanvasComponentInventoryItem): Record<string, unknown> {
  const defaults = Object.fromEntries(
    item.props
      .filter((entry) => entry.defaultValue !== undefined)
      .map((entry) => [entry.name, structuredClone(entry.defaultValue)])
  );
  if (!("text" in defaults) && item.content.acceptsText) {
    defaults.text = item.name;
  }
  return defaults;
}

type BuiltInCanvasStarterDefinition = NonNullable<ReturnType<typeof getBuiltInCanvasStarterDefinition>>;
type StarterInventoryUpsertPatch = Extract<CanvasPatch, { op: "inventory.upsert" }>;

function resolveStarterFramework(
  document: CanvasDocument,
  starter: CanvasStarterTemplate,
  requestedFrameworkId: string | null
): { frameworkId: string; reason: string | null } {
  const compatible = new Set(starter.compatibleFrameworkIds.map((entry) => canonicalizeStarterFrameworkId(entry)));
  const requested = requestedFrameworkId ? canonicalizeStarterFrameworkId(requestedFrameworkId) : null;
  if (requested) {
    return compatible.has(requested)
      ? { frameworkId: requested, reason: null }
      : { frameworkId: requested, reason: `framework_unavailable:${requested}` };
  }
  const inferred = getFrameworkIds(document)
    .map((entry) => canonicalizeStarterFrameworkId(entry))
    .find((entry) => compatible.has(entry));
  return {
    frameworkId: inferred ?? canonicalizeStarterFrameworkId(starter.defaultFrameworkId),
    reason: null
  };
}

function resolveStarterAdapter(
  kitIds: string[],
  requestedAdapterId: string | null
): { adapterId: string | null; reason: string | null } {
  const entries = getStarterKitEntries(kitIds);
  const common = entries.reduce<string[] | null>((current, entry) => {
    if (current === null) {
      return [...entry.defaultLibraryAdapterIds];
    }
    return current.filter((adapterId) => entry.defaultLibraryAdapterIds.includes(adapterId));
  }, null);
  if (requestedAdapterId) {
    if (entries.length === 0 || entries.every((entry) => entry.defaultLibraryAdapterIds.includes(requestedAdapterId))) {
      return { adapterId: requestedAdapterId, reason: null };
    }
    return { adapterId: common?.[0] ?? null, reason: `adapter_unavailable:${requestedAdapterId}` };
  }
  if (entries.length === 0) {
    return { adapterId: null, reason: null };
  }
  if (common && common.length > 0) {
    return { adapterId: common[0] ?? null, reason: null };
  }
  return { adapterId: null, reason: "adapter_unavailable" };
}

function buildStarterTokenMergePatch(kitIds: string[]): CanvasPatch | null {
  const collections = getStarterKitEntries(kitIds).flatMap((entry) => entry.tokenCollections.map((collection) => structuredClone(collection)));
  if (collections.length === 0) {
    return null;
  }
  return {
    op: "tokens.merge",
    tokens: {
      collections,
      metadata: {
        starterKitIds: [...kitIds]
      }
    }
  };
}

function buildStarterInventoryUpsertPatches(
  kitIds: string[],
  frameworkId: string,
  adapterId: string | null
): StarterInventoryUpsertPatch[] {
  return listStarterKitInventoryItems(kitIds, frameworkId, adapterId).map((item) => ({
    op: "inventory.upsert" as const,
    item
  }));
}

function buildStarterShell(
  definition: BuiltInCanvasStarterDefinition,
  pageId: string,
  parentId: string | null,
  placement: { x?: number; y?: number }
): {
  patches: CanvasPatch[];
  insertedNodeIds: string[];
  rect: CanvasRect;
  rootNodeId: string;
} {
  const rootNodeId = `node_starter_${randomUUID().slice(0, 8)}`;
  const eyebrowNodeId = `node_starter_${randomUUID().slice(0, 8)}`;
  const headlineNodeId = `node_starter_${randomUUID().slice(0, 8)}`;
  const bodyNodeId = `node_starter_${randomUUID().slice(0, 8)}`;
  const actionNodeId = definition.shell.actionLabel ? `node_starter_${randomUUID().slice(0, 8)}` : null;
  const rect = {
    ...definition.shell.rect,
    x: placement.x ?? definition.shell.rect.x,
    y: placement.y ?? definition.shell.rect.y
  };
  const patches: CanvasPatch[] = [{
    op: "node.insert",
    pageId,
    parentId,
    node: {
      id: rootNodeId,
      kind: "frame",
      name: definition.shell.shellName,
      rect,
      props: {},
      style: {
        backgroundColor: "#f8fafc",
        borderRadius: 28,
        borderColor: "#e2e8f0",
        borderWidth: 1,
        padding: 32
      },
      tokenRefs: {},
      bindingRefs: {},
      metadata: {
        starter: {
          id: definition.template.id,
          role: "shell"
        }
      }
    }
  }];
  const insertedNodeIds = [rootNodeId];
  let nextY = rect.y + 40;
  if (definition.shell.eyebrow) {
    patches.push({
      op: "node.insert",
      pageId,
      parentId: rootNodeId,
      node: {
        id: eyebrowNodeId,
        kind: "text",
        name: `${definition.template.name} Eyebrow`,
        rect: { x: rect.x + 32, y: nextY, width: Math.min(rect.width - 64, 420), height: 22 },
        props: { text: definition.shell.eyebrow },
        style: { color: "#0f766e", fontSize: 14, fontWeight: 700 },
        tokenRefs: {},
        bindingRefs: {},
        metadata: {
          starter: { id: definition.template.id, role: "eyebrow" }
        }
      }
    });
    insertedNodeIds.push(eyebrowNodeId);
    nextY += 36;
  }
  patches.push({
    op: "node.insert",
    pageId,
    parentId: rootNodeId,
    node: {
      id: headlineNodeId,
      kind: "text",
      name: `${definition.template.name} Headline`,
      rect: { x: rect.x + 32, y: nextY, width: Math.min(rect.width - 64, 720), height: 108 },
      props: { text: definition.shell.headline },
      style: { color: "#0f172a", fontSize: 42, fontWeight: 700 },
      tokenRefs: {},
      bindingRefs: {},
      metadata: {
        starter: { id: definition.template.id, role: "headline" }
      }
    }
  });
  insertedNodeIds.push(headlineNodeId);
  nextY += 120;
  patches.push({
    op: "node.insert",
    pageId,
    parentId: rootNodeId,
    node: {
      id: bodyNodeId,
      kind: "text",
      name: `${definition.template.name} Body`,
      rect: { x: rect.x + 32, y: nextY, width: Math.min(rect.width - 64, 760), height: 72 },
      props: { text: definition.shell.body },
      style: { color: "#334155", fontSize: 16, fontWeight: 500 },
      tokenRefs: {},
      bindingRefs: {},
      metadata: {
        starter: { id: definition.template.id, role: "body" }
      }
    }
  });
  insertedNodeIds.push(bodyNodeId);
  if (actionNodeId && definition.shell.actionLabel) {
    patches.push({
      op: "node.insert",
      pageId,
      parentId: rootNodeId,
      node: {
        id: actionNodeId,
        kind: "note",
        name: `${definition.template.name} Action`,
        rect: { x: rect.x + 32, y: nextY + 92, width: 220, height: 48 },
        props: { text: definition.shell.actionLabel },
        style: { backgroundColor: "#e2e8f0", borderRadius: 999 },
        tokenRefs: {},
        bindingRefs: {},
        metadata: {
          starter: { id: definition.template.id, role: "action" }
        }
      }
    });
    insertedNodeIds.push(actionNodeId);
  }
  return { patches, insertedNodeIds, rect, rootNodeId };
}

function buildStarterMaterialization(
  definition: BuiltInCanvasStarterDefinition,
  frameworkId: string,
  adapterId: string | null,
  pageId: string,
  parentId: string,
  shellRect: CanvasRect
): {
  patches: CanvasPatch[];
  insertedNodeIds: string[];
  itemIds: string[];
  rootNodeId: string;
} {
  const itemsById = new Map(
    listStarterKitInventoryItems(definition.template.kitIds, frameworkId, adapterId).map((item) => [item.id, item])
  );
  const patches: CanvasPatch[] = [];
  const insertedNodeIds: string[] = [];
  const itemIds: string[] = [];
  for (const insertion of definition.insertions) {
    const item = itemsById.get(insertion.itemId);
    if (!item) {
      continue;
    }
    const materialized = materializeInventoryItem(item, pageId, parentId, {
      x: shellRect.x + insertion.x,
      y: shellRect.y + insertion.y
    });
    patches.push(...materialized.patches);
    insertedNodeIds.push(...materialized.insertedNodeIds);
    itemIds.push(item.id);
  }
  return {
    patches,
    insertedNodeIds,
    itemIds,
    rootNodeId: parentId
  };
}

function listStarterKitInventoryItems(
  kitIds: string[],
  frameworkId: string,
  adapterId: string | null
): CanvasComponentInventoryItem[] {
  return getStarterKitEntries(kitIds).flatMap((entry) =>
    entry.items.map((item) => adaptStarterInventoryItem(item, entry, frameworkId, adapterId))
  );
}

function adaptStarterInventoryItem(
  item: CanvasComponentInventoryItem,
  kit: { id: string; defaultFrameworkId: string; compatibleFrameworkIds: string[]; defaultLibraryAdapterIds: string[]; metadata: Record<string, unknown> },
  frameworkId: string,
  adapterId: string | null
): CanvasComponentInventoryItem {
  const next = structuredClone(item);
  const resolvedAdapterId = adapterId ?? next.adapter?.id ?? kit.defaultLibraryAdapterIds[0] ?? null;
  next.framework = {
    id: frameworkId,
    label: labelForStarterFramework(frameworkId),
    packageName: packageNameForStarterFramework(frameworkId),
    adapter: resolvedAdapterId
      ? {
        id: resolvedAdapterId,
        label: labelForStarterAdapter(resolvedAdapterId),
        packageName: packageNameForStarterAdapter(resolvedAdapterId),
        metadata: {}
      }
      : null,
    metadata: {
      ...structuredClone(next.framework?.metadata ?? {}),
      catalogKitId: kit.id
    }
  };
  if (resolvedAdapterId) {
    next.adapter = {
      id: resolvedAdapterId,
      label: labelForStarterAdapter(resolvedAdapterId),
      packageName: packageNameForStarterAdapter(resolvedAdapterId),
      metadata: structuredClone(next.adapter?.metadata ?? {})
    };
  }
  next.metadata = {
    ...structuredClone(next.metadata),
    starter: {
      appliedFrameworkId: frameworkId,
      compatibleFrameworkIds: [...kit.compatibleFrameworkIds]
    }
  };
  return next;
}

function getStarterKitEntries(kitIds: string[]): typeof BUILT_IN_CANVAS_KITS[number][] {
  const ordered = new Map(BUILT_IN_CANVAS_KITS.map((entry) => [entry.id, entry]));
  return kitIds.flatMap((kitId) => {
    const match = ordered.get(kitId);
    return match ? [match] : [];
  });
}

function canonicalizeStarterFrameworkId(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "react-tsx":
      return "react";
    case "next":
    case "next.js":
      return "nextjs";
    default:
      return value.trim().toLowerCase();
  }
}

function labelForStarterFramework(frameworkId: string): string {
  switch (frameworkId) {
    case "nextjs":
      return "Next.js";
    case "remix":
      return "Remix";
    case "astro":
      return "Astro";
    case "react":
      return "React";
    default:
      return frameworkId;
  }
}

function packageNameForStarterFramework(frameworkId: string): string | null {
  switch (frameworkId) {
    case "nextjs":
      return "next";
    case "remix":
      return "@remix-run/react";
    case "astro":
      return "astro";
    case "react":
      return "react";
    default:
      return null;
  }
}

function labelForStarterAdapter(adapterId: string): string {
  switch (adapterId) {
    case "builtin:react-tsx-v2":
      return "React TSX v2";
    case "tsx-react-v1":
      return "TSX React v1";
    default:
      return adapterId;
  }
}

function packageNameForStarterAdapter(adapterId: string): string | null {
  switch (adapterId) {
    case "builtin:react-tsx-v2":
      return "@opendevbrowser/react-tsx-v2";
    case "tsx-react-v1":
      return "@opendevbrowser/tsx-react-v1";
    default:
      return null;
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

function requireCodeSyncBinding(
  document: CanvasDocument,
  bindingId: string
): CanvasBinding & { codeSync: NonNullable<CanvasBinding["codeSync"]> } {
  const binding = requireCanvasBinding(document, bindingId);
  if (!binding.codeSync) {
    throw attachDetails(new Error(`Binding ${bindingId} is not configured for code sync.`), {
      code: "code_sync_required",
      details: { bindingId }
    });
  }
  return binding as CanvasBinding & { codeSync: NonNullable<CanvasBinding["codeSync"]> };
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
  const repoPath = requireString(params.repoPath, "repoPath");
  const requestedAdapterId = optionalString(params.frameworkAdapterId) ?? optionalString(params.adapterId);
  const frameworkAdapterId = requestedAdapterId ?? inferBuiltInFrameworkAdapterIdFromPath(repoPath);
  const exportName = optionalString(params.exportName) ?? undefined;
  const selector = optionalString(params.selector) ?? undefined;
  const identity = normalizeFrameworkAdapterIdentity({
    adapter: frameworkAdapterId,
    frameworkAdapterId,
    repoPath
  });
  const declaredCapabilities = Array.isArray(params.declaredCapabilities)
    ? params.declaredCapabilities.filter((entry): entry is CodeSyncCapability => isCodeSyncCapability(entry))
    : [];
  const grantedCapabilities = Array.isArray(params.grantedCapabilities)
    ? params.grantedCapabilities
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => normalizeCodeSyncCapabilityGrant(entry))
      .filter((entry): entry is CodeSyncCapabilityGrant => Boolean(entry))
    : [];
  return {
    id: bindingId,
    nodeId,
    kind: "code-sync",
    selector: optionalString(params.selector) ?? undefined,
      componentName: optionalString(params.componentName) ?? undefined,
      metadata: {},
      codeSync: {
        adapter: identity.adapter,
        frameworkAdapterId: identity.frameworkAdapterId,
        frameworkId: identity.frameworkId,
        sourceFamily: identity.sourceFamily,
        adapterKind: identity.adapterKind,
        adapterVersion: identity.adapterVersion,
        repoPath,
        rootLocator: normalizeCodeSyncRootLocator(undefined, {
          sourceFamily: identity.sourceFamily,
          exportName,
          selector
        }),
        exportName,
        selector,
        syncMode: (optionalString(params.syncMode) as "manual" | "watch" | null) ?? "manual",
        ownership,
        route: optionalString(params.route) ?? undefined,
        verificationTarget: optionalString(params.verificationTarget) ?? undefined,
        runtimeRootSelector: optionalString(params.runtimeRootSelector) ?? undefined,
        projection: (optionalString(params.projection) as "canvas_html" | "bound_app_runtime" | null) ?? "canvas_html",
        libraryAdapterIds: Array.isArray(params.libraryAdapterIds)
          ? params.libraryAdapterIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          : [],
        declaredCapabilities,
        grantedCapabilities,
        manifestVersion: 2,
        reasonCode: identity.reasonCode
      }
    };
  }

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, name: string): number {
  const parsed = requireNumber(value, name);
  if (parsed < 1) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requireCanvasSessionMode(value: unknown): CanvasSessionMode {
  switch (value) {
    case undefined:
    case null:
      return "dual-track";
    case "low-fi-wireframe":
    case "high-fi-live-edit":
    case "dual-track":
    case "document-only":
      return value;
    default:
      throw new Error(`Invalid mode: ${String(value)}`);
  }
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

function readImportMode(value: unknown): CanvasDocumentImportMode | undefined {
  switch (value) {
    case undefined:
    case null:
      return undefined;
    case "replace_current_page":
    case "append_pages":
    case "components_only":
      return value;
    default:
      throw new Error(`Invalid import mode: ${String(value)}`);
  }
}

function readCanvasDocumentImportRequest(params: CanvasCommandParams): CanvasDocumentImportRequest {
  return {
    sourceUrl: optionalString(params.sourceUrl),
    fileKey: optionalString(params.fileKey),
    nodeIds: normalizeStringArray(params.nodeIds),
    mode: readImportMode(params.mode),
    frameworkId: optionalString(params.frameworkId),
    frameworkAdapterId: optionalString(params.frameworkAdapterId),
    includeVariables: typeof params.includeVariables === "boolean" ? params.includeVariables : true,
    depth: typeof params.depth === "number" && Number.isFinite(params.depth) ? params.depth : null,
    geometryPaths: params.geometryPaths === true
  };
}

function buildFigmaImportProvenance(
  request: ReturnType<typeof normalizeFigmaImportRequest>,
  payload: {
    fileName: string | null;
    sourceKind: "file" | "nodes";
    versionId: string | null;
    branchId: string | null;
  },
  assetReceipts: CanvasImportProvenance["assetReceipts"],
  degradedFailureCodes: CanvasImportFailureCode[],
  frameworkMaterialized: boolean
): CanvasImportProvenance {
  const importedAt = new Date().toISOString();
  const source: CanvasImportSource = {
    id: `figma:${request.fileKey}`,
    kind: payload.sourceKind === "nodes" ? "figma.nodes" : "figma.file",
    label: payload.fileName ?? request.fileKey,
    uri: request.sourceUrl,
    sourceDialect: "figma-rest-v1",
    frameworkId: request.frameworkId,
    adapterIds: request.frameworkAdapterId ? [request.frameworkAdapterId] : [],
    metadata: {
      fileKey: request.fileKey,
      nodeIds: [...request.nodeIds],
      versionId: request.versionId ?? payload.versionId,
      branchId: request.branchId ?? payload.branchId
    }
  };
  return {
    id: `canvas-import-${request.fileKey}-${importedAt}`,
    source,
    importedAt,
    assetReceipts,
    metadata: {
      mode: request.mode,
      fileKey: request.fileKey,
      nodeIds: [...request.nodeIds],
      requestedFrameworkId: request.frameworkId,
      requestedFrameworkAdapterId: request.frameworkAdapterId,
      frameworkMaterialized,
      degradedFailureCodes
    }
  };
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
  return sortUniqueStrings(document.componentInventory.flatMap((component) => component.sourceKind ? [component.sourceKind] : []));
}

function getFrameworkIds(document: CanvasDocument): string[] {
  return sortUniqueStrings([
    ...document.componentInventory.flatMap((component) => component.framework?.id ? [component.framework.id] : []),
    ...document.meta.imports.flatMap((entry) => entry.source.frameworkId ? [entry.source.frameworkId] : []),
    ...document.meta.adapterPlugins.flatMap((plugin) => plugin.frameworks.map((entry) => entry.frameworkId)),
    ...document.bindings.flatMap((binding) => {
      const explicit = isRecord(binding.metadata?.framework) ? optionalString(binding.metadata.framework.id) : null;
      if (explicit) {
        return [explicit];
      }
      return binding.codeSync ? ["react"] : [];
    })
  ]);
}

function getPluginIds(document: CanvasDocument): string[] {
  return sortUniqueStrings([
    ...document.componentInventory.flatMap((component) => component.plugin?.id ? [component.plugin.id] : []),
    ...document.meta.imports.flatMap((entry) => entry.source.pluginId ? [entry.source.pluginId] : []),
    ...document.meta.adapterPlugins.map((plugin) => plugin.id),
    ...document.meta.pluginErrors.flatMap((entry) => entry.pluginId ? [entry.pluginId] : [])
  ]);
}

function getInventoryOrigins(document: CanvasDocument): CanvasInventoryOrigin[] {
  return sortUniqueStrings(document.componentInventory.map((component) => component.origin)) as CanvasInventoryOrigin[];
}

function getDeclaredCapabilities(document: CanvasDocument): CanvasAdapterCapability[] {
  return sortUniqueStrings(document.meta.adapterPlugins.flatMap((plugin) => plugin.declaredCapabilities)) as CanvasAdapterCapability[];
}

function getGrantedCapabilities(document: CanvasDocument): CanvasAdapterCapability[] {
  return sortUniqueStrings(
    document.meta.adapterPlugins.flatMap((plugin) =>
      plugin.grantedCapabilities.flatMap((entry) => entry.granted ? [entry.capability] : [])
    )
  ) as CanvasAdapterCapability[];
}

function getCapabilityDenials(document: CanvasDocument): CanvasCapabilityGrant[] {
  return document.meta.adapterPlugins.flatMap((plugin) => plugin.grantedCapabilities.filter((entry) => !entry.granted));
}

function getPluginErrors(document: CanvasDocument): CanvasAdapterErrorEnvelope[] {
  return document.meta.pluginErrors.map((entry) => ({
    ...entry,
    details: { ...entry.details }
  }));
}

function getImportSources(document: CanvasDocument): string[] {
  return sortUniqueStrings(document.meta.imports.map((entry) => entry.source.kind));
}

function getLatestImportedAt(document: CanvasDocument): string | null {
  const importedAtValues = document.meta.imports
    .map((entry) => entry.importedAt)
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .sort((left, right) => left.localeCompare(right));
  return importedAtValues.at(-1) ?? null;
}

function sortUniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function cloneEditorSelection(selection: CanvasSession["editorSelection"]): CanvasSession["editorSelection"] {
  return {
    pageId: selection.pageId,
    nodeId: selection.nodeId,
    targetId: selection.targetId,
    updatedAt: selection.updatedAt
  };
}

function cloneEditorViewport(viewport: CanvasEditorViewportState): CanvasEditorViewportState {
  return {
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom
  };
}

function ensureDuplicatePatchIds(document: CanvasDocument, patch: Extract<CanvasPatch, { op: "node.duplicate" }>): CanvasPatch {
  if (isRecord(patch.idMap) && Object.keys(patch.idMap).length > 0) {
    return patch;
  }
  const subtreeNodeIds = collectSubtreeNodeIds(document, patch.nodeId);
  const idMap = Object.fromEntries(
    subtreeNodeIds.map((nodeId) => [nodeId, `${nodeId}_copy_${randomUUID().slice(0, 8)}`])
  );
  return {
    ...patch,
    idMap
  };
}

function buildCanvasHistoryEntry(
  beforeDocument: CanvasDocument,
  patches: CanvasPatch[],
  options: {
    beforeSelection: CanvasSession["editorSelection"];
    beforeViewport: CanvasEditorViewportState;
    afterSelection: CanvasSession["editorSelection"];
    afterViewport: CanvasEditorViewportState;
    appliedRevision: number;
    source: PreviewSyncSource;
  }
): CanvasHistoryEntry | null {
  const scratchStore = new CanvasDocumentStore(structuredClone(beforeDocument));
  const inversePatches: CanvasPatch[] = [];
  for (const patch of patches) {
    const inverse = buildHistoryInversePatches(scratchStore.getDocument(), patch);
    if (!inverse) {
      return null;
    }
    inversePatches.unshift(...inverse);
    scratchStore.applyPatches(scratchStore.getRevision(), [patch]);
  }
  return {
    id: `history_${randomUUID().slice(0, 8)}`,
    source: options.source,
    createdAt: new Date().toISOString(),
    forwardPatches: structuredClone(patches),
    inversePatches,
    beforeSelection: cloneEditorSelection(options.beforeSelection),
    afterSelection: cloneEditorSelection(options.afterSelection),
    beforeViewport: cloneEditorViewport(options.beforeViewport),
    afterViewport: cloneEditorViewport(options.afterViewport),
    expectedUndoRevision: options.appliedRevision,
    expectedRedoRevision: null
  };
}

function buildHistoryInversePatches(document: CanvasDocument, patch: CanvasPatch): CanvasPatch[] | null {
  switch (patch.op) {
    case "node.insert":
      return [{ op: "node.remove", nodeId: patch.node.id }];
    case "node.update": {
      const node = requireCanvasNode(document, patch.nodeId);
      const changes = Object.fromEntries(
        Object.keys(patch.changes).map((path) => [path, structuredClone(readNestedValue(node as Record<string, unknown>, path))])
      );
      return [{ op: "node.update", nodeId: patch.nodeId, changes }];
    }
    case "node.remove":
      return buildNodeRestorePatches(document, patch.nodeId);
    case "node.reparent": {
      const location = locateCanvasNode(document, patch.nodeId);
      return [{
        op: "node.reparent",
        nodeId: patch.nodeId,
        parentId: location.node.parentId,
        index: location.index
      }];
    }
    case "node.reorder": {
      const location = locateCanvasNode(document, patch.nodeId);
      return [{
        op: "node.reorder",
        nodeId: patch.nodeId,
        index: location.index
      }];
    }
    case "node.duplicate": {
      const duplicateRootId = isRecord(patch.idMap) ? optionalString(patch.idMap[patch.nodeId]) : null;
      if (!duplicateRootId) {
        return null;
      }
      return [{ op: "node.remove", nodeId: duplicateRootId }];
    }
    case "node.visibility.set": {
      const node = requireCanvasNode(document, patch.nodeId);
      const visibility = isRecord(node.metadata.visibility) ? node.metadata.visibility : {};
      return [{
        op: "node.visibility.set",
        nodeId: patch.nodeId,
        hidden: visibility.hidden === true
      }];
    }
    case "governance.update": {
      const block = document.designGovernance[patch.block] as Record<string, unknown>;
      const changes = Object.fromEntries(
        Object.keys(patch.changes).map((path) => [path, structuredClone(readNestedValue(block, path))])
      );
      return [{
        op: "governance.update",
        block: patch.block,
        changes
      }];
    }
    case "token.set": {
      return [{
        op: "token.set",
        path: patch.path,
        value: structuredClone(readNestedValue(document.designGovernance as Record<string, unknown>, patch.path))
      }];
    }
    case "tokens.merge":
    case "tokens.replace": {
      return [{
        op: "tokens.replace",
        tokens: structuredClone(document.tokens)
      }];
    }
    case "inventory.update": {
      const item = requireInventoryItem(document.componentInventory, patch.itemId);
      const changes = Object.fromEntries(
        Object.keys(patch.changes).map((path) => [path, structuredClone(readNestedValue(item as Record<string, unknown>, path))])
      );
      return [{
        op: "inventory.update",
        itemId: patch.itemId,
        changes
      }];
    }
    case "inventory.upsert": {
      const existing = document.componentInventory.find((entry) => entry.id === patch.item.id);
      if (!existing) {
        return [{
          op: "inventory.remove",
          itemId: patch.item.id
        }];
      }
      return [{
        op: "inventory.upsert",
        item: structuredClone(existing)
      }];
    }
    case "inventory.remove": {
      const existing = document.componentInventory.find((entry) => entry.id === patch.itemId);
      if (!existing) {
        return null;
      }
      return [{
        op: "inventory.upsert",
        item: structuredClone(existing)
      }];
    }
    case "starter.apply":
      return [{
        op: "starter.apply",
        starter: structuredClone(document.meta.starter)
      }];
    default:
      return null;
  }
}

function buildNodeRestorePatches(document: CanvasDocument, nodeId: string): CanvasPatch[] {
  const location = locateCanvasNode(document, nodeId);
  const removedNodeIds = collectSubtreeNodeIds(document, nodeId);
  const restorePatches = collectSubtreeNodes(document, nodeId).map((node) => ({
    op: "node.insert" as const,
    pageId: location.page.id,
    parentId: node.id === nodeId ? node.parentId : node.parentId,
    node: {
      id: node.id,
      kind: node.kind,
      name: node.name,
      childIds: [],
      rect: structuredClone(node.rect),
      props: structuredClone(node.props),
      style: structuredClone(node.style),
      tokenRefs: structuredClone(node.tokenRefs),
      bindingRefs: structuredClone(node.bindingRefs),
      variantPatches: structuredClone(node.variantPatches),
      metadata: structuredClone(node.metadata)
    }
  }));
  const reorderPatches = location.node.parentId
    ? [{
      op: "node.reorder" as const,
      nodeId,
      index: location.index
    }]
    : [];
  const bindingPatches = document.bindings
    .filter((binding) => removedNodeIds.includes(binding.nodeId))
    .map((binding) => ({
      op: "binding.set" as const,
      nodeId: binding.nodeId,
      binding: {
        id: binding.id,
        kind: binding.kind,
        selector: binding.selector,
        componentName: binding.componentName,
        metadata: structuredClone(binding.metadata),
        codeSync: structuredClone(binding.codeSync)
      }
    }));
  return [...restorePatches, ...reorderPatches, ...bindingPatches];
}

function collectSubtreeNodes(document: CanvasDocument, nodeId: string): CanvasNode[] {
  const { page } = locateCanvasNode(document, nodeId);
  const walk = (currentNodeId: string): CanvasNode[] => {
    const node = page.nodes.find((entry) => entry.id === currentNodeId);
    if (!node) {
      return [];
    }
    return [node, ...node.childIds.flatMap((childId) => walk(childId))];
  };
  return walk(nodeId);
}

function collectSubtreeNodeIds(document: CanvasDocument, nodeId: string): string[] {
  return collectSubtreeNodes(document, nodeId).map((node) => node.id);
}

function locateCanvasNode(
  document: CanvasDocument,
  nodeId: string
): {
  page: CanvasPage;
  node: CanvasNode;
  index: number;
} {
  for (const page of document.pages) {
    const node = page.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      continue;
    }
    const siblings = node.parentId
      ? page.nodes.find((entry) => entry.id === node.parentId)?.childIds ?? []
      : page.rootNodeId ? [page.rootNodeId] : [];
    return {
      page,
      node,
      index: siblings.indexOf(node.id)
    };
  }
  throw new Error(`Unknown node: ${nodeId}`);
}

function requireCanvasNode(document: CanvasDocument, nodeId: string): CanvasNode {
  return locateCanvasNode(document, nodeId).node;
}

function readNestedValue(target: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = target;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isIgnorableCanvasSessionCloseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("[ops_unavailable]")
    || message.includes("[invalid_session]")
    || message.includes("Unknown sessionId:")
    || message.includes("Extension not connected to relay")
    || message.includes("Ops request timed out");
}

function isCanvasRelaySessionLookupError(detail: string): boolean {
  return detail.includes("Unknown sessionId:");
}

function isAlreadyClosedCanvasTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Unknown targetId")
    || message.includes("Unknown tabId")
    || message.includes("No tab with id")
    || message.includes("No tab with given id");
}

function attachDetails(error: Error, details: Record<string, unknown>): Error {
  Object.assign(error, details);
  return error;
}
