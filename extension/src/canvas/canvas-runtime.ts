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

type CanvasRuntimeOptions = {
  send: (message: CanvasEnvelope) => void;
};

type CanvasNode = {
  id: string;
  kind: string;
  name: string;
  props: Record<string, unknown>;
  style: Record<string, unknown>;
  metadata: Record<string, unknown>;
  childIds: string[];
};

type CanvasPage = {
  id: string;
  rootNodeId: string | null;
  nodes: CanvasNode[];
};

type CanvasDocument = {
  documentId: string;
  title: string;
  pages: CanvasPage[];
};

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

  constructor(options: CanvasRuntimeOptions) {
    this.sendEnvelope = options.send;
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
        "canvas.overlay.select"
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

  private async handleRequest(message: CanvasRequest): Promise<void> {
    switch (message.command) {
      case "canvas.tab.open":
        this.sendResponse(message, await this.openTab(message.payload));
        return;
      case "canvas.tab.close":
        this.sendResponse(message, await this.closeTab(message.payload));
        return;
      case "canvas.tab.sync":
        this.sendResponse(message, await this.syncTab(message.payload));
        return;
      case "canvas.overlay.mount":
        this.sendResponse(message, await this.mountOverlay(message.payload));
        return;
      case "canvas.overlay.unmount":
        this.sendResponse(message, await this.unmountOverlay(message.payload));
        return;
      case "canvas.overlay.select":
        this.sendResponse(message, await this.selectOverlay(message.payload));
        return;
      default:
        this.sendError(message, {
          code: "not_supported",
          message: `Unsupported canvas command: ${message.command}`,
          retryable: false
        });
    }
  }

  private async openTab(payload: unknown): Promise<Record<string, unknown>> {
    const record = requireRecord(payload, "payload");
    const document = requireCanvasDocument(record.document);
    const previewMode = requireEnum(record.previewMode, "previewMode", ["focused", "pinned", "background"]);
    const html = renderCanvasDocumentHtml(document);
    const tab = await this.createTab(toDataUrl(html), previewMode);
    return {
      targetId: formatTargetId(tab.id),
      previewState: "design_tab_open"
    };
  }

  private async closeTab(payload: unknown): Promise<Record<string, unknown>> {
    const record = requireRecord(payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    await this.tabs.closeTab(tabId);
    const event: CanvasEvent = {
      type: "canvas_event",
      clientId: undefined,
      event: "canvas_target_closed",
      payload: { targetId: formatTargetId(tabId), tabId }
    };
    this.sendEnvelope(event);
    return {
      ok: true,
      targetId: formatTargetId(tabId),
      previewState: "design_tab_closed"
    };
  }

  private async syncTab(payload: unknown): Promise<Record<string, unknown>> {
    const record = requireRecord(payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const document = requireCanvasDocument(record.document);
    const html = renderCanvasDocumentHtml(document);
    await this.updateTab(tabId, toDataUrl(html));
    return {
      ok: true,
      targetId: formatTargetId(tabId),
      previewState: "design_tab_open"
    };
  }

  private async mountOverlay(payload: unknown): Promise<Record<string, unknown>> {
    const record = requireRecord(payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const prototypeId = optionalString(record.prototypeId) ?? "default";
    const document = isRecord(record.document) ? requireCanvasDocument(record.document) : null;
    await insertCss(tabId, OVERLAY_STYLE);
    const mountId = `mount_${crypto.randomUUID()}`;
    const result = await executeInTab(tabId, mountOverlayScript, [{
      mountId,
      cssText: OVERLAY_STYLE,
      title: document?.title ?? "OpenDevBrowser Canvas",
      prototypeId
    }]);
    return {
      mountId,
      targetId: formatTargetId(tabId),
      previewState: result?.previewState ?? "overlay_mounted",
      capabilities: { selection: true, guides: true }
    };
  }

  private async unmountOverlay(payload: unknown): Promise<Record<string, unknown>> {
    const record = requireRecord(payload, "payload");
    const mountId = requireString(record.mountId, "mountId");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    await executeInTab(tabId, unmountOverlayScript, [mountId]);
    return {
      ok: true,
      mountId,
      previewState: "overlay_idle"
    };
  }

  private async selectOverlay(payload: unknown): Promise<Record<string, unknown>> {
    const record = requireRecord(payload, "payload");
    const tabId = parseTargetId(requireString(record.targetId, "targetId"));
    const selectionHint = isRecord(record.selectionHint) ? record.selectionHint : {};
    const nodeId = optionalString(record.nodeId);
    const selection = await executeInTab(tabId, selectOverlayScript, [{ selectionHint, nodeId }]);
    return {
      targetId: formatTargetId(tabId),
      selection
    };
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

  private async createTab(url: string, previewMode: "focused" | "pinned" | "background"): Promise<chrome.tabs.Tab> {
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

  private async updateTab(tabId: number, url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.update(tabId, { url }, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
    });
  }
}

function requireCanvasDocument(value: unknown): CanvasDocument {
  const document = requireRecord(value, "document");
  const pagesValue = document.pages;
  if (!Array.isArray(pagesValue)) {
    throw new Error("Invalid document");
  }
  return {
    documentId: requireString(document.documentId, "documentId"),
    title: optionalString(document.title) ?? "OpenDevBrowser Canvas",
    pages: pagesValue.map((pageValue) => {
      const page = requireRecord(pageValue, "page");
      const nodesValue = Array.isArray(page.nodes) ? page.nodes : [];
      return {
        id: requireString(page.id, "page.id"),
        rootNodeId: optionalString(page.rootNodeId) ?? null,
        nodes: nodesValue.map((nodeValue) => {
          const node = requireRecord(nodeValue, "node");
          return {
            id: requireString(node.id, "node.id"),
            kind: optionalString(node.kind) ?? "frame",
            name: optionalString(node.name) ?? "node",
            props: isRecord(node.props) ? node.props : {},
            style: isRecord(node.style) ? node.style : {},
            metadata: isRecord(node.metadata) ? node.metadata : {},
            childIds: Array.isArray(node.childIds) ? node.childIds.filter((entry): entry is string => typeof entry === "string") : []
          };
        })
      };
    })
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
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

function requireEnum<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as T;
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

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nodeClassName(node: CanvasNode): string {
  const safeName = node.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return ["odb-canvas-node", `odb-canvas-${node.kind}`, safeName || undefined].filter(Boolean).join(" ");
}

function renderTextContent(node: CanvasNode): string {
  const raw = node.props.text ?? node.metadata.text ?? node.name;
  return escapeHtml(typeof raw === "string" ? raw : String(raw ?? ""));
}

function inlineStyle(node: CanvasNode): string {
  const pairs = Object.entries(node.style)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${String(value)}`);
  return pairs.length > 0 ? ` style="${pairs.join(";")}"` : "";
}

function renderNodeHtml(page: CanvasPage, nodeId: string): string {
  const node = page.nodes.find((entry) => entry.id === nodeId);
  if (!node) return "";
  const children = node.childIds.map((childId) => renderNodeHtml(page, childId)).join("");
  const attrs = ` class="${nodeClassName(node)}" data-node-id="${escapeHtml(node.id)}"${inlineStyle(node)}`;
  switch (node.kind) {
    case "text":
      return `<p${attrs}>${renderTextContent(node)}</p>`;
    case "note":
      return `<aside${attrs}>${renderTextContent(node)}${children}</aside>`;
    case "connector":
      return `<hr${attrs} />`;
    case "shape":
      return `<div${attrs}>${children}</div>`;
    default:
      return `<div${attrs}>${children || renderTextContent(node)}</div>`;
  }
}

function renderCanvasDocumentHtml(document: CanvasDocument): string {
  const pages = document.pages.map((page) => {
    const body = page.rootNodeId ? renderNodeHtml(page, page.rootNodeId) : "";
    return `<section class="odb-canvas-page" data-page-id="${escapeHtml(page.id)}">${body}</section>`;
  }).join("\n");
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
    "    .odb-canvas-page { border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 24px; background: rgba(12,20,33,0.84); }",
    "    .odb-canvas-node { display: block; }",
    "    .odb-canvas-text { font-size: 1rem; line-height: 1.5; }",
    "    .odb-canvas-note { border-left: 3px solid #20d5c6; padding-left: 12px; color: #9aa6bd; }",
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

function mountOverlayScript(input: { mountId: string; cssText: string; title: string; prototypeId: string }): { previewState: string } {
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
  detail.textContent = input.prototypeId;
  root.append(heading, detail);
  document.body.append(root);
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
