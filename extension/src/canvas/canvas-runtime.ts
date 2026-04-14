import {
  CANVAS_PROTOCOL_VERSION,
  MAX_CANVAS_PAYLOAD_BYTES,
  type CanvasChunk,
  type CanvasEnvelope,
  type CanvasError,
  type CanvasEvent,
  type CanvasHello,
  type CanvasHelloAck,
  type CanvasPing,
  type CanvasPong,
  type CanvasRequest,
  type CanvasResponse
} from "../types.js";
import { logError } from "../logging.js";
import { TabManager } from "../services/TabManager.js";
import {
  TargetSessionCoordinator,
  createCoordinatorId,
  type TargetSessionRecord
} from "../ops/target-session-coordinator.js";
import {
  type CanvasDocument,
  type CanvasEditorSelection,
  type CanvasEditorViewport,
  type CanvasFeedbackEvent,
  type CanvasFeedbackItem,
  type CanvasOverlayMountSummary,
  type CanvasPage,
  type CanvasPageMessage,
  type CanvasPagePortMessage,
  type CanvasPageState,
  type CanvasSessionSummary,
  type CanvasPreviewState,
  type CanvasTargetStateSummary,
  type CanvasNode,
  type CanvasPageElementAction,
  normalizeCanvasSessionSummary,
  normalizeCanvasTargetStateSummaries
} from "./model.js";
import { DEFAULT_EDITOR_VIEWPORT } from "./viewport-fit.js";

type CanvasRuntimeOptions = {
  send: (message: CanvasEnvelope) => void;
  registerOpsCanvasTarget?: (
    browserSessionId: string,
    targetId: string
  ) => Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean } | null>;
  unregisterOpsCanvasTarget?: (browserSessionId: string, targetId: string) => Promise<boolean> | boolean;
};

type CanvasSessionExtra = {
  designTabTargetId: string | null;
  document: CanvasDocument;
  documentRevision: number | null;
  html: string;
  summary: CanvasSessionSummary;
  previewMode: CanvasPreviewState;
  previewState: CanvasPreviewState;
  previewTargets: CanvasTargetStateSummary[];
  overlayMounts: CanvasOverlayMountSummary[];
  feedback: CanvasFeedbackEvent[];
  feedbackCursor: string | null;
  selection: CanvasEditorSelection;
  viewport: CanvasEditorViewport;
  pendingMutation: boolean;
};

type CanvasSessionRecord = TargetSessionRecord<CanvasSessionExtra>;
type OverlaySessionRecord = {
  id: string;
  ownerClientId: string;
  leaseId: string;
  designTabTargetId: string | null;
  document: CanvasDocument;
  previewState: CanvasPreviewState;
  overlayMounts: CanvasOverlayMountSummary[];
  selection: CanvasEditorSelection;
};
type OverlayCapableSession = CanvasSessionRecord | OverlaySessionRecord;

const OVERLAY_STYLE = `
#opendevbrowser-canvas-style,
.opendevbrowser-canvas-highlight {
  box-sizing: border-box;
}
.opendevbrowser-canvas-highlight {
  outline: 2px solid #20d5c6 !important;
  outline-offset: 3px !important;
}
.opendevbrowser-canvas-overlay {
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
.opendevbrowser-canvas-overlay strong {
  display: block;
  margin-bottom: 4px;
}
`;

export class CanvasRuntime {
  private readonly sendEnvelope: (message: CanvasEnvelope) => void;
  private readonly registerOpsCanvasTarget?: CanvasRuntimeOptions["registerOpsCanvasTarget"];
  private readonly unregisterOpsCanvasTarget?: CanvasRuntimeOptions["unregisterOpsCanvasTarget"];
  private readonly encoder = new TextEncoder();
  private readonly tabs = new TabManager();
  private readonly sessions = new TargetSessionCoordinator<CanvasSessionExtra>();
  private readonly overlaySessions = new Map<string, OverlaySessionRecord>();
  private readonly pagePorts = new Map<number, Set<chrome.runtime.Port>>();
  private readonly pendingPageActions = new Map<string, {
    tabId: number;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();

  constructor(options: CanvasRuntimeOptions) {
    this.sendEnvelope = options.send;
    this.registerOpsCanvasTarget = options.registerOpsCanvasTarget;
    this.unregisterOpsCanvasTarget = options.unregisterOpsCanvasTarget;
  }

  attachPort(port: chrome.runtime.Port): void {
    if (port.name !== "canvas-page") {
      return;
    }
    const tabId = port.sender?.tab?.id;
    if (typeof tabId !== "number") {
      port.disconnect();
      return;
    }
    let ports = this.pagePorts.get(tabId);
    if (!ports) {
      ports = new Set();
      this.pagePorts.set(tabId, ports);
    }
    ports.add(port);
    port.onDisconnect.addListener(() => {
      const current = this.pagePorts.get(tabId);
      current?.delete(port);
      if (current && current.size === 0) {
        this.pagePorts.delete(tabId);
      }
      for (const [requestId, pending] of this.pendingPageActions.entries()) {
        if (pending.tabId !== tabId) {
          continue;
        }
        clearTimeout(pending.timeoutId);
        pending.reject(new Error("Canvas page disconnected before action completed."));
        this.pendingPageActions.delete(requestId);
      }
    });
    port.onMessage.addListener((message: unknown) => {
      const record = isRecord(message) ? message as CanvasPagePortMessage : null;
      if (!record) {
        return;
      }
      this.handlePagePortMessage(tabId, record);
    });
    this.postCanvasState(port, this.getPageStateByTabId(tabId), "canvas-page:init");
  }

  getPageStateByTargetId(targetId: string): CanvasPageState | null {
    try {
      return this.getPageStateByTabId(parseTargetId(targetId));
    } catch {
      return null;
    }
  }

  async performPageAction(
    targetId: string,
    action: CanvasPageElementAction,
    selector?: string | null,
    timeoutMs = 2500
  ): Promise<unknown> {
    const tabId = parseTargetId(targetId);
    const port = await this.waitForPagePort(tabId, timeoutMs);
    return await new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeoutId = setTimeout(() => {
        this.pendingPageActions.delete(requestId);
        reject(new Error("Canvas page action timed out."));
      }, timeoutMs);
      this.pendingPageActions.set(requestId, { tabId, resolve, reject, timeoutId });
      try {
        port.postMessage({
          type: "canvas-page-action-request",
          requestId,
          selector: selector ?? null,
          action
        } satisfies CanvasPageMessage);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingPageActions.delete(requestId);
        reject(error instanceof Error ? error : new Error("Canvas page action failed."));
      }
    });
  }

  handleMessage(message: CanvasEnvelope): void {
    if (message.type === "canvas_hello") {
      this.handleHello(message);
      return;
    }
    if (message.type === "canvas_ping") {
      this.handlePing(message);
      return;
    }
    if (message.type === "canvas_event" && message.event === "canvas_client_disconnected") {
      this.handleClientDisconnected(message);
      return;
    }
    if (message.type === "canvas_request") {
      void this.handleRequest(message).catch((error) => {
        logError("canvas.handle_request", error, { code: "canvas_request_failed", extra: { command: message.command } });
        this.sendError(message, normalizeCanvasError(error));
      });
    }
  }

  private handleHello(message: CanvasHello): void {
    if (message.version !== CANVAS_PROTOCOL_VERSION) {
      this.sendError(
        { requestId: "canvas_hello", clientId: message.clientId, canvasSessionId: undefined },
        {
          code: "not_supported",
          message: "Unsupported canvas protocol version.",
          retryable: false,
          details: { supported: [CANVAS_PROTOCOL_VERSION], received: message.version }
        }
      );
      return;
    }
    const ack: CanvasHelloAck = {
      type: "canvas_hello_ack",
      version: CANVAS_PROTOCOL_VERSION,
      clientId: message.clientId,
      maxPayloadBytes: MAX_CANVAS_PAYLOAD_BYTES,
      capabilities: [
        "canvas.tab.open",
        "canvas.tab.close",
        "canvas.tab.sync",
        "canvas.overlay.mount",
        "canvas.overlay.unmount",
        "canvas.overlay.select",
        "canvas.overlay.sync"
      ]
    };
    this.sendEnvelope(ack);
  }

  private handlePing(message: CanvasPing): void {
    const pong: CanvasPong = {
      type: "canvas_pong",
      id: message.id,
      clientId: message.clientId
    };
    this.sendEnvelope(pong);
  }

  private handleClientDisconnected(message: CanvasEvent): void {
    const clientId = message.clientId;
    if (!clientId) {
      return;
    }
    for (const session of this.sessions.listOwnedBy(clientId)) {
      if (this.shouldPreserveSessionOnDisconnect(session)) {
        continue;
      }
      void this.closeRuntimeSession(session, "client_disconnected");
    }
    for (const [sessionId, session] of this.overlaySessions.entries()) {
      if (session.ownerClientId === clientId) {
        this.overlaySessions.delete(sessionId);
      }
    }
  }

  private handlePagePortMessage(tabId: number, message: CanvasPagePortMessage): void {
    if (message.type === "canvas-page-action-response") {
      const pending = this.pendingPageActions.get(message.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeoutId);
      this.pendingPageActions.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.value);
      } else {
        pending.reject(new Error(message.error || "Canvas page action failed."));
      }
      return;
    }
    const session = this.sessions.getByTabId(tabId);
    if (message.type === "canvas-page-ready" || message.type === "canvas-page-request-state") {
      this.broadcastCanvasState(tabId, "canvas-page:init");
      return;
    }
    if (!session) {
      return;
    }
    if (message.type === "canvas-page-view-state") {
      this.mergeEditorState(session, message.viewport, message.selection);
      this.broadcastCanvasState(tabId, "canvas-page:update");
      return;
    }
    if (message.type === "canvas-page-patch-request") {
      if (!Array.isArray(message.patches) || message.patches.length === 0 || typeof message.baseRevision !== "number") {
        return;
      }
      this.mergeEditorState(session, message.viewport, message.selection);
      session.pendingMutation = true;
      this.broadcastCanvasState(tabId, "canvas-page:update");
      this.sendEvent({
        type: "canvas_event",
        clientId: session.ownerClientId,
        canvasSessionId: session.id,
        event: "canvas_patch_requested",
        payload: {
          targetId: session.designTabTargetId,
          documentId: session.document.documentId,
          baseRevision: message.baseRevision,
          patches: message.patches,
          selection: session.selection,
          viewport: session.viewport
        }
      });
      return;
    }
    if (message.type === "canvas-page-history-request") {
      this.sendEvent({
        type: "canvas_event",
        clientId: session.ownerClientId,
        canvasSessionId: session.id,
        event: "canvas_history_requested",
        payload: {
          direction: message.direction
        }
      });
    }
  }

  private async handleRequest(message: CanvasRequest): Promise<void> {
    switch (message.command) {
      case "canvas.tab.open":
        this.sendResponse(message, await this.openTab(message));
        return;
      case "canvas.tab.close":
        this.sendResponse(message, await this.closeTab(message));
        return;
      case "canvas.tab.sync":
        this.sendResponse(message, await this.syncTab(message));
        return;
      case "canvas.overlay.mount":
        this.sendResponse(message, await this.mountOverlay(message));
        return;
      case "canvas.overlay.unmount":
        this.sendResponse(message, await this.unmountOverlay(message));
        return;
      case "canvas.overlay.select":
        this.sendResponse(message, await this.selectOverlay(message));
        return;
      case "canvas.overlay.sync":
        this.sendResponse(message, await this.syncOverlay(message));
        return;
      default:
        this.sendError(message, {
          code: "not_supported",
          message: `Unsupported canvas command: ${message.command}`,
          retryable: false
        });
    }
  }

  private async openTab(message: CanvasRequest): Promise<Record<string, unknown>> {
    const record = requireRecord(message.payload, "payload");
    const document = requireCanvasDocument(record.document);
    const previewMode = requireEnum(record.previewMode, "previewMode", ["focused", "pinned", "background"]);
    const tab = await this.createTab(chrome.runtime.getURL("canvas.html"), previewMode);
    const tabId = requireTabId(tab);
    const session = this.createOrReplaceSession(message, tabId, document, previewMode, record);
    await this.syncOpsTargetRegistration(session).catch((error) => {
      logError("canvas.sync_ops_target_registration", error, {
        code: "canvas_ops_target_registration_failed",
        extra: { canvasSessionId: session.id, targetId: session.designTabTargetId }
      });
    });
    this.broadcastCanvasState(tabId, "canvas-page:init");
    this.sendEvent({
      type: "canvas_event",
      clientId: message.clientId,
      canvasSessionId: session.id,
      event: "canvas_session_created",
      payload: { tabId, targetId: session.designTabTargetId }
    });
    return {
      targetId: session.designTabTargetId,
      previewState: session.previewState
    };
  }

  private async closeTab(message: CanvasRequest): Promise<Record<string, unknown>> {
    const record = requireRecord(message.payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const targetId = formatTargetId(tabId);
    let session: CanvasSessionRecord | null = null;
    try {
      session = this.requireSessionForMessage(message, record);
    } catch (error) {
      if (!isIgnorableCanvasCloseLookupError(error)) {
        throw error;
      }
    }
    if (!session) {
      const browserSessionId = optionalString(record.browserSessionId)
        ?? optionalString(isRecord(record.summary) ? record.summary.browserSessionId : undefined);
      if (browserSessionId && this.unregisterOpsCanvasTarget) {
        await Promise.resolve(this.unregisterOpsCanvasTarget(browserSessionId, targetId)).catch((error) => {
          logError("canvas.unregister_ops_target", error, {
            code: "canvas_ops_target_unregister_failed",
            extra: { browserSessionId, targetId }
          });
        });
      }
      this.broadcastCanvasState(tabId, "canvas-page:closed", { reason: "target_closed" });
      this.pagePorts.delete(tabId);
      await this.tabs.closeTab(tabId).catch(() => undefined);
      return {
        ok: true,
        targetId,
        targetIds: [],
        releasedTargetIds: [targetId],
        previewState: "background"
      };
    }
    this.broadcastCanvasState(tabId, "canvas-page:closed", { reason: "target_closed" });
    session.designTabTargetId = null;
    session.pendingMutation = false;
    this.pagePorts.delete(tabId);
    this.sessions.removeTarget(session.id, targetId);
    const browserSessionId = readBrowserSessionId(session.summary);
    if (browserSessionId && this.unregisterOpsCanvasTarget) {
      await Promise.resolve(this.unregisterOpsCanvasTarget(browserSessionId, targetId)).catch((error) => {
        logError("canvas.unregister_ops_target", error, {
          code: "canvas_ops_target_unregister_failed",
          extra: { browserSessionId, targetId }
        });
      });
    }
    await this.tabs.closeTab(tabId);
    this.sendEvent({
      type: "canvas_event",
      clientId: session.ownerClientId,
      canvasSessionId: session.id,
      event: "canvas_target_closed",
      payload: { targetId, tabId }
    });
    return {
      ok: true,
      targetId,
      targetIds: [...session.targets.keys()],
      releasedTargetIds: [targetId],
      previewState: "background"
    };
  }

  private async syncTab(message: CanvasRequest): Promise<Record<string, unknown>> {
    const session = this.requireSessionForMessage(message);
    const record = requireRecord(message.payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const existingTab = await this.tabs.getTab(tabId);
    if (!existingTab) {
      throw new Error(`Canvas target is unavailable: ${tabId}`);
    }
    const summary = normalizeCanvasSessionSummary(record.summary);
    session.document = requireCanvasDocument(record.document);
    session.documentRevision = optionalNumber(record.documentRevision);
    session.html = requireRenderedHtml(record);
    session.summary = summary;
    session.previewTargets = normalizeCanvasTargetStateSummaries(record.targets ?? summary.targets);
    session.overlayMounts = parseOverlayMounts(record.overlayMounts ?? summary.overlayMounts);
    session.feedback = parseFeedbackEvents(record.feedback);
    session.feedbackCursor = optionalString(record.feedbackCursor) ?? lastFeedbackCursor(session.feedback);
    session.pendingMutation = false;
    this.mergeEditorState(session, normalizeViewport(record.viewport), normalizeSelection(record.selection));
    session.previewState = normalizePreviewState(record.previewState) ?? session.previewState;
    session.previewMode = normalizePreviewState(record.previewMode) ?? session.previewMode;
    this.broadcastCanvasState(tabId, "canvas-page:update");
    return {
      ok: true,
      targetId: formatTargetId(tabId),
      previewState: session.previewState
    };
  }

  private async mountOverlay(message: CanvasRequest): Promise<Record<string, unknown>> {
    const record = requireRecord(message.payload, "payload");
    const session = this.requireOverlaySession(message, record, true);
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const prototypeId = optionalString(record.prototypeId) ?? "default";
    if (this.isDesignTabTarget(session, tabId)) {
      const mountId = `mount_${crypto.randomUUID()}`;
      const mount = {
        mountId,
        targetId: formatTargetId(tabId),
        mountedAt: new Date().toISOString()
      } satisfies CanvasOverlayMountSummary;
      session.overlayMounts = dedupeOverlayMounts([...session.overlayMounts, mount]);
      this.broadcastIfDesignTab(session);
      return {
        mountId,
        targetId: formatTargetId(tabId),
        previewState: session.previewState,
        overlayState: "mounted",
        capabilities: { selection: true, guides: true }
      };
    }
    await insertCss(tabId, OVERLAY_STYLE);
    const mountId = `mount_${crypto.randomUUID()}`;
    const result = await executeInTab(tabId, mountOverlayScript, [{
      mountId,
      cssText: OVERLAY_STYLE,
      title: session.document.title,
      prototypeId,
      selection: session.selection
    }]);
    const mount = {
      mountId,
      targetId: formatTargetId(tabId),
      mountedAt: new Date().toISOString()
    } satisfies CanvasOverlayMountSummary;
    session.overlayMounts = dedupeOverlayMounts([...session.overlayMounts, mount]);
    this.broadcastIfDesignTab(session);
    return {
      mountId,
      targetId: formatTargetId(tabId),
      previewState: "background",
      overlayState: result?.previewState ?? "mounted",
      capabilities: { selection: true, guides: true }
    };
  }

  private async unmountOverlay(message: CanvasRequest): Promise<Record<string, unknown>> {
    const record = requireRecord(message.payload, "payload");
    const session = this.requireOverlaySession(message, record);
    const mountId = requireString(record.mountId, "mountId");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    if (this.isDesignTabTarget(session, tabId)) {
      session.overlayMounts = session.overlayMounts.filter((mount) => mount.mountId !== mountId);
      this.broadcastIfDesignTab(session);
      return {
        ok: true,
        mountId,
        previewState: session.previewState,
        overlayState: "idle"
      };
    }
    await executeInTab(tabId, unmountOverlayScript, [mountId]);
    session.overlayMounts = session.overlayMounts.filter((mount) => mount.mountId !== mountId);
    this.broadcastIfDesignTab(session);
    return {
      ok: true,
      mountId,
      previewState: "background",
      overlayState: "idle"
    };
  }

  private async selectOverlay(message: CanvasRequest): Promise<Record<string, unknown>> {
    const record = requireRecord(message.payload, "payload");
    const session = this.requireOverlaySession(message, record);
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const selectionHint = isRecord(record.selectionHint) ? record.selectionHint : {};
    const nodeId = optionalString(record.nodeId);
    const selection = this.isDesignTabTarget(session, tabId)
      ? resolveDesignTabOverlaySelection(session.document, nodeId, selectionHint)
      : await executeInTab(tabId, selectOverlayScript, [{ selectionHint, nodeId }]);
    const resolvedNodeId = typeof selection.nodeId === "string" ? selection.nodeId : nodeId;
    if (typeof resolvedNodeId === "string") {
      session.selection = {
        pageId: session.document.pages[0]?.id ?? null,
        nodeId: resolvedNodeId,
        targetId: formatTargetId(tabId),
        updatedAt: new Date().toISOString()
      };
      this.broadcastIfDesignTab(session);
    }
    return {
      targetId: formatTargetId(tabId),
      selection
    };
  }

  private async syncOverlay(message: CanvasRequest): Promise<Record<string, unknown>> {
    const record = requireRecord(message.payload, "payload");
    const session = this.requireOverlaySession(message, record);
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const mountId = requireString(record.mountId, "mountId");
    if (this.isDesignTabTarget(session, tabId)) {
      this.broadcastIfDesignTab(session);
      return {
        ok: true,
        mountId,
        targetId: formatTargetId(tabId),
        overlayState: "mounted"
      };
    }
    await insertCss(tabId, OVERLAY_STYLE);
    const result = await executeInTab(tabId, syncOverlayScript, [{
      mountId,
      title: session.document.title,
      selection: session.selection
    }]);
    return {
      ok: true,
      mountId,
      targetId: formatTargetId(tabId),
      overlayState: result?.overlayState ?? "mounted"
    };
  }

  private shouldPreserveSessionOnDisconnect(session: CanvasSessionRecord): boolean {
    return typeof session.designTabTargetId === "string"
      && session.targets.has(session.designTabTargetId);
  }

  private createOrReplaceSession(
    message: CanvasRequest,
    tabId: number,
    document: CanvasDocument,
    previewMode: CanvasPreviewState,
    record: Record<string, unknown>
  ): CanvasSessionRecord {
    const canvasSessionId = resolveCanvasSessionId(message, record);
    const clientId = requireString(message.clientId, "clientId");
    const requestedLeaseId = optionalString(message.leaseId);
    const summary = normalizeCanvasSessionSummary(record.summary);
    const existing = this.sessions.get(canvasSessionId);
    if (existing) {
      this.overlaySessions.delete(existing.id);
      if (existing.ownerClientId !== clientId || (requestedLeaseId && existing.leaseId !== requestedLeaseId)) {
        throw new Error("Canvas session ownership mismatch.");
      }
      if (existing.designTabTargetId && existing.designTabTargetId !== formatTargetId(tabId)) {
        void this.tabs.closeTab(parseTargetId(existing.designTabTargetId)).catch(() => undefined);
      }
      existing.designTabTargetId = formatTargetId(tabId);
      existing.document = document;
      existing.documentRevision = optionalNumber(record.documentRevision);
      existing.html = requireRenderedHtml(record);
      existing.summary = summary;
      existing.previewTargets = normalizeCanvasTargetStateSummaries(record.targets ?? summary.targets);
      existing.overlayMounts = parseOverlayMounts(record.overlayMounts ?? summary.overlayMounts);
      existing.feedback = parseFeedbackEvents(record.feedback);
      existing.feedbackCursor = optionalString(record.feedbackCursor) ?? lastFeedbackCursor(existing.feedback);
      existing.previewMode = previewMode;
      existing.previewState = previewMode;
      existing.pendingMutation = false;
      this.mergeEditorState(existing, normalizeViewport(record.viewport), normalizeSelection(record.selection));
      this.sessions.addTarget(existing.id, tabId, { title: document.title, url: chrome.runtime.getURL("canvas.html") });
      this.sessions.setActiveTarget(existing.id, formatTargetId(tabId));
      return existing;
    }
    const leaseId = requestedLeaseId ?? createCoordinatorId();
    const viewport = normalizeViewportState(record.viewport);
    const session = this.sessions.createSession(clientId, tabId, leaseId, {
      title: document.title,
      url: chrome.runtime.getURL("canvas.html")
    }, {
      designTabTargetId: formatTargetId(tabId),
      document,
      documentRevision: optionalNumber(record.documentRevision),
      html: requireRenderedHtml(record),
      summary,
      previewMode,
      previewState: previewMode,
      previewTargets: normalizeCanvasTargetStateSummaries(record.targets ?? summary.targets),
      overlayMounts: parseOverlayMounts(record.overlayMounts ?? summary.overlayMounts),
      feedback: parseFeedbackEvents(record.feedback),
      feedbackCursor: optionalString(record.feedbackCursor) ?? lastFeedbackCursor(parseFeedbackEvents(record.feedback)),
      selection: normalizeSelectionState(record.selection, document.pages[0]?.id ?? null),
      viewport,
      pendingMutation: false
    }, canvasSessionId);
    this.overlaySessions.delete(session.id);
    return session;
  }

  private requireOverlaySession(
    message: CanvasRequest,
    record: Record<string, unknown>,
    createIfMissing = false
  ): OverlayCapableSession {
    try {
      return this.requireSessionForMessage(message, record);
    } catch (error) {
      if (!isIgnorableCanvasCloseLookupError(error)) {
        throw error;
      }
    }
    const sessionId = optionalString(message.canvasSessionId)
      ?? optionalString(record.canvasSessionId)
      ?? optionalString(isRecord(record.summary) ? record.summary.canvasSessionId : undefined);
    if (!sessionId) {
      throw missingCanvasSession();
    }
    const clientId = requireString(message.clientId, "clientId");
    const requestedLeaseId = optionalString(message.leaseId);
    const existing = this.overlaySessions.get(sessionId);
    if (existing) {
      if (existing.ownerClientId !== clientId || (requestedLeaseId && existing.leaseId !== requestedLeaseId)) {
        throw new Error("Canvas session ownership mismatch.");
      }
      if (record.document !== undefined) {
        existing.document = requireCanvasDocument(record.document);
      }
      if (record.selection !== undefined) {
        existing.selection = normalizeSelectionState(record.selection, existing.document.pages[0]?.id ?? null);
      }
      existing.previewState = normalizePreviewState(record.previewState) ?? existing.previewState;
      return existing;
    }
    if (!createIfMissing) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
    const document = requireCanvasDocument(record.document);
    const session: OverlaySessionRecord = {
      id: sessionId,
      ownerClientId: clientId,
      leaseId: requestedLeaseId ?? createCoordinatorId(),
      designTabTargetId: null,
      document,
      previewState: normalizePreviewState(record.previewState) ?? "background",
      overlayMounts: parseOverlayMounts(record.overlayMounts),
      selection: normalizeSelectionState(record.selection, document.pages[0]?.id ?? null)
    };
    this.overlaySessions.set(sessionId, session);
    return session;
  }

  private requireSessionForMessage(message: CanvasRequest, record?: Record<string, unknown>): CanvasSessionRecord {
    const payload = record ?? (isRecord(message.payload) ? message.payload : {});
    const session = resolveSessionForMessage(this.sessions, message, payload);
    const clientId = requireString(message.clientId, "clientId");
    const leaseId = optionalString(message.leaseId);
    if (session.ownerClientId !== clientId) {
      if (!leaseId || session.leaseId !== leaseId) {
        throw new Error("Canvas session ownership mismatch.");
      }
      session.ownerClientId = clientId;
    }
    if (leaseId && session.leaseId !== leaseId) {
      throw new Error("Canvas session ownership mismatch.");
    }
    return session;
  }

  private mergeEditorState(
    session: CanvasSessionRecord,
    viewport?: Partial<CanvasEditorViewport> | null,
    selection?: Partial<CanvasEditorSelection> | null
  ): void {
    if (viewport) {
      session.viewport = {
        x: typeof viewport.x === "number" ? viewport.x : session.viewport.x,
        y: typeof viewport.y === "number" ? viewport.y : session.viewport.y,
        zoom: typeof viewport.zoom === "number" && Number.isFinite(viewport.zoom) ? viewport.zoom : session.viewport.zoom
      };
    }
    if (selection) {
      session.selection = {
        pageId: typeof selection.pageId === "string" ? selection.pageId : session.selection.pageId,
        nodeId: typeof selection.nodeId === "string" || selection.nodeId === null ? selection.nodeId : session.selection.nodeId,
        targetId: typeof selection.targetId === "string" || selection.targetId === null ? selection.targetId : session.selection.targetId,
        updatedAt: new Date().toISOString()
      };
    }
  }

  private getPageStateByTabId(tabId: number): CanvasPageState | null {
    const session = this.sessions.getByTabId(tabId);
    if (!session || !session.designTabTargetId) {
      return null;
    }
    return buildPageState(session, tabId);
  }

  private async waitForPagePort(tabId: number, timeoutMs: number): Promise<chrome.runtime.Port> {
    const existing = this.firstConnectedPagePort(tabId);
    if (existing) {
      return existing;
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await delay(50);
      const next = this.firstConnectedPagePort(tabId);
      if (next) {
        return next;
      }
    }
    throw new Error("Canvas page port unavailable.");
  }

  private firstConnectedPagePort(tabId: number): chrome.runtime.Port | null {
    const ports = this.pagePorts.get(tabId);
    if (!ports || ports.size === 0) {
      return null;
    }
    return ports.values().next().value ?? null;
  }

  private isDesignTabTarget(session: OverlayCapableSession, tabId: number): boolean {
    return session.designTabTargetId === formatTargetId(tabId);
  }

  private sendResponse(message: CanvasRequest, payload: unknown): void {
    const response: CanvasResponse = {
      type: "canvas_response",
      requestId: message.requestId,
      clientId: message.clientId,
      canvasSessionId: message.canvasSessionId,
      payload
    };
    const serialized = JSON.stringify(payload ?? null);
    if (this.encoder.encode(serialized).length <= MAX_CANVAS_PAYLOAD_BYTES) {
      this.sendEnvelope(response);
      return;
    }

    const payloadId = crypto.randomUUID();
    const chunkSize = Math.max(1024, MAX_CANVAS_PAYLOAD_BYTES - 1024);
    const chunks: string[] = [];
    for (let i = 0; i < serialized.length; i += chunkSize) {
      chunks.push(serialized.slice(i, i + chunkSize));
    }

    this.sendEnvelope({
      type: "canvas_response",
      requestId: message.requestId,
      clientId: message.clientId,
      canvasSessionId: message.canvasSessionId,
      chunked: true,
      payloadId,
      totalChunks: chunks.length
    } satisfies CanvasResponse);

    chunks.forEach((data, index) => {
      const chunk: CanvasChunk = {
        type: "canvas_chunk",
        requestId: message.requestId,
        clientId: message.clientId,
        canvasSessionId: message.canvasSessionId,
        payloadId,
        chunkIndex: index,
        totalChunks: chunks.length,
        data
      };
      this.sendEnvelope(chunk);
    });
  }

  private sendError(message: Pick<CanvasRequest, "requestId" | "clientId" | "canvasSessionId">, error: CanvasError): void {
    this.sendEnvelope({
      type: "canvas_error",
      requestId: message.requestId,
      clientId: message.clientId,
      canvasSessionId: message.canvasSessionId,
      error
    });
  }

  private sendEvent(event: CanvasEvent): void {
    this.sendEnvelope(event);
  }

  private postCanvasState(
    port: chrome.runtime.Port,
    state: CanvasPageState | null,
    type: "canvas-page:init" | "canvas-page:update" | "canvas-page:closed",
    extra: Record<string, unknown> = {}
  ): void {
    try {
      port.postMessage({
        type,
        state,
        ...extra
      } satisfies CanvasPageMessage);
    } catch {
      // ignore disconnected page ports
    }
  }

  private broadcastCanvasState(
    tabId: number,
    type: "canvas-page:init" | "canvas-page:update" | "canvas-page:closed",
    extra: Record<string, unknown> = {}
  ): void {
    const ports = this.pagePorts.get(tabId);
    if (!ports || ports.size === 0) {
      return;
    }
    const state = this.getPageStateByTabId(tabId);
    for (const port of ports) {
      this.postCanvasState(port, state, type, extra);
    }
  }

  private broadcastIfDesignTab(session: OverlayCapableSession): void {
    if (!session.designTabTargetId) {
      return;
    }
    this.broadcastCanvasState(parseTargetId(session.designTabTargetId), "canvas-page:update");
  }

  private async closeRuntimeSession(session: CanvasSessionRecord, reason: string): Promise<void> {
    this.overlaySessions.delete(session.id);
    const released = [...session.targets.values()];
    for (const target of released) {
      this.broadcastCanvasState(target.tabId, "canvas-page:closed", { reason });
      await this.tabs.closeTab(target.tabId).catch(() => undefined);
      this.pagePorts.delete(target.tabId);
    }
    this.sessions.delete(session.id);
    this.sendEvent({
      type: "canvas_event",
      clientId: session.ownerClientId,
      canvasSessionId: session.id,
      event: "canvas_session_expired",
      payload: { reason }
    });
  }

  private async createTab(url: string, previewMode: CanvasPreviewState): Promise<chrome.tabs.Tab> {
    return await new Promise((resolve, reject) => {
      chrome.tabs.create(
        { url, active: previewMode === "focused", pinned: previewMode === "pinned" },
        (tab) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          if (!tab || typeof tab.id !== "number") {
            reject(new Error("Canvas tab creation failed"));
            return;
          }
          resolve(tab);
        }
      );
    });
  }

  private async syncOpsTargetRegistration(session: CanvasSessionRecord): Promise<void> {
    const browserSessionId = readBrowserSessionId(session.summary);
    if (!browserSessionId || !session.designTabTargetId || !this.registerOpsCanvasTarget) {
      return;
    }
    const registered = await this.registerOpsCanvasTarget(browserSessionId, session.designTabTargetId);
    if (registered?.targetId) {
      session.designTabTargetId = registered.targetId;
    }
  }
}

function buildPageState(session: CanvasSessionRecord, tabId: number): CanvasPageState {
  return {
    tabId,
    targetId: formatTargetId(tabId),
    canvasSessionId: session.id,
    documentId: session.document.documentId,
    documentRevision: session.documentRevision,
    title: session.document.title,
    document: session.document,
    html: session.html,
    previewMode: session.previewMode,
    previewState: session.previewState,
    updatedAt: new Date().toISOString(),
    summary: session.summary,
    targets: session.previewTargets,
    overlayMounts: session.overlayMounts,
    feedback: session.feedback,
    feedbackCursor: session.feedbackCursor,
    selection: session.selection,
    viewport: session.viewport,
    pendingMutation: session.pendingMutation
  };
}

function defaultSelection(pageId: string | null): CanvasEditorSelection {
  return {
    pageId,
    nodeId: null,
    targetId: null,
    updatedAt: new Date().toISOString()
  };
}

function normalizeViewport(value: unknown): Partial<CanvasEditorViewport> | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    x: typeof value.x === "number" ? value.x : undefined,
    y: typeof value.y === "number" ? value.y : undefined,
    zoom: typeof value.zoom === "number" ? value.zoom : undefined
  };
}

function normalizeSelection(value: unknown): Partial<CanvasEditorSelection> | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    pageId: typeof value.pageId === "string" || value.pageId === null ? value.pageId : undefined,
    nodeId: typeof value.nodeId === "string" || value.nodeId === null ? value.nodeId : undefined,
    targetId: typeof value.targetId === "string" || value.targetId === null ? value.targetId : undefined
  };
}

function normalizeViewportState(value: unknown): CanvasEditorViewport {
  if (!isRecord(value)) {
    return { ...DEFAULT_EDITOR_VIEWPORT };
  }
  return {
    x: typeof value.x === "number" ? value.x : DEFAULT_EDITOR_VIEWPORT.x,
    y: typeof value.y === "number" ? value.y : DEFAULT_EDITOR_VIEWPORT.y,
    zoom: typeof value.zoom === "number" ? value.zoom : DEFAULT_EDITOR_VIEWPORT.zoom
  };
}

function normalizeSelectionState(value: unknown, defaultPageId: string | null): CanvasEditorSelection {
  if (!isRecord(value)) {
    return defaultSelection(defaultPageId);
  }
  return {
    pageId: typeof value.pageId === "string" || value.pageId === null ? value.pageId : defaultPageId,
    nodeId: typeof value.nodeId === "string" || value.nodeId === null ? value.nodeId : null,
    targetId: typeof value.targetId === "string" || value.targetId === null ? value.targetId : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
  };
}

function requireCanvasDocument(value: unknown): CanvasDocument {
  const document = requireRecord(value, "document");
  const pagesValue = Array.isArray(document.pages) ? document.pages : [];
  return {
    documentId: requireString(document.documentId, "documentId"),
    title: optionalString(document.title) ?? "OpenDevBrowser Canvas",
    updatedAt: optionalString(document.updatedAt) ?? undefined,
    bindings: Array.isArray(document.bindings)
      ? document.bindings.flatMap((bindingValue) => {
        const binding = isRecord(bindingValue) ? bindingValue : null;
        if (!binding || typeof binding.id !== "string" || typeof binding.nodeId !== "string") {
          return [];
        }
        return [{
          id: binding.id,
          nodeId: binding.nodeId,
          kind: optionalString(binding.kind) ?? "component",
          componentName: optionalString(binding.componentName) ?? undefined,
          metadata: isRecord(binding.metadata) ? binding.metadata : {}
        }];
      })
      : [],
    assets: Array.isArray(document.assets)
      ? document.assets.flatMap((assetValue) => {
        const asset = isRecord(assetValue) ? assetValue : null;
        if (!asset || typeof asset.id !== "string") {
          return [];
        }
        return [{
          id: asset.id,
          sourceType: optionalString(asset.sourceType) ?? undefined,
          kind: optionalString(asset.kind) ?? undefined,
          repoPath: optionalString(asset.repoPath),
          url: optionalString(asset.url),
          mime: optionalString(asset.mime) ?? undefined,
          metadata: isRecord(asset.metadata) ? asset.metadata : {}
        }];
      })
      : [],
    componentInventory: Array.isArray(document.componentInventory)
      ? document.componentInventory.flatMap((entry, index) => normalizeComponentInventoryItem(entry, index))
      : [],
    tokens: normalizeTokenStore(document.tokens),
    meta: normalizeDocumentMeta(document.meta),
    pages: pagesValue.flatMap((pageValue) => normalizePage(pageValue))
  };
}

function normalizePage(value: unknown): CanvasPage[] {
  if (!isRecord(value) || typeof value.id !== "string") {
    return [];
  }
  const pageId = value.id;
  return [{
    id: pageId,
    name: typeof value.name === "string" ? value.name : pageId,
    path: typeof value.path === "string" ? value.path : "/",
    rootNodeId: typeof value.rootNodeId === "string" ? value.rootNodeId : null,
    prototypeIds: Array.isArray(value.prototypeIds) ? value.prototypeIds.filter((entry): entry is string => typeof entry === "string") : [],
    nodes: Array.isArray(value.nodes) ? value.nodes.flatMap((entry) => normalizeNode(entry, pageId)) : [],
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeNode(value: unknown, pageId: string): CanvasNode[] {
  if (!isRecord(value) || typeof value.id !== "string") {
    return [];
  }
  return [{
    id: value.id,
    kind: typeof value.kind === "string" ? value.kind : "frame",
    name: typeof value.name === "string" ? value.name : value.id,
    pageId,
    parentId: typeof value.parentId === "string" ? value.parentId : null,
    childIds: Array.isArray(value.childIds) ? value.childIds.filter((entry): entry is string => typeof entry === "string") : [],
    rect: isRecord(value.rect) ? {
      x: typeof value.rect.x === "number" ? value.rect.x : 0,
      y: typeof value.rect.y === "number" ? value.rect.y : 0,
      width: typeof value.rect.width === "number" ? value.rect.width : 240,
      height: typeof value.rect.height === "number" ? value.rect.height : 120
    } : { x: 0, y: 0, width: 240, height: 120 },
    props: isRecord(value.props) ? value.props : {},
    style: isRecord(value.style) ? value.style : {},
    tokenRefs: isRecord(value.tokenRefs) ? value.tokenRefs : {},
    bindingRefs: isRecord(value.bindingRefs) ? value.bindingRefs : {},
    variantPatches: Array.isArray(value.variantPatches) ? value.variantPatches.filter(isRecord) : [],
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeComponentInventoryItem(value: unknown, index: number): CanvasDocument["componentInventory"] {
  if (!isRecord(value)) {
    return [];
  }
  const id = optionalString(value.id) ?? `inventory_${index + 1}`;
  const name = optionalString(value.name) ?? optionalString(value.componentName) ?? id;
  return [{
    id,
    name,
    componentName: optionalString(value.componentName),
    sourceKind: optionalString(value.sourceKind),
    sourceFamily: optionalString(value.sourceFamily) ?? undefined,
    origin: optionalString(value.origin) ?? undefined,
    framework: normalizeComponentRef(value.framework),
    adapter: normalizeComponentRef(value.adapter),
    plugin: normalizeComponentRef(value.plugin),
    variants: Array.isArray(value.variants) ? value.variants.filter(isRecord) : [],
    props: Array.isArray(value.props) ? value.props.filter(isRecord) : [],
    slots: Array.isArray(value.slots) ? value.slots.filter(isRecord) : [],
    events: Array.isArray(value.events) ? value.events.filter(isRecord) : [],
    content: isRecord(value.content) ? value.content : {},
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeComponentRef(value: unknown): CanvasDocument["componentInventory"][number]["framework"] {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    label: optionalString(value.label) ?? optionalString(value.name),
    packageName: optionalString(value.packageName) ?? undefined,
    version: optionalString(value.version) ?? undefined,
    metadata: isRecord(value.metadata) ? value.metadata : {}
  };
}

function normalizeTokenStore(value: unknown): CanvasDocument["tokens"] {
  if (!isRecord(value)) {
    return { values: {}, collections: [], aliases: [], bindings: [], metadata: {} };
  }
  const structured = "values" in value || "collections" in value || "aliases" in value || "bindings" in value || "metadata" in value;
  return {
    values: structured && isRecord(value.values) ? value.values : structured ? {} : value,
    collections: Array.isArray(value.collections) ? value.collections.flatMap((entry) => normalizeTokenCollection(entry)) : [],
    aliases: Array.isArray(value.aliases) ? value.aliases.flatMap((entry) => normalizeTokenAlias(entry)) : [],
    bindings: Array.isArray(value.bindings) ? value.bindings.flatMap((entry) => normalizeTokenBinding(entry)) : [],
    metadata: isRecord(value.metadata) ? value.metadata : {}
  };
}

function normalizeTokenCollection(value: unknown): CanvasDocument["tokens"]["collections"] {
  if (!isRecord(value) || typeof value.id !== "string") {
    return [];
  }
  return [{
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    items: Array.isArray(value.items) ? value.items.flatMap((entry) => normalizeTokenItem(entry)) : [],
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeTokenItem(value: unknown): CanvasDocument["tokens"]["collections"][number]["items"] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.path !== "string") {
    return [];
  }
  return [{
    id: value.id,
    path: normalizeTokenPath(value.path),
    value: value.value,
    type: typeof value.type === "string" ? value.type : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    modes: Array.isArray(value.modes) ? value.modes.flatMap((entry) => normalizeTokenMode(entry)) : [],
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeTokenMode(value: unknown): CanvasDocument["tokens"]["collections"][number]["items"][number]["modes"] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return [];
  }
  return [{
    id: value.id,
    name: value.name,
    value: value.value,
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeTokenAlias(value: unknown): CanvasDocument["tokens"]["aliases"] {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.targetPath !== "string") {
    return [];
  }
  return [{
    path: normalizeTokenPath(value.path),
    targetPath: normalizeTokenPath(value.targetPath),
    modeId: typeof value.modeId === "string" ? value.modeId : null,
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeTokenBinding(value: unknown): CanvasDocument["tokens"]["bindings"] {
  if (!isRecord(value) || typeof value.path !== "string") {
    return [];
  }
  return [{
    path: normalizeTokenPath(value.path),
    nodeId: typeof value.nodeId === "string" ? value.nodeId : null,
    bindingId: typeof value.bindingId === "string" ? value.bindingId : null,
    property: typeof value.property === "string" ? value.property : null,
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeTokenPath(path: string): string {
  return path.trim().replace(/^tokens\./, "");
}

function normalizeDocumentMeta(value: unknown): CanvasDocument["meta"] {
  if (!isRecord(value)) {
    return { imports: [], starter: null, adapterPlugins: [], pluginErrors: [], metadata: {} };
  }
  return {
    imports: Array.isArray(value.imports) ? value.imports.filter(isRecord) : [],
    starter: isRecord(value.starter) ? value.starter : null,
    adapterPlugins: Array.isArray(value.adapterPlugins) ? value.adapterPlugins.filter(isRecord) : [],
    pluginErrors: Array.isArray(value.pluginErrors)
      ? value.pluginErrors.flatMap((entry) => normalizePluginError(entry))
      : [],
    metadata: isRecord(value.metadata) ? value.metadata : {}
  };
}

function normalizePluginError(value: unknown): CanvasDocument["meta"]["pluginErrors"] {
  if (!isRecord(value)) {
    return [];
  }
  const code = optionalString(value.code);
  const message = optionalString(value.message);
  if (!code || !message) {
    return [];
  }
  return [{
    pluginId: optionalString(value.pluginId),
    code,
    message,
    details: isRecord(value.details) ? value.details : {}
  }];
}

function requireRenderedHtml(record: Record<string, unknown>): string {
  return requireString(record.html, "html");
}

function normalizeRect(value: unknown): { x: number; y: number; width: number; height: number } {
  if (!isRecord(value)) {
    return { x: 0, y: 0, width: 320, height: 180 };
  }
  return {
    x: typeof value.x === "number" ? value.x : 0,
    y: typeof value.y === "number" ? value.y : 0,
    width: typeof value.width === "number" ? value.width : 320,
    height: typeof value.height === "number" ? value.height : 180
  };
}

function parseOverlayMounts(value: unknown): CanvasOverlayMountSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const mountId = optionalString(entry.mountId);
    const targetId = optionalString(entry.targetId);
    const mountedAt = optionalString(entry.mountedAt);
    return mountId && targetId && mountedAt
      ? [{ mountId, targetId, mountedAt }]
      : [];
  });
}

function parseFeedbackEvents(value: unknown): CanvasFeedbackEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const events: CanvasFeedbackEvent[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    if (entry.eventType === "feedback.item" && isRecord(entry.item)) {
      const item = entry.item;
      const id = optionalString(item.id);
      const cursor = optionalString(item.cursor);
      const documentId = optionalString(item.documentId);
      if (!id || !cursor || !documentId) {
        continue;
      }
      events.push({
        eventType: "feedback.item",
        item: {
          id,
          cursor,
          category: optionalString(item.category) ?? "validation",
          class: optionalString(item.class) ?? "feedback",
          severity: optionalString(item.severity) ?? "info",
          message: optionalString(item.message) ?? "",
          documentId,
          documentRevision: typeof item.documentRevision === "number" ? item.documentRevision : 0,
          pageId: optionalString(item.pageId),
          prototypeId: optionalString(item.prototypeId),
          targetId: optionalString(item.targetId),
          evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs.filter((ref): ref is string => typeof ref === "string") : [],
          details: isRecord(item.details) ? item.details : {}
        } satisfies CanvasFeedbackItem
      });
      continue;
    }
    if (entry.eventType === "feedback.heartbeat") {
      events.push({
        eventType: "feedback.heartbeat",
        cursor: optionalString(entry.cursor),
        ts: optionalString(entry.ts) ?? new Date().toISOString(),
        activeTargetIds: Array.isArray(entry.activeTargetIds) ? entry.activeTargetIds.filter((id): id is string => typeof id === "string") : []
      });
      continue;
    }
    if (entry.eventType === "feedback.complete") {
      const reason = optionalString(entry.reason);
      if (!reason) {
        continue;
      }
      events.push({
        eventType: "feedback.complete",
        cursor: optionalString(entry.cursor),
        ts: optionalString(entry.ts) ?? new Date().toISOString(),
        reason: reason as "session_closed" | "lease_revoked" | "subscription_replaced" | "document_unloaded"
      });
      continue;
    }
  }
  return events;
}

function lastFeedbackCursor(events: CanvasFeedbackEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const entry = events[index];
    if (entry?.eventType === "feedback.item") {
      return entry.item.cursor;
    }
    if (entry?.eventType === "feedback.heartbeat" || entry?.eventType === "feedback.complete") {
      return entry.cursor;
    }
  }
  return null;
}

function dedupeOverlayMounts(mounts: CanvasOverlayMountSummary[]): CanvasOverlayMountSummary[] {
  const byId = new Map<string, CanvasOverlayMountSummary>();
  for (const mount of mounts) {
    byId.set(mount.mountId, mount);
  }
  return [...byId.values()];
}

function resolveDesignTabOverlaySelection(
  document: CanvasDocument,
  nodeId: string | null,
  selectionHint: Record<string, unknown>
): Record<string, unknown> {
  const selector = typeof selectionHint.selector === "string" && selectionHint.selector.trim().length > 0
    ? selectionHint.selector.trim()
    : null;
  const resolvedNodeId = nodeId
    ?? readNodeIdFromSelector(selector)
    ?? null;
  if (!resolvedNodeId) {
    return { matched: false, selector };
  }
  const node = findDocumentNode(document, resolvedNodeId);
  if (!node) {
    return { matched: false, selector: selector ?? `[data-node-id="${resolvedNodeId}"]` };
  }
  const text = typeof node.props.text === "string" ? node.props.text : null;
  return {
    matched: true,
    selector: selector ?? `[data-node-id="${resolvedNodeId}"]`,
    nodeId: resolvedNodeId,
    tagName: "div",
    text: text ? text.slice(0, 160) : "",
    id: null,
    className: "canvas-stage-node"
  };
}

function readNodeIdFromSelector(selector: string | null): string | null {
  if (!selector) {
    return null;
  }
  const match = selector.match(/^\[data-node-id=["']([^"'\\]]+)["']\]$/);
  return match?.[1] ?? null;
}

function findDocumentNode(document: CanvasDocument, nodeId: string): CanvasNode | null {
  for (const page of document.pages) {
    const node = page.nodes.find((entry) => entry.id === nodeId);
    if (node) {
      return node;
    }
  }
  return null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function resolveCanvasSessionId(message: CanvasRequest, payload: Record<string, unknown>): string {
  return optionalString(message.canvasSessionId)
    ?? optionalString(payload.canvasSessionId)
    ?? optionalString(isRecord(payload.summary) ? payload.summary.canvasSessionId : undefined)
    ?? createCoordinatorId();
}

function readBrowserSessionId(summary: CanvasSessionSummary | undefined): string | null {
  if (!summary) {
    return null;
  }
  return optionalString(summary.browserSessionId);
}

function resolveSessionForMessage(
  sessions: TargetSessionCoordinator<CanvasSessionExtra>,
  message: CanvasRequest,
  payload: Record<string, unknown>
): CanvasSessionRecord {
  const directId = optionalString(message.canvasSessionId)
    ?? optionalString(payload.canvasSessionId)
    ?? optionalString(isRecord(payload.summary) ? payload.summary.canvasSessionId : undefined);
  if (directId) {
    return sessions.requireSession(directId);
  }
  const targetId = optionalString(payload.targetId);
  if (targetId) {
    const session = sessions.getByTabId(parseTargetId(targetId));
    if (session) {
      return session;
    }
  }
  throw missingCanvasSession();
}

function missingCanvasSession(): Error {
  return new Error("Missing canvasSessionId");
}

function isIgnorableCanvasCloseLookupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Unknown sessionId:") || message === "Missing canvasSessionId";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireEnum<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as T;
}

function normalizePreviewState(value: unknown): CanvasPreviewState | null {
  return value === "focused" || value === "pinned" || value === "background" || value === "degraded"
    ? value
    : null;
}

function parseTargetId(targetId: string): number {
  const raw = targetId.startsWith("tab-") ? targetId.slice(4) : targetId;
  const tabId = Number(raw);
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error(`Invalid targetId: ${targetId}`);
  }
  return tabId;
}

function formatTargetId(tabId: number | undefined): string {
  if (!Number.isInteger(tabId)) {
    throw new Error("Tab id unavailable");
  }
  return `tab-${tabId}`;
}

function requireTabId(tab: chrome.tabs.Tab): number {
  const tabId = tab.id;
  if (typeof tabId !== "number" || !Number.isInteger(tabId)) {
    throw new Error("Canvas tab creation failed");
  }
  return tabId;
}

async function insertCss(tabId: number, css: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.scripting.insertCSS({ target: { tabId }, css }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function executeInTab<TArg, TResult>(tabId: number, func: (arg: TArg) => TResult, args: [TArg]): Promise<TResult> {
  return await new Promise<TResult>((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, func: func as never, args },
      (results) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        const [first] = results ?? [];
        resolve((first?.result ?? null) as TResult);
      }
    );
  });
}

function mountOverlayScript(input: { mountId: string; cssText: string; title: string; prototypeId: string; selection: CanvasEditorSelection }): { previewState: string } {
  const styleId = "opendevbrowser-canvas-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = input.cssText;
    document.head.append(style);
  }
  document.getElementById(input.mountId)?.remove();
  const root = document.createElement("div");
  root.id = input.mountId;
  root.className = "opendevbrowser-canvas-overlay";
  const heading = document.createElement("strong");
  heading.textContent = input.title;
  const detail = document.createElement("div");
  detail.textContent = input.selection.nodeId ? `Selected ${input.selection.nodeId}` : input.prototypeId;
  root.append(heading, detail);
  document.body.append(root);
  if (input.selection.nodeId) {
    const element = document.querySelector(`[data-node-id="${input.selection.nodeId}"]`);
    if (element instanceof HTMLElement) {
      element.classList.add("opendevbrowser-canvas-highlight");
    }
  }
  return { previewState: "overlay_mounted" };
}

function unmountOverlayScript(mountId: string): boolean {
  document.getElementById(mountId)?.remove();
  document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
    element.classList.remove("opendevbrowser-canvas-highlight");
  });
  return true;
}

function selectOverlayScript(input: { selectionHint: Record<string, unknown>; nodeId: string | null }): Record<string, unknown> {
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
    className: element.className || null
  };
}

function syncOverlayScript(input: { mountId: string; title: string; selection: CanvasEditorSelection }): { overlayState: string } {
  let root = document.getElementById(input.mountId);
  if (!(root instanceof HTMLElement)) {
    root = document.createElement("div");
    root.id = input.mountId;
    root.className = "opendevbrowser-canvas-overlay";
    const heading = document.createElement("strong");
    heading.textContent = input.title;
    const detail = document.createElement("div");
    detail.textContent = input.selection.nodeId ? `Selected ${input.selection.nodeId}` : "Canvas overlay synced";
    root.append(heading, detail);
    document.body.append(root);
  }
  const strong = root.querySelector("strong");
  if (strong) {
    strong.textContent = input.title;
  }
  const detail = root.querySelector("div");
  if (detail) {
    detail.textContent = input.selection.nodeId ? `Selected ${input.selection.nodeId}` : "Canvas overlay synced";
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
  return { overlayState: "mounted" };
}

function normalizeCanvasError(error: unknown): CanvasError {
  if (error instanceof Error) {
    const message = error.message;
    const restricted = message.includes("Cannot access") || message.includes("chrome://") || message.includes("restricted");
    return {
      code: restricted ? "restricted_url" : "execution_failed",
      message,
      retryable: false
    };
  }
  return {
    code: "execution_failed",
    message: "Canvas request failed",
    retryable: false
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
