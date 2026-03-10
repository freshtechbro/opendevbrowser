import {
  CANVAS_PROTOCOL_VERSION,
  MAX_CANVAS_PAYLOAD_BYTES,
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
import type {
  CanvasDocument,
  CanvasEditorSelection,
  CanvasEditorViewport,
  CanvasFeedbackEvent,
  CanvasFeedbackItem,
  CanvasOverlayMountSummary,
  CanvasPage,
  CanvasPageMessage,
  CanvasPagePortMessage,
  CanvasPageState,
  CanvasPreviewState,
  CanvasTargetStateSummary,
  CanvasNode
} from "./model.js";

type CanvasRuntimeOptions = {
  send: (message: CanvasEnvelope) => void;
};

type CanvasSessionExtra = {
  designTabTargetId: string | null;
  document: CanvasDocument;
  documentRevision: number | null;
  html: string;
  summary: Record<string, unknown>;
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
  private readonly tabs = new TabManager();
  private readonly sessions = new TargetSessionCoordinator<CanvasSessionExtra>();
  private readonly pagePorts = new Map<number, Set<chrome.runtime.Port>>();

  constructor(options: CanvasRuntimeOptions) {
    this.sendEnvelope = options.send;
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
      void this.closeRuntimeSession(session, "client_disconnected");
    }
  }

  private handlePagePortMessage(tabId: number, message: CanvasPagePortMessage): void {
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
      this.mergeEditorState(session, undefined, message.selection);
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
          selection: session.selection
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
    const session = this.requireSessionForMessage(message);
    const record = requireRecord(message.payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const targetId = formatTargetId(tabId);
    this.broadcastCanvasState(tabId, "canvas-page:closed", { reason: "target_closed" });
    session.designTabTargetId = null;
    session.pendingMutation = false;
    this.pagePorts.delete(tabId);
    this.sessions.removeTarget(session.id, targetId);
    await this.tabs.closeTab(tabId);
    this.sendEvent({
      type: "canvas_event",
      clientId: session.ownerClientId,
      canvasSessionId: session.id,
      event: "canvas_target_closed",
      payload: { targetId, tabId }
    });
    if (session.targets.size === 0) {
      this.sessions.delete(session.id);
      this.sendEvent({
        type: "canvas_event",
        clientId: session.ownerClientId,
        canvasSessionId: session.id,
        event: "canvas_session_closed",
        payload: { reason: "target_closed" }
      });
    }
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
    session.document = requireCanvasDocument(record.document);
    session.documentRevision = optionalNumber(record.documentRevision);
    session.html = renderCanvasDocumentHtml(session.document);
    session.summary = isRecord(record.summary) ? record.summary : {};
    session.previewTargets = parseTargetSummaries(record.targets ?? session.summary.targets);
    session.overlayMounts = parseOverlayMounts(record.overlayMounts ?? session.summary.overlayMounts);
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
    const session = this.requireSessionForMessage(message);
    const record = requireRecord(message.payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const prototypeId = optionalString(record.prototypeId) ?? "default";
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
    const session = this.requireSessionForMessage(message);
    const record = requireRecord(message.payload, "payload");
    const mountId = requireString(record.mountId, "mountId");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
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
    const session = this.requireSessionForMessage(message);
    const record = requireRecord(message.payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const selectionHint = isRecord(record.selectionHint) ? record.selectionHint : {};
    const nodeId = optionalString(record.nodeId);
    const selection = await executeInTab(tabId, selectOverlayScript, [{ selectionHint, nodeId }]);
    if (typeof nodeId === "string") {
      session.selection = {
        pageId: session.document.pages[0]?.id ?? null,
        nodeId,
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
    const session = this.requireSessionForMessage(message);
    const record = requireRecord(message.payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const mountId = requireString(record.mountId, "mountId");
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
    const existing = this.sessions.get(canvasSessionId);
    if (existing) {
      if (existing.ownerClientId !== clientId || (requestedLeaseId && existing.leaseId !== requestedLeaseId)) {
        throw new Error("Canvas session ownership mismatch.");
      }
      if (existing.designTabTargetId && existing.designTabTargetId !== formatTargetId(tabId)) {
        void this.tabs.closeTab(parseTargetId(existing.designTabTargetId)).catch(() => undefined);
      }
      existing.designTabTargetId = formatTargetId(tabId);
      existing.document = document;
      existing.documentRevision = optionalNumber(record.documentRevision);
      existing.html = renderCanvasDocumentHtml(document);
      existing.summary = isRecord(record.summary) ? record.summary : {};
      existing.previewTargets = parseTargetSummaries(record.targets ?? existing.summary.targets);
      existing.overlayMounts = parseOverlayMounts(record.overlayMounts ?? existing.summary.overlayMounts);
      existing.feedback = parseFeedbackEvents(record.feedback);
      existing.feedbackCursor = optionalString(record.feedbackCursor) ?? lastFeedbackCursor(existing.feedback);
      existing.previewMode = previewMode;
      existing.previewState = previewMode;
      existing.pendingMutation = false;
      this.sessions.addTarget(existing.id, tabId, { title: document.title, url: chrome.runtime.getURL("canvas.html") });
      this.sessions.setActiveTarget(existing.id, formatTargetId(tabId));
      return existing;
    }
    const leaseId = requestedLeaseId ?? createCoordinatorId();
    const session = this.sessions.createSession(clientId, tabId, leaseId, {
      title: document.title,
      url: chrome.runtime.getURL("canvas.html")
    }, {
      designTabTargetId: formatTargetId(tabId),
      document,
      documentRevision: optionalNumber(record.documentRevision),
      html: renderCanvasDocumentHtml(document),
      summary: isRecord(record.summary) ? record.summary : {},
      previewMode,
      previewState: previewMode,
      previewTargets: parseTargetSummaries(record.targets ?? (isRecord(record.summary) ? record.summary.targets : undefined)),
      overlayMounts: parseOverlayMounts(record.overlayMounts ?? (isRecord(record.summary) ? record.summary.overlayMounts : undefined)),
      feedback: parseFeedbackEvents(record.feedback),
      feedbackCursor: optionalString(record.feedbackCursor) ?? lastFeedbackCursor(parseFeedbackEvents(record.feedback)),
      selection: defaultSelection(document.pages[0]?.id ?? null),
      viewport: { x: 120, y: 96, zoom: 1 },
      pendingMutation: false
    }, canvasSessionId);
    return session;
  }

  private requireSessionForMessage(message: CanvasRequest, record?: Record<string, unknown>): CanvasSessionRecord {
    const payload = record ?? (isRecord(message.payload) ? message.payload : {});
    const session = resolveSessionForMessage(this.sessions, message, payload);
    const clientId = requireString(message.clientId, "clientId");
    const leaseId = optionalString(message.leaseId);
    if (session.ownerClientId !== clientId || (leaseId && session.leaseId !== leaseId)) {
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

  private sendResponse(message: CanvasRequest, payload: unknown): void {
    const response: CanvasResponse = {
      type: "canvas_response",
      requestId: message.requestId,
      clientId: message.clientId,
      canvasSessionId: message.canvasSessionId,
      payload
    };
    this.sendEnvelope(response);
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
    type: CanvasPageMessage["type"],
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

  private broadcastCanvasState(tabId: number, type: CanvasPageMessage["type"], extra: Record<string, unknown> = {}): void {
    const ports = this.pagePorts.get(tabId);
    if (!ports || ports.size === 0) {
      return;
    }
    const state = this.getPageStateByTabId(tabId);
    for (const port of ports) {
      this.postCanvasState(port, state, type, extra);
    }
  }

  private broadcastIfDesignTab(session: CanvasSessionRecord): void {
    if (!session.designTabTargetId) {
      return;
    }
    this.broadcastCanvasState(parseTargetId(session.designTabTargetId), "canvas-page:update");
  }

  private async closeRuntimeSession(session: CanvasSessionRecord, reason: string): Promise<void> {
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

function requireCanvasDocument(value: unknown): CanvasDocument {
  const document = requireRecord(value, "document");
  const pagesValue = Array.isArray(document.pages) ? document.pages : [];
  return {
    documentId: requireString(document.documentId, "documentId"),
    title: optionalString(document.title) ?? "OpenDevBrowser Canvas",
    updatedAt: optionalString(document.updatedAt) ?? undefined,
    pages: pagesValue.map((pageValue) => {
      const page = requireRecord(pageValue, "page");
      const nodesValue = Array.isArray(page.nodes) ? page.nodes : [];
      return {
        id: requireString(page.id, "page.id"),
        name: optionalString(page.name) ?? requireString(page.id, "page.id"),
        path: optionalString(page.path) ?? "/",
        rootNodeId: optionalString(page.rootNodeId) ?? null,
        prototypeIds: Array.isArray(page.prototypeIds) ? page.prototypeIds.filter((entry): entry is string => typeof entry === "string") : [],
        nodes: nodesValue.map((nodeValue) => {
          const node = requireRecord(nodeValue, "node");
          return {
            id: requireString(node.id, "node.id"),
            kind: optionalString(node.kind) ?? "frame",
            name: optionalString(node.name) ?? "node",
            pageId: optionalString(node.pageId) ?? undefined,
            parentId: optionalString(node.parentId),
            childIds: Array.isArray(node.childIds) ? node.childIds.filter((entry): entry is string => typeof entry === "string") : [],
            rect: normalizeRect(node.rect),
            props: isRecord(node.props) ? node.props : {},
            style: isRecord(node.style) ? node.style : {},
            metadata: isRecord(node.metadata) ? node.metadata : {}
          } satisfies CanvasNode;
        }),
        metadata: isRecord(page.metadata) ? page.metadata : {}
      } satisfies CanvasPage;
    })
  };
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

function parseTargetSummaries(value: unknown): CanvasTargetStateSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const targetId = optionalString(entry.targetId);
    const prototypeId = optionalString(entry.prototypeId);
    const previewMode = normalizePreviewState(entry.previewMode);
    const previewState = normalizePreviewState(entry.previewState);
    if (!targetId || !prototypeId || !previewMode || !previewState) {
      return [];
    }
    return [{
      targetId,
      prototypeId,
      previewMode,
      previewState,
      renderStatus: optionalString(entry.renderStatus) ?? undefined,
      degradeReason: optionalString(entry.degradeReason),
      lastRenderedAt: optionalString(entry.lastRenderedAt) ?? undefined
    }];
  });
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCanvasDocumentHtml(document: CanvasDocument): string {
  const pages = document.pages.map((page) => renderPageHtml(page)).join("\n");
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `  <title>${escapeHtml(document.title)}</title>`,
    "  <style>",
    "    body { margin: 0; font-family: 'Segoe UI', sans-serif; background: #07111d; color: #f3f6fb; }",
    "    .odb-canvas-root { display: grid; gap: 24px; padding: 24px; }",
    "    .odb-canvas-page { position: relative; min-height: 900px; border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 24px; background: rgba(12,20,33,0.84); overflow: hidden; }",
    "    .odb-canvas-node { position: absolute; display: grid; align-content: start; border-radius: 18px; border: 1px solid rgba(255,255,255,0.12); background: rgba(8,19,31,0.82); padding: 12px; overflow: hidden; }",
    "    .odb-canvas-text { font-size: 1rem; line-height: 1.5; }",
    "    .odb-canvas-note { border-left: 3px solid #20d5c6; color: #9aa6bd; }",
    "  </style>",
    "</head>",
    "<body>",
    `  <main class="odb-canvas-root" data-document-id="${escapeHtml(document.documentId)}">`,
    pages,
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function renderPageHtml(page: CanvasPage): string {
  const nodes = page.nodes.map((node) => renderNodeHtml(node)).join("");
  return `<section class="odb-canvas-page" data-page-id="${escapeHtml(page.id)}">${nodes}</section>`;
}

function renderNodeHtml(node: CanvasNode): string {
  const attrs = [
    `class="odb-canvas-node odb-canvas-${escapeHtml(node.kind)}"`,
    `data-node-id="${escapeHtml(node.id)}"`,
    `style="${inlineStyle(node)}"`
  ].join(" ");
  const text = renderTextContent(node);
  return node.kind === "text"
    ? `<p ${attrs}>${text}</p>`
    : node.kind === "note"
      ? `<aside ${attrs}>${text}</aside>`
      : `<div ${attrs}>${text}</div>`;
}

function renderTextContent(node: CanvasNode): string {
  const raw = node.props.text ?? node.metadata.text ?? node.name;
  return escapeHtml(typeof raw === "string" ? raw : String(raw ?? ""));
}

function inlineStyle(node: CanvasNode): string {
  const stylePairs = Object.entries(node.style)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${String(value)}`);
  stylePairs.push(`left:${node.rect.x}px`);
  stylePairs.push(`top:${node.rect.y}px`);
  stylePairs.push(`width:${Math.max(node.rect.width, 80)}px`);
  stylePairs.push(`height:${Math.max(node.rect.height, 48)}px`);
  return stylePairs.join(";");
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
  const root = document.getElementById(input.mountId);
  if (!(root instanceof HTMLElement)) {
    return { overlayState: "missing" };
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
