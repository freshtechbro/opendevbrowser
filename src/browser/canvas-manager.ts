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
  normalizeCanvasDocument,
  validateGenerationPlan
} from "../canvas/document-store";
import { renderCanvasDocumentComponent, renderCanvasDocumentHtml } from "../canvas/export";
import { loadCanvasDocument, resolveCanvasRepoPath, saveCanvasDocument } from "../canvas/repo-store";
import type {
  CanvasBlocker,
  CanvasDocument,
  CanvasFeedbackItem,
  CanvasPatch,
  CanvasPlanStatus,
  CanvasPreflightState,
  CanvasSessionMode,
  CanvasSessionSummary,
  CanvasTargetState
} from "../canvas/types";
import { CANVAS_SCHEMA_VERSION } from "../canvas/types";

type CanvasCommandParams = Record<string, unknown>;

type CanvasSession = {
  canvasSessionId: string;
  browserSessionId: string | null;
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
};

type ExtensionOverlayResult = {
  mountId?: string;
  targetId?: string;
  previewState?: string;
  capabilities?: Record<string, unknown>;
  selection?: Record<string, unknown>;
  ok?: boolean;
};

type DirectPageLike = {
  addStyleTag: (options: { content: string }) => Promise<unknown>;
  evaluate: <TArg, TResult>(pageFunction: (arg: TArg) => TResult | Promise<TResult>, arg: TArg) => Promise<TResult>;
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

export type CanvasManagerLike = {
  execute: (command: string, params?: CanvasCommandParams) => Promise<unknown>;
};

export class CanvasManager implements CanvasManagerLike {
  private readonly worktree: string;
  private readonly browserManager: BrowserManagerLike;
  private readonly config: OpenDevBrowserConfig;
  private readonly relay?: RelayLike;
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
  }

  async execute(command: string, params: CanvasCommandParams = {}): Promise<unknown> {
    switch (command) {
      case "canvas.session.open":
        return await this.openSession(params);
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
      leaseId,
      mode,
      store: new CanvasDocumentStore(document),
      preflightState: "handshake_read",
      planStatus: isNonEmptyRecord(document.designGovernance.generationPlan) ? "accepted" : "missing",
      activeTargets: new Map<string, CanvasTargetState>(),
      overlayMounts: new Map(),
      designTabTargetId: null,
      feedback: [],
      nextFeedbackSeq: 1
    };
    this.sessions.set(sessionId, session);
    return this.buildHandshake(session);
  }

  private getSessionStatus(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
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
    const validation = validateGenerationPlan(plan);
    if (!validation.ok) {
      throw new Error(`Generation plan missing fields: ${validation.missing.join(", ")}`);
    }
    const result = session.store.setGenerationPlan(plan);
    session.planStatus = result.planStatus;
    session.preflightState = "plan_accepted";
    return {
      planStatus: result.planStatus,
      documentRevision: result.documentRevision,
      preflightState: session.preflightState,
      warnings: []
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
    const document = repoPath
      ? normalizeCanvasDocument(await loadCanvasDocument(this.worktree, repoPath))
      : createDefaultCanvasDocument(documentId as string);
    session.store.loadDocument(document);
    session.planStatus = isNonEmptyRecord(document.designGovernance.generationPlan) ? "accepted" : "missing";
    session.preflightState = session.planStatus === "accepted" ? "plan_accepted" : "handshake_read";
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
      const result = session.store.applyPatches(baseRevision, patches);
      session.preflightState = "patching_enabled";
      this.pushFeedback(session, {
        category: "validation",
        class: "document-patched",
        severity: "info",
        message: `Applied ${patches.length} canvas patch${patches.length === 1 ? "" : "es"}.`,
        pageId: null,
        prototypeId: null,
        targetId: null,
        evidenceRefs: []
      });
      await this.syncDesignTab(session);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Revision conflict")) {
        throw this.revisionConflict("canvas.document.patch", session);
      }
      throw error;
    }
  }

  private async saveDocument(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const document = session.store.getDocument();
    const repoPath = await saveCanvasDocument(this.worktree, document, optionalString(params.repoPath));
    return {
      repoPath,
      documentRevision: session.store.getRevision(),
      schemaVersion: document.schemaVersion,
      warnings: []
    };
  }

  private async exportDocument(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const exportTarget = requireString(params.exportTarget, "exportTarget");
    const document = session.store.getDocument();
    const exportBase = resolveCanvasRepoPath(this.worktree, document.documentId, ".opendevbrowser/canvas/exports");
    await mkdir(dirname(exportBase), { recursive: true });
    if (exportTarget === "design_document") {
      const repoPath = await saveCanvasDocument(this.worktree, document, optionalString(params.repoPath));
      return {
        exportTarget,
        documentRevision: session.store.getRevision(),
        artifactRefs: [repoPath],
        resolvedSavePath: repoPath,
        warnings: []
      };
    }
    if (exportTarget === "react_component") {
      const repoPath = `${exportBase}-${session.canvasSessionId}.tsx`;
      await saveText(repoPath, renderCanvasDocumentComponent(document));
      return {
        exportTarget,
        documentRevision: session.store.getRevision(),
        artifactRefs: [repoPath],
        warnings: []
      };
    }
    if (exportTarget === "html_bundle") {
      const repoPath = `${exportBase}-${session.canvasSessionId}.html`;
      await saveText(repoPath, renderCanvasDocumentHtml(document));
      return {
        exportTarget,
        documentRevision: session.store.getRevision(),
        artifactRefs: [repoPath],
        warnings: []
      };
    }
    throw new Error(`Unsupported exportTarget: ${exportTarget}`);
  }

  private async openTab(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const prototypeId = requireString(params.prototypeId, "prototypeId");
    const previewMode = (requireString(params.previewMode, "previewMode") as CanvasTargetState["previewMode"]);
    if (session.browserSessionId) {
      const status = await this.browserManager.status(session.browserSessionId);
      if (status.mode === "extension") {
        const result = await this.requestCanvasExtension(session, "canvas.tab.open", {
          prototypeId,
          previewMode,
          document: session.store.getDocument(),
          documentRevision: session.store.getRevision()
        });
        session.designTabTargetId = typeof result.targetId === "string" ? result.targetId : null;
        return {
          targetId: session.designTabTargetId,
          targetIds: session.designTabTargetId ? [session.designTabTargetId] : [],
          previewState: result.previewState ?? "design_tab_open",
          designTab: true
        };
      }
      const html = renderCanvasDocumentHtml(session.store.getDocument());
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      const page = await this.browserManager.page(session.browserSessionId, `canvas-${prototypeId}`, url);
      session.designTabTargetId = page.targetId;
      return {
        targetId: page.targetId,
        targetIds: [page.targetId],
        previewState: "design_tab_open",
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
    return { ok: true, targetIds: [...session.activeTargets.keys()] };
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
    return {
      mountId,
      targetId,
      previewState: result.previewState ?? "overlay_mounted",
      capabilities: result.capabilities ?? { selection: true, guides: true }
    };
  }

  private async unmountOverlay(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const mountId = requireString(params.mountId, "mountId");
    const mount = session.overlayMounts.get(mountId);
    if (!mount || !session.browserSessionId) {
      return { ok: true, mountId, previewState: "overlay_idle" };
    }
    const status = await this.browserManager.status(session.browserSessionId);
    if (status.mode === "extension") {
      await this.requestCanvasExtension(session, "canvas.overlay.unmount", { mountId, targetId: mount.targetId });
    } else {
      await this.unmountDirectOverlay(session.browserSessionId, mount.targetId);
    }
    session.overlayMounts.delete(mountId);
    return { ok: true, mountId, previewState: "overlay_idle" };
  }

  private async selectOverlay(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const mountId = requireString(params.mountId, "mountId");
    const targetId = requireString(params.targetId, "targetId");
    const hint = requireRecord(params.selectionHint, "selectionHint");
    if (!session.browserSessionId) {
      throw new Error("canvas.overlay.select requires a browserSessionId.");
    }
    const status = await this.browserManager.status(session.browserSessionId);
    const selection = status.mode === "extension"
      ? await this.requestCanvasExtension(session, "canvas.overlay.select", { mountId, targetId, selectionHint: hint })
      : { selection: await this.selectDirectOverlay(session.browserSessionId, targetId, hint) };
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
    const prototype = session.store.getDocument().prototypes.find((entry) => entry.id === prototypeId);
    if (!prototype) {
      throw new Error(`Unknown prototype: ${prototypeId}`);
    }
    const status = await this.browserManager.status(session.browserSessionId);
    const url = resolvePreviewUrl(status.url, prototype.route);
    if (!url) {
      throw new Error("Unable to resolve preview target URL.");
    }
    await this.browserManager.goto(session.browserSessionId, url, "load", 30000, undefined, targetId);
    const screenshot = await this.browserManager.screenshot(session.browserSessionId, targetId);
    const consoleData = await this.browserManager.consolePoll(session.browserSessionId, 0, 25);
    const networkData = await this.browserManager.networkPoll(session.browserSessionId, 0, 25);
    const previewState: CanvasTargetState = {
      targetId,
      prototypeId,
      previewMode: "focused",
      previewState: "rendered",
      renderStatus: "rendered",
      lastRenderedAt: new Date().toISOString()
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
        evidenceRefs: []
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
        evidenceRefs: []
      });
    }
    this.pushFeedback(session, {
      category: "render",
      class: "render-complete",
      severity: "info",
      message: "Preview render completed.",
      pageId: prototype.pageId,
      prototypeId,
      targetId,
      evidenceRefs: screenshot.path ? [screenshot.path] : []
    });
    await this.syncDesignTab(session);
    return {
      renderStatus: "rendered",
      targetId,
      prototypeId,
      previewState: "rendered",
      documentRevision: session.store.getRevision()
    };
  }

  private async refreshPreview(params: CanvasCommandParams): Promise<unknown> {
    const session = this.requireSession(params);
    this.assertLease(session, params);
    const targetId = requireString(params.targetId, "targetId");
    const refreshMode = requireString(params.refreshMode, "refreshMode");
    const existing = session.activeTargets.get(targetId);
    if (!existing) {
      throw new Error(`Unknown preview target: ${targetId}`);
    }
    if (refreshMode === "full") {
      return await this.renderPreview({
        canvasSessionId: session.canvasSessionId,
        leaseId: session.leaseId,
        targetId,
        prototypeId: existing.prototypeId
      });
    }
    const screenshot = await this.browserManager.screenshot(requireString(session.browserSessionId, "browserSessionId"), targetId);
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
    return {
      targetId,
      previewState: existing.previewState,
      renderStatus: existing.renderStatus,
      documentRevision: session.store.getRevision(),
      degradeReason: existing.degradeReason
    };
  }

  private pollFeedback(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    const afterCursor = optionalString(params.afterCursor);
    const startIndex = afterCursor ? session.feedback.findIndex((item) => item.cursor === afterCursor) + 1 : 0;
    const items = session.feedback.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + 25);
    const nextCursor = items.length > 0 ? items[items.length - 1]!.cursor : afterCursor;
    return {
      items,
      nextCursor: nextCursor ?? null,
      retention: { total: session.feedback.length }
    };
  }

  private subscribeFeedback(params: CanvasCommandParams): unknown {
    const session = this.requireSession(params);
    const polled = this.pollFeedback(params) as { items: CanvasFeedbackItem[]; nextCursor: string | null };
    return {
      subscriptionId: `canvas_sub_${randomUUID()}`,
      items: polled.items,
      cursor: polled.nextCursor,
      eventTypes: ["feedback.item", "feedback.heartbeat", "feedback.complete"]
    };
  }

  private buildHandshake(session: CanvasSession): Record<string, unknown> {
    const document = session.store.getDocument();
    const governanceBlockStates = buildGovernanceBlockStates(document);
    return {
      canvasSessionId: session.canvasSessionId,
      browserSessionId: session.browserSessionId,
      leaseId: session.leaseId,
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
      allowedLibraries: CANVAS_PROJECT_DEFAULTS.libraryPolicy,
      governanceBlockStates,
      runtimeBudgets: CANVAS_PROJECT_DEFAULTS.runtimeBudgets,
      warningClasses: ["missing-generation-plan", "missing-intent", "runtime-budget-exceeded"],
      mutationPolicy: {
        planRequiredBeforePatch: true,
        allowedBeforePlan: [
          "canvas.capabilities.get",
          "canvas.plan.get",
          "canvas.plan.set",
          "canvas.document.load",
          "canvas.session.status"
        ]
      },
      documentContext: buildDocumentContext(document)
    };
  }

  private buildSessionSummary(session: CanvasSession): CanvasSessionSummary {
    return {
      canvasSessionId: session.canvasSessionId,
      browserSessionId: session.browserSessionId,
      documentId: session.store.getDocumentId(),
      leaseId: session.leaseId,
      preflightState: session.preflightState,
      planStatus: session.planStatus,
      mode: session.mode,
      documentRevision: session.store.getRevision(),
      targets: [...session.activeTargets.values()],
      overlayMounts: [...session.overlayMounts.values()],
      designTabTargetId: session.designTabTargetId
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
      throw new Error(`Lease mismatch for ${session.canvasSessionId}`);
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
    return attachDetails(new Error(blocker.message), { code: blocker.code, blocker });
  }

  private revisionConflict(command: string, session: CanvasSession): Error {
    const blocker: CanvasBlocker = {
      code: "revision_conflict",
      blockingCommand: command,
      requiredNextCommands: ["canvas.document.load"],
      latestRevision: session.store.getRevision(),
      message: "The canvas document revision changed before this patch batch was applied."
    };
    return attachDetails(new Error(blocker.message), { code: blocker.code, blocker });
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
    if (session.feedback.length > 200) {
      session.feedback.shift();
    }
  }

  private async syncDesignTab(session: CanvasSession): Promise<void> {
    if (!session.designTabTargetId || !session.browserSessionId) {
      return;
    }
    const status = await this.browserManager.status(session.browserSessionId);
    if (status.mode !== "extension") {
      return;
    }
    await this.requestCanvasExtension(session, "canvas.tab.sync", {
      targetId: session.designTabTargetId,
      document: session.store.getDocument(),
      summary: this.buildSessionSummary(session)
    }).catch(() => {});
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
      this.canvasClient = new CanvasClient(connectEndpoint);
      this.canvasEndpoint = url;
      await this.canvasClient.connect();
    }
    return this.canvasClient;
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
          previewState: "overlay_mounted",
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

  private async selectDirectOverlay(
    sessionId: string,
    targetId: string,
    selectionHint: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return await this.browserManager.withPage(sessionId, targetId, async (page: DirectPageLike) => {
      return await page.evaluate((hint) => {
        document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
          element.classList.remove("opendevbrowser-canvas-highlight");
        });
        const selector = typeof hint.selector === "string" ? hint.selector : null;
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
      }, selectionHint);
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

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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

function attachDetails(error: Error, details: Record<string, unknown>): Error {
  Object.assign(error, details);
  return error;
}
