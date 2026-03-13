import {
  type CanvasDocument,
  type CanvasEditorSelection,
  type CanvasEditorViewport,
  type CanvasFeedbackEvent,
  type CanvasNode,
  type CanvasPageElementAction,
  type CanvasPageMessage,
  type CanvasPagePortMessage,
  type CanvasPageState,
  type CanvasSessionSummary,
  summarizeCanvasProjectionState,
  normalizeCanvasSessionSummary,
  normalizeCanvasTargetStateSummaries
} from "./canvas/model.js";
import {
  buildCanvasAnnotationPayload,
  describeAnnotationItem,
  type CanvasAnnotationDraft
} from "./annotation-payload.js";
import {
  DEFAULT_EDITOR_VIEWPORT,
  computeFittedViewport,
  computeViewportCanvasCenter,
  isDefaultEditorViewport
} from "./canvas/viewport-fit.js";
import type {
  AnnotationDispatchSource,
  PopupAnnotationSendPayloadResponse
} from "./types.js";

const DB_NAME = "opendevbrowser-canvas";
const DB_VERSION = 2;
const STORE_NAME = "editor-state";
const CHANNEL_NAME = "opendevbrowser-canvas";
const SAVE_DEBOUNCE_MS = 180;
const UNIT_LESS_STYLES = new Set(["fontWeight", "lineHeight", "opacity", "zIndex"]);

const titleElement = requiredElement("canvas-title");
const badgesElement = requiredElement("canvas-badges");
const metaElement = requiredElement("canvas-meta");
const toolbarMetaElement = requiredElement("canvas-toolbar-meta");
const summaryElement = requiredElement("canvas-summary");
const feedbackElement = requiredElement("canvas-feedback");
const selectionMetaElement = requiredElement("canvas-selection-meta");
const stageElement = requiredElement("canvas-stage");
const stageInnerElement = requiredElement("canvas-stage-inner");
const stageMetaElement = requiredElement("canvas-stage-meta");
const previewElement = requiredElement("canvas-preview") as HTMLIFrameElement;
const emptyElement = requiredElement("canvas-empty");
const nameInput = requiredElement("canvas-node-name") as HTMLInputElement;
const textInput = requiredElement("canvas-node-text") as HTMLTextAreaElement;
const addNoteButton = requiredElement("canvas-add-note") as HTMLButtonElement;
const resetViewButton = requiredElement("canvas-reset-view") as HTMLButtonElement;
const deleteNodeButton = requiredElement("canvas-delete-node") as HTMLButtonElement;
const annotationAddButton = requiredElement("canvas-annotation-add") as HTMLButtonElement;
const annotationCopyButton = requiredElement("canvas-annotation-copy") as HTMLButtonElement;
const annotationSendButton = requiredElement("canvas-annotation-send") as HTMLButtonElement;
const annotationContextInput = requiredElement("canvas-annotation-context") as HTMLTextAreaElement;
const annotationListElement = requiredElement("canvas-annotation-list");

const broadcastChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
const port = chrome.runtime.connect({ name: "canvas-page" });

let currentState: CanvasPageState | null = null;
let currentTabId: number | null = null;
let databasePromise: Promise<IDBDatabase | null> | null = null;
let persistTimer: number | null = null;
let fitViewportFrame: number | null = null;
let annotationDrafts: CanvasAnnotationDraft[] = [];
let draggingNode: {
  nodeId: string;
  originX: number;
  originY: number;
  startRectX: number;
  startRectY: number;
} | null = null;
let panningState: {
  originX: number;
  originY: number;
  startX: number;
  startY: number;
} | null = null;

void bootstrap();

async function bootstrap(): Promise<void> {
  currentTabId = await getCurrentTabId();
  const cached = await loadCachedState(currentTabId);
  if (cached) {
    applyState(cached, false);
  }
  port.onMessage.addListener((message: CanvasPageMessage) => {
    handlePortMessage(message);
  });
  port.onDisconnect.addListener(() => {
    renderMeta("Disconnected from canvas runtime");
  });
  broadcastChannel?.addEventListener("message", (event: MessageEvent) => {
    const state = normalizeCanvasPageState(isRecord(event.data) ? event.data.state : null);
    if (!state || !shouldAcceptBroadcast(state)) {
      return;
    }
    applyState(state, false);
  });
  port.postMessage({ type: "canvas-page-ready" } satisfies CanvasPagePortMessage);
  bindStageInteractions();
  bindInspector();
  bindToolbar();
  bindAnnotationPanel();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPersist();
    }
  });
  window.addEventListener("beforeunload", () => {
    flushPersist();
  });
}

function bindToolbar(): void {
  addNoteButton.addEventListener("click", () => {
    if (!currentState || currentState.pendingMutation) {
      return;
    }
    const page = currentState.document.pages[0];
    if (!page) {
      return;
    }
    const nodeId = `node_note_${crypto.randomUUID().slice(0, 8)}`;
    const parentId = currentState.selection.nodeId ?? page.rootNodeId;
    const center = computeViewportCanvasCenter(
      currentState.viewport,
      stageElement.clientWidth,
      stageElement.clientHeight
    );
    const noteNode = {
      id: nodeId,
      kind: "note",
      name: "New Note",
      rect: { x: center.x - 120, y: center.y - 60, width: 240, height: 120 },
      props: { text: "New note" },
      style: {},
      metadata: {}
    };
    applyOptimisticPatch([
      {
        op: "node.insert",
        pageId: page.id,
        parentId,
        node: noteNode
      }
    ], {
      pageId: page.id,
      nodeId,
      targetId: currentState.selection.targetId
    });
  });

  resetViewButton.addEventListener("click", () => {
    if (!currentState) {
      return;
    }
    currentState.viewport = resolvePreferredViewport(currentState);
    postViewState();
    renderState();
    schedulePersist(currentState);
  });

  deleteNodeButton.addEventListener("click", () => {
    if (!currentState || currentState.pendingMutation || !currentState.selection.nodeId) {
      return;
    }
    const nodeId = currentState.selection.nodeId;
    applyOptimisticPatch([{ op: "node.remove", nodeId }], {
      pageId: currentState.selection.pageId,
      nodeId: null,
      targetId: currentState.selection.targetId
    });
  });
}

function bindAnnotationPanel(): void {
  annotationAddButton.addEventListener("click", () => {
    addSelectedAnnotationDraft();
  });
  annotationCopyButton.addEventListener("click", () => {
    void copyCanvasAnnotation(undefined, annotationCopyButton).catch((error) => {
      setCanvasButtonFeedback(annotationCopyButton, "Copy failed");
      console.error("[opendevbrowser canvas]", error);
    });
  });
  annotationSendButton.addEventListener("click", () => {
    void sendCanvasAnnotation(undefined, "canvas_all", "Canvas annotation payload", annotationSendButton).catch((error) => {
      setCanvasButtonFeedback(annotationSendButton, "Send failed");
      console.error("[opendevbrowser canvas]", error);
    });
  });
}

function bindInspector(): void {
  nameInput.addEventListener("change", () => {
    const node = getSelectedNode();
    if (!node || !currentState || currentState.pendingMutation) {
      return;
    }
    applyOptimisticPatch([{
      op: "node.update",
      nodeId: node.id,
      changes: { name: nameInput.value.trim() || node.name }
    }], currentState.selection);
  });

  textInput.addEventListener("change", () => {
    const node = getSelectedNode();
    if (!node || !currentState || currentState.pendingMutation) {
      return;
    }
    applyOptimisticPatch([{
      op: "node.update",
      nodeId: node.id,
      changes: { "props.text": textInput.value }
    }], currentState.selection);
  });
}

function bindStageInteractions(): void {
  stageElement.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-node-id]") : null;
    if (target) {
      const nodeId = target.dataset.nodeId;
      const node = nodeId ? findNode(currentState?.document ?? null, nodeId) : null;
      if (!node || !currentState) {
        return;
      }
      currentState.selection = {
        pageId: node.pageId ?? currentState.document.pages[0]?.id ?? null,
        nodeId: node.id,
        targetId: currentState.selection.targetId,
        updatedAt: new Date().toISOString()
      };
      draggingNode = {
        nodeId: node.id,
        originX: event.clientX,
        originY: event.clientY,
        startRectX: node.rect.x,
        startRectY: node.rect.y
      };
      postViewState();
      renderState();
      stageElement.setPointerCapture(event.pointerId);
      return;
    }
    if (!currentState) {
      return;
    }
    panningState = {
      originX: event.clientX,
      originY: event.clientY,
      startX: currentState.viewport.x,
      startY: currentState.viewport.y
    };
    stageElement.dataset.mode = "panning";
    stageElement.setPointerCapture(event.pointerId);
  });

  stageElement.addEventListener("pointermove", (event) => {
    if (!currentState) {
      return;
    }
    if (draggingNode) {
      const node = findNode(currentState.document, draggingNode.nodeId);
      if (!node) {
        return;
      }
      const dx = (event.clientX - draggingNode.originX) / currentState.viewport.zoom;
      const dy = (event.clientY - draggingNode.originY) / currentState.viewport.zoom;
      node.rect.x = Math.round(draggingNode.startRectX + dx);
      node.rect.y = Math.round(draggingNode.startRectY + dy);
      renderStage();
      renderSelectionMeta();
      return;
    }
    if (panningState) {
      currentState.viewport.x = Math.round(panningState.startX + (event.clientX - panningState.originX));
      currentState.viewport.y = Math.round(panningState.startY + (event.clientY - panningState.originY));
      renderStage();
      toolbarMetaElement.textContent = formatViewport(currentState.viewport);
      schedulePersist(currentState);
    }
  });

  const endPointerInteraction = () => {
    if (!currentState) {
      draggingNode = null;
      panningState = null;
      stageElement.dataset.mode = "";
      return;
    }
    if (draggingNode && !currentState.pendingMutation) {
      const node = findNode(currentState.document, draggingNode.nodeId);
      if (node) {
        applyOptimisticPatch([{
          op: "node.update",
          nodeId: node.id,
          changes: {
            "rect.x": node.rect.x,
            "rect.y": node.rect.y
          }
        }], currentState.selection, { skipOptimisticMutation: true });
      }
    } else if (panningState) {
      postViewState();
    }
    draggingNode = null;
    panningState = null;
    stageElement.dataset.mode = "";
  };

  stageElement.addEventListener("pointerup", endPointerInteraction);
  stageElement.addEventListener("pointercancel", endPointerInteraction);
  stageElement.addEventListener("wheel", (event) => {
    if (!currentState) {
      return;
    }
    event.preventDefault();
    const nextZoom = clamp(currentState.viewport.zoom * (event.deltaY < 0 ? 1.08 : 0.92), 0.35, 2.4);
    currentState.viewport.zoom = Math.round(nextZoom * 100) / 100;
    renderStage();
    toolbarMetaElement.textContent = formatViewport(currentState.viewport);
    postViewState();
    schedulePersist(currentState);
  }, { passive: false });
}

function handlePortMessage(message: CanvasPageMessage): void {
  if (!message) {
    return;
  }
  if (message.type === "canvas-page-action-request") {
    const response = runCanvasPageAction(message.selector ?? null, message.action);
    port.postMessage({
      type: "canvas-page-action-response",
      requestId: message.requestId,
      ...(response.ok ? { ok: true, value: response.value } : { ok: false, error: response.error })
    } satisfies CanvasPagePortMessage);
    return;
  }
  if (message.type !== "canvas-page:init" && message.type !== "canvas-page:update" && message.type !== "canvas-page:closed") {
    return;
  }
  if (message.type === "canvas-page:closed") {
    currentState = null;
    annotationDrafts = [];
    previewElement.srcdoc = "";
    emptyElement.hidden = false;
    renderMeta(`Canvas closed${message.reason ? `: ${message.reason}` : "."}`);
    stageInnerElement.innerHTML = "";
    renderAnnotationPanel();
    return;
  }
  const state = normalizeCanvasPageState(message.state);
  if (!state) {
    return;
  }
  applyState(state, true);
}

function runCanvasPageAction(
  selector: string | null,
  action: CanvasPageElementAction
): { ok: true; value?: unknown } | { ok: false; error: string } {
  const resolveElement = (allowActive = false): Element | null => {
    if (selector && selector.trim().length > 0) {
      return document.querySelector(selector);
    }
    return allowActive ? document.activeElement : null;
  };
  const dispatchPointer = (target: Element, type: string, buttons: number) => {
    const rect = target.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons
    };
    if (typeof PointerEvent === "function") {
      target.dispatchEvent(new PointerEvent(type, init));
      return;
    }
    target.dispatchEvent(new MouseEvent(type.replace(/^pointer/, "mouse"), init));
  };
  const dispatchMouse = (target: Element, type: string, buttons: number) => {
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons
    }));
  };
  const dispatchHover = (target: Element) => {
    dispatchPointer(target, "pointerover", 0);
    dispatchPointer(target, "pointerenter", 0);
    dispatchMouse(target, "mouseover", 0);
    dispatchMouse(target, "mouseenter", 0);
    dispatchPointer(target, "pointermove", 0);
    dispatchMouse(target, "mousemove", 0);
  };
  const dispatchClick = (target: Element) => {
    dispatchHover(target);
    dispatchPointer(target, "pointerdown", 1);
    dispatchMouse(target, "mousedown", 1);
    if (target instanceof HTMLElement) {
      target.focus();
    }
    dispatchPointer(target, "pointerup", 0);
    dispatchMouse(target, "mouseup", 0);
    if (target instanceof HTMLElement) {
      target.click();
      return;
    }
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
  };
  const selectorState = (target: Element | null) => {
    if (!target) {
      return { attached: false, visible: false };
    }
    const style = window.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    return {
      attached: true,
      visible: style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && rect.width > 0
        && rect.height > 0
    };
  };

  if (action.type === "scroll") {
    const target = resolveElement(false);
    if (target instanceof HTMLElement) {
      target.scrollBy(0, action.dy);
      return { ok: true, value: true };
    }
    window.scrollBy(0, action.dy);
    return { ok: true, value: true };
  }

  if (action.type === "getSelectorState") {
    return { ok: true, value: selectorState(resolveElement(false)) };
  }

  const target = resolveElement(action.type === "press");
  if (!target) {
    return { ok: false, error: "Element not found" };
  }

  switch (action.type) {
    case "outerHTML":
      return { ok: true, value: target.outerHTML };
    case "innerText":
      return { ok: true, value: target instanceof HTMLElement ? target.innerText || target.textContent || "" : target.textContent || "" };
    case "getAttr":
      return { ok: true, value: target.getAttribute(action.name) };
    case "getValue":
      if ("value" in target) {
        return { ok: true, value: String((target as HTMLInputElement).value ?? "") };
      }
      return { ok: true, value: null };
    case "isEnabled":
      if ("disabled" in target) {
        return { ok: true, value: !(target as HTMLInputElement).disabled };
      }
      return { ok: true, value: true };
    case "isChecked":
      if ("checked" in target) {
        return { ok: true, value: Boolean((target as HTMLInputElement).checked) };
      }
      return { ok: true, value: false };
    case "click":
      dispatchClick(target);
      return { ok: true, value: true };
    case "hover":
      dispatchHover(target);
      return { ok: true, value: true };
    case "focus":
      if (target instanceof HTMLElement) {
        target.focus();
      }
      return { ok: true, value: true };
    case "press": {
      if (target instanceof HTMLElement) {
        target.focus();
      }
      const init = { key: action.key, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keypress", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
      return { ok: true, value: true };
    }
    case "type": {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return { ok: false, error: "Element does not support typing" };
      }
      if (action.clear) {
        target.value = "";
      }
      target.value = String(action.value ?? "");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      if (action.submit) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      return { ok: true, value: true };
    }
    case "setChecked":
      if (!("checked" in target)) {
        return { ok: false, error: "Element does not support checked state" };
      }
      (target as HTMLInputElement).checked = Boolean(action.checked);
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: true };
    case "select":
      if (!(target instanceof HTMLSelectElement)) {
        return { ok: false, error: "Element is not a select" };
      }
      const wanted = new Set(action.values);
      for (const option of Array.from(target.options)) {
        option.selected = wanted.has(option.value);
      }
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: true };
    case "scrollIntoView":
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
      } else {
        target.scrollIntoView();
      }
      return { ok: true, value: true };
  }
}

function applyState(state: CanvasPageState, persist: boolean): void {
  currentState = state;
  titleElement.textContent = state.title;
  renderBadges(state);
  renderMeta(`Document ${state.documentId} updated ${formatTimestamp(state.updatedAt)}`);
  toolbarMetaElement.textContent = formatViewport(state.viewport);
  renderSummary(state.summary, state);
  renderFeedback(state.feedback);
  renderState();
  previewElement.srcdoc = state.html;
  emptyElement.hidden = Boolean(state.html);
  queueViewportFitIfNeeded();
  if (persist) {
    schedulePersist(state);
  }
}

function renderState(): void {
  if (!currentState) {
    renderAnnotationPanel();
    return;
  }
  const projectionSummary = summarizeCanvasProjectionState(currentState.summary, currentState.targets);
  const syncFragments = [
    currentState.pendingMutation ? "sync pending" : "live",
    currentState.summary.codeSyncState ?? null,
    projectionSummary.conflictCount > 0 ? `${projectionSummary.conflictCount} conflict${projectionSummary.conflictCount === 1 ? "" : "s"}` : null
  ].filter((entry): entry is string => typeof entry === "string");
  stageMetaElement.textContent = `${currentState.document.pages[0]?.nodes.length ?? 0} nodes • ${syncFragments.join(" • ")}`;
  renderStage();
  renderInspector();
  syncAnnotationDrafts();
}

function renderBadges(state: CanvasPageState): void {
  badgesElement.innerHTML = "";
  const projectionSummary = summarizeCanvasProjectionState(state.summary, state.targets);
  for (const label of [
    state.previewState,
    state.previewMode,
    state.documentRevision === null ? "revision pending" : `revision ${state.documentRevision}`,
    state.pendingMutation ? "sync pending" : "synced",
    state.summary.codeSyncState,
    projectionSummary.activeProjections[0],
    projectionSummary.conflictCount > 0 ? `${projectionSummary.conflictCount} conflicts` : null
  ]) {
    if (typeof label !== "string" || label.trim().length === 0) {
      continue;
    }
    const badge = document.createElement("span");
    badge.className = "canvas-badge";
    badge.textContent = label;
    badgesElement.append(badge);
  }
}

function renderMeta(text: string): void {
  metaElement.textContent = text;
}

function renderSummary(summary: CanvasSessionSummary, state: CanvasPageState): void {
  summaryElement.innerHTML = "";
  const componentLibraries = formatSummaryList(readSummaryLibraryList(summary, "components"));
  const iconLibraries = formatSummaryList(readSummaryLibraryList(summary, "icons"));
  const stylingLibraries = formatSummaryList(readSummaryLibraryList(summary, "styling"));
  const inventorySources = formatSummaryList(readSummaryStringArray(summary.componentSourceKinds));
  const projectionSummary = summarizeCanvasProjectionState(state.summary, state.targets);
  const items: Array<[string, string]> = [
    ["Target", state.targetId],
    ["Session", formatSummaryValue(summary.canvasSessionId)],
    ["Mode", formatSummaryValue(summary.mode)],
    ["Plan", formatSummaryValue(summary.planStatus)],
    ["Preflight", formatSummaryValue(summary.preflightState)],
    ["Attached clients", formatAttachedClients(state.summary.attachedClients)],
    ["Lease holder", state.summary.leaseHolderClientId ?? "none"],
    ["Code sync", formatCodeSyncStatus(state.summary, projectionSummary.watchConflict)],
    ["Projection", formatProjectionSummary(projectionSummary)],
    ["Fallbacks", formatSummaryList(projectionSummary.fallbackReasons)],
    ["Components", componentLibraries],
    ["Icons", iconLibraries],
    ["Styling", stylingLibraries],
    ["Inventory", `${formatSummaryValue(summary.componentInventoryCount)} mapped`],
    ["Inventory sources", inventorySources],
    ["Targets", String(state.targets.length)],
    ["Overlays", String(state.overlayMounts.length)],
    ["Feedback", String(countFeedbackItems(state.feedback))]
  ];
  for (const [label, value] of items) {
    const row = document.createElement("div");
    row.className = "canvas-summary-item";
    const title = document.createElement("div");
    title.className = "canvas-summary-label";
    title.textContent = label;
    const body = document.createElement("div");
    body.className = "canvas-summary-value";
    body.textContent = value;
    row.append(title, body);
    summaryElement.append(row);
  }
}

function renderFeedback(events: CanvasFeedbackEvent[]): void {
  feedbackElement.innerHTML = "";
  const latest = events.slice(-8).reverse();
  for (const event of latest) {
    const row = document.createElement("div");
    row.className = "canvas-feedback-item";
    const meta = document.createElement("div");
    meta.className = "canvas-feedback-meta";
    if (event.eventType === "feedback.item") {
      meta.textContent = `${event.item.category} • ${event.item.severity}`;
      meta.classList.add(`canvas-feedback-severity-${event.item.severity}`);
      const body = document.createElement("div");
      body.className = "canvas-feedback-message";
      body.textContent = event.item.message;
      row.append(meta, body);
    } else if (event.eventType === "feedback.heartbeat") {
      meta.textContent = "heartbeat";
      const body = document.createElement("div");
      body.className = "canvas-feedback-message";
      body.textContent = `${event.activeTargetIds.length} active targets`;
      row.append(meta, body);
    } else {
      meta.textContent = "stream complete";
      const body = document.createElement("div");
      body.className = "canvas-feedback-message";
      body.textContent = event.reason;
      row.append(meta, body);
    }
    feedbackElement.append(row);
  }
}

function renderStage(): void {
  if (!currentState) {
    stageInnerElement.innerHTML = "";
    return;
  }
  const page = currentState.document.pages[0];
  if (!page) {
    stageInnerElement.innerHTML = "";
    return;
  }
  const bounds = computeDocumentBounds(page.nodes);
  stageInnerElement.style.width = `${bounds.width}px`;
  stageInnerElement.style.height = `${bounds.height}px`;
  stageInnerElement.style.transform = `translate(${currentState.viewport.x}px, ${currentState.viewport.y}px) scale(${currentState.viewport.zoom})`;
  stageInnerElement.innerHTML = "";
  const sortedNodes = [...page.nodes].sort(compareStageNodes);
  for (const node of sortedNodes) {
    stageInnerElement.append(buildStageNodeElement(currentState.document, node, currentState.selection.nodeId === node.id));
  }
}

function compareStageNodes(left: CanvasNode, right: CanvasNode): number {
  const rootOrder = Number(left.parentId !== null) - Number(right.parentId !== null);
  if (rootOrder !== 0) {
    return rootOrder;
  }
  const areaOrder = (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height);
  if (areaOrder !== 0) {
    return areaOrder;
  }
  const verticalOrder = left.rect.y - right.rect.y;
  return verticalOrder !== 0 ? verticalOrder : left.rect.x - right.rect.x;
}

function buildStageNodeElement(
  documentState: CanvasDocument,
  node: CanvasNode,
  selected: boolean
): HTMLElement {
  const binding = resolveStageBinding(documentState, node);
  const componentKind = resolveStageComponentKind(node, binding);
  const media = resolveStageMediaDescriptor(documentState, node);
  const text = nodeText(node);
  const tag = componentKind === "button"
    ? "button"
    : media
      ? "div"
    : node.kind === "text"
      ? "p"
      : node.kind === "note"
        ? "aside"
        : "div";
  const element = document.createElement(tag);
  element.className = [
    "canvas-node",
    componentKind ? `canvas-node-${componentKind}` : "",
    binding?.sourceKind ? `canvas-node-source-${binding.sourceKind.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : ""
  ].filter(Boolean).join(" ");
  element.dataset.nodeId = node.id;
  element.dataset.selected = String(selected);
  const accessibleLabel = describeStageNode(node, componentKind, media, text);
  element.title = accessibleLabel;
  element.setAttribute("aria-label", selected ? `${accessibleLabel}, selected` : accessibleLabel);
  element.setAttribute("aria-roledescription", componentKind ?? node.kind);
  if (element instanceof HTMLButtonElement) {
    element.type = "button";
  } else {
    element.setAttribute("role", "button");
    element.tabIndex = 0;
  }
  element.style.left = `${node.rect.x}px`;
  element.style.top = `${node.rect.y}px`;
  element.style.width = `${Math.max(node.rect.width, 40)}px`;
  element.style.minHeight = `${Math.max(node.rect.height, node.kind === "connector" ? 2 : componentKind === "badge" ? 28 : 40)}px`;
  applyDeclaredStageStyles(element, node.style);
  if (text.includes("\n") && element.style.whiteSpace.length === 0) {
    element.style.whiteSpace = "pre-line";
  }
  const icons = readStageIcons(node);
  if (componentKind === "button" || componentKind === "badge" || componentKind === "tabs") {
    appendStageButtonLikeContent(element, text || node.name, icons, componentKind);
    return element;
  }
  if (componentKind === "card" || componentKind === "dialog" || componentKind === "motion") {
    appendStageCardContent(element, text || node.name, icons);
    return element;
  }
  if (media) {
    appendStageMediaContent(element, media, text || node.name);
    return element;
  }
  if (node.kind === "connector") {
    return element;
  }
  appendStageTextContent(element, text || node.name);
  return element;
}

function describeStageNode(
  node: CanvasNode,
  componentKind: "badge" | "button" | "card" | "dialog" | "motion" | "tabs" | null,
  media: { kind: "image" | "video" | "audio"; src: string | null; poster: string | null; alt: string | null } | null,
  text: string
): string {
  const parts = [
    node.name.trim(),
    text.trim() && text.trim() !== node.name.trim() ? text.trim() : "",
    media ? media.kind : "",
    componentKind ?? node.kind
  ].filter((value) => value.length > 0);
  return parts.join(" • ");
}

function resolveStageBinding(
  documentState: CanvasDocument,
  node: CanvasNode
): { componentName: string | null; sourceKind: string | null } | null {
  const bindingId = typeof node.bindingRefs.primary === "string" ? node.bindingRefs.primary : null;
  if (!bindingId) {
    return null;
  }
  const binding = documentState.bindings.find((entry) => entry.id === bindingId);
  if (!binding) {
    return null;
  }
  const metadata = isRecord(binding.metadata) ? binding.metadata : {};
  return {
    componentName: typeof binding.componentName === "string" ? binding.componentName : null,
    sourceKind: typeof metadata.sourceKind === "string" ? metadata.sourceKind : null
  };
}

function resolveStageComponentKind(
  node: CanvasNode,
  binding: { componentName: string | null; sourceKind: string | null } | null
): "badge" | "button" | "card" | "dialog" | "motion" | "tabs" | null {
  const componentName = binding?.componentName?.toLowerCase() ?? "";
  if (componentName.includes("button")) {
    return "button";
  }
  if (componentName.includes("badge")) {
    return "badge";
  }
  if (componentName.includes("tabs")) {
    return "tabs";
  }
  if (componentName.includes("card")) {
    return "card";
  }
  if (componentName.includes("dialog")) {
    return "dialog";
  }
  if (componentName.includes("motion")) {
    return "motion";
  }
  if (node.kind !== "component-instance") {
    return null;
  }
  const lineCount = nodeText(node).split("\n").filter((entry) => entry.trim().length > 0).length;
  if (lineCount > 1 || node.rect.height >= 96) {
    return "card";
  }
  if (node.rect.height <= 56) {
    return "badge";
  }
  return "button";
}

function readStageIcons(node: CanvasNode): Array<{ identifier: string; sourceLibrary: string }> {
  const refs = Array.isArray(node.metadata.iconRefs)
    ? node.metadata.iconRefs
    : node.metadata.iconRef
      ? [node.metadata.iconRef]
      : [];
  return refs.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.sourceLibrary !== "string") {
      return [];
    }
    return [{
      identifier: typeof entry.identifier === "string" ? entry.identifier : "generic",
      sourceLibrary: entry.sourceLibrary
    }];
  });
}

function readStageAttributes(node: CanvasNode): Record<string, unknown> {
  return isRecord(node.props.attributes) ? node.props.attributes : {};
}

function resolveStageTagName(node: CanvasNode): string | null {
  if (typeof node.props.tagName === "string" && node.props.tagName.trim().length > 0) {
    return node.props.tagName.trim().toLowerCase();
  }
  const codeSync = isRecord(node.metadata.codeSync) ? node.metadata.codeSync : null;
  if (codeSync && typeof codeSync.tagName === "string" && codeSync.tagName.trim().length > 0) {
    return codeSync.tagName.trim().toLowerCase();
  }
  return null;
}

function resolveStageMediaDescriptor(
  documentState: CanvasDocument,
  node: CanvasNode
): { kind: "image" | "video" | "audio"; src: string | null; poster: string | null; alt: string | null } | null {
  const tagName = resolveStageTagName(node);
  const attributes = readStageAttributes(node);
  const assetIds = Array.isArray(node.metadata.assetIds)
    ? node.metadata.assetIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const asset = assetIds.length > 0
    ? documentState.assets.find((entry) => entry.id === assetIds[0])
    : null;
  const assetKind = typeof asset?.kind === "string" ? asset.kind.toLowerCase() : null;
  const assetMime = typeof asset?.mime === "string" ? asset.mime.toLowerCase() : null;
  const src = typeof node.props.src === "string"
    ? node.props.src
    : typeof attributes.src === "string"
      ? attributes.src
      : typeof asset?.url === "string"
        ? asset.url
        : typeof asset?.repoPath === "string"
          ? asset.repoPath
          : null;
  const poster = typeof node.props.poster === "string"
    ? node.props.poster
    : typeof attributes.poster === "string"
      ? attributes.poster
      : null;
  const alt = typeof node.props.alt === "string"
    ? node.props.alt
    : typeof attributes.alt === "string"
      ? attributes.alt
      : node.name;
  if (tagName === "img" || assetKind === "image" || assetMime?.startsWith("image/")) {
    return { kind: "image", src, poster: null, alt };
  }
  if (tagName === "video" || assetKind === "video" || assetMime?.startsWith("video/")) {
    return { kind: "video", src, poster, alt };
  }
  if (tagName === "audio" || assetKind === "audio" || assetMime?.startsWith("audio/")) {
    return { kind: "audio", src, poster: null, alt };
  }
  return null;
}

function appendStageMediaContent(
  element: HTMLElement,
  media: { kind: "image" | "video" | "audio"; src: string | null; poster: string | null; alt: string | null },
  label: string
): void {
  element.classList.add("canvas-node-media-shell");
  if (!media.src) {
    const placeholder = document.createElement("div");
    placeholder.className = "canvas-node-media-placeholder";
    placeholder.textContent = `${media.kind} source missing`;
    element.append(placeholder);
    return;
  }
  if (media.kind === "image") {
    const image = document.createElement("img");
    image.className = "canvas-node-media canvas-node-media-image";
    image.src = media.src;
    image.alt = media.alt ?? label;
    image.loading = "lazy";
    image.draggable = false;
    image.style.pointerEvents = "none";
    element.append(image);
    return;
  }
  if (media.kind === "video") {
    const video = document.createElement("video");
    video.className = "canvas-node-media canvas-node-media-video";
    video.src = media.src;
    if (media.poster) {
      video.poster = media.poster;
    }
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.style.pointerEvents = "none";
    element.append(video);
    return;
  }
  const audio = document.createElement("audio");
  audio.className = "canvas-node-media canvas-node-media-audio";
  audio.src = media.src;
  audio.controls = true;
  audio.preload = "metadata";
  audio.style.pointerEvents = "none";
  element.append(audio);
}

function appendStageButtonLikeContent(
  element: HTMLElement,
  text: string,
  icons: Array<{ identifier: string; sourceLibrary: string }>,
  componentKind: "badge" | "button" | "tabs"
): void {
  const row = document.createElement(componentKind === "tabs" ? "div" : "span");
  row.className = componentKind === "tabs" ? "canvas-node-tabs-trigger" : "canvas-node-row";
  for (const icon of icons) {
    row.append(buildStageIconElement(icon));
  }
  const label = document.createElement("span");
  label.className = "canvas-node-label";
  label.textContent = text;
  row.append(label);
  element.append(row);
}

function appendStageCardContent(
  element: HTMLElement,
  text: string,
  icons: Array<{ identifier: string; sourceLibrary: string }>
): void {
  const lines = text.split("\n").map((entry) => entry.trim()).filter(Boolean);
  const header = document.createElement("div");
  header.className = "canvas-node-card-header";
  const title = document.createElement("div");
  title.className = "canvas-node-card-title";
  title.textContent = lines[0] ?? text;
  header.append(title);
  if (icons.length > 0) {
    const iconWrap = document.createElement("span");
    iconWrap.className = "canvas-node-icon-stack";
    for (const icon of icons) {
      iconWrap.append(buildStageIconElement(icon));
    }
    header.append(iconWrap);
  }
  element.append(header);
  if (lines.length > 1) {
    const body = document.createElement("div");
    body.className = "canvas-node-card-copy";
    for (const line of lines.slice(1)) {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      body.append(paragraph);
    }
    element.append(body);
  }
}

function appendStageTextContent(element: HTMLElement, text: string): void {
  const inlineItems = text.split(/\s{2,}/).map((entry) => entry.trim()).filter(Boolean);
  if (inlineItems.length > 1) {
    const list = document.createElement("div");
    list.className = "canvas-node-inline-list";
    for (const item of inlineItems) {
      const chip = document.createElement("span");
      chip.className = "canvas-node-inline-item";
      chip.textContent = item;
      list.append(chip);
    }
    element.append(list);
    return;
  }
  element.textContent = text;
}

function buildStageIconElement(icon: { identifier: string; sourceLibrary: string }): HTMLElement {
  const span = document.createElement("span");
  span.className = "canvas-node-icon";
  span.dataset.library = icon.sourceLibrary;
  if (icon.sourceLibrary === "tabler") {
    span.append(buildStageTablerIcon(icon.identifier));
    return span;
  }
  if (icon.sourceLibrary === "microsoft-fluent-ui-system-icons") {
    span.append(buildStageFluentIcon(icon.identifier));
    return span;
  }
  if (icon.sourceLibrary === "3dicons") {
    span.style.background = "linear-gradient(145deg, #7ef9e9 0%, #22c3ee 48%, #ff7aa2 100%)";
    span.style.boxShadow = "0 8px 18px rgba(34, 195, 238, 0.28)";
    span.textContent = "";
    return span;
  }
  span.textContent = icon.identifier.includes("party") ? "🎉" : "✨";
  return span;
}

function buildStageIconSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function appendStageStrokePath(svg: SVGSVGElement, attributes: Record<string, string>): void {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "1.85");
  for (const [key, value] of Object.entries(attributes)) {
    path.setAttribute(key, value);
  }
  svg.append(path);
}

function buildStageTablerIcon(identifier: string): SVGSVGElement {
  const svg = buildStageIconSvg();
  switch (identifier) {
    case "arrow-right":
      appendStageStrokePath(svg, { d: "M5 12h14" });
      appendStageStrokePath(svg, { d: "m12 5 7 7-7 7" });
      return svg;
    case "rocket":
      appendStageStrokePath(svg, { d: "M5 19c2.5-6.5 7.5-11.5 14-14-2.5 6.5-7.5 11.5-14 14Z" });
      appendStageStrokePath(svg, { d: "m9 15-4 4" });
      {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "14.5");
        circle.setAttribute("cy", "9.5");
        circle.setAttribute("r", "1.75");
        circle.setAttribute("stroke", "currentColor");
        circle.setAttribute("stroke-width", "1.85");
        svg.append(circle);
      }
      return svg;
    case "components":
    case "layout-dashboard": {
      const shapes: Array<[string, string, string, string]> = identifier === "components"
        ? [
          ["4", "4", "7", "7"],
          ["13", "4", "7", "7"],
          ["8.5", "13", "7", "7"]
        ]
        : [
          ["4", "4", "7", "7"],
          ["13", "4", "7", "5"],
          ["13", "11", "7", "9"],
          ["4", "13", "7", "7"]
        ];
      for (const [x, y, width, height] of shapes) {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", width);
        rect.setAttribute("height", height);
        rect.setAttribute("rx", "2");
        rect.setAttribute("stroke", "currentColor");
        rect.setAttribute("stroke-width", "1.85");
        svg.append(rect);
      }
      return svg;
    }
    default:
      appendStageStrokePath(svg, { d: "M12 9v6" });
      appendStageStrokePath(svg, { d: "M9 12h6" });
      {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "12");
        circle.setAttribute("cy", "12");
        circle.setAttribute("r", "7");
        circle.setAttribute("stroke", "currentColor");
        circle.setAttribute("stroke-width", "1.85");
        svg.append(circle);
      }
      return svg;
  }
}

function buildStageFluentIcon(identifier: string): SVGSVGElement {
  const svg = buildStageIconSvg();
  switch (identifier) {
    case "grid-dots-24":
      for (let index = 0; index < 9; index += 1) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", String(7 + (index % 3) * 5));
        circle.setAttribute("cy", String(7 + Math.floor(index / 3) * 5));
        circle.setAttribute("r", "1.4");
        circle.setAttribute("fill", "currentColor");
        svg.append(circle);
      }
      return svg;
    case "chat-bubbles-24": {
      const bubble = document.createElementNS("http://www.w3.org/2000/svg", "path");
      bubble.setAttribute("d", "M5.5 8.5a3.5 3.5 0 0 1 3.5-3.5h8a3.5 3.5 0 0 1 3.5 3.5v4A3.5 3.5 0 0 1 17 16H11l-4.5 3v-3.1A3.49 3.49 0 0 1 5.5 12.5v-4Z");
      bubble.setAttribute("stroke", "currentColor");
      bubble.setAttribute("stroke-width", "1.8");
      svg.append(bubble);
      const lines = document.createElementNS("http://www.w3.org/2000/svg", "path");
      lines.setAttribute("d", "M8 9.75h7M8 12.75h4.5");
      lines.setAttribute("stroke", "currentColor");
      lines.setAttribute("stroke-linecap", "round");
      lines.setAttribute("stroke-width", "1.8");
      svg.append(lines);
      return svg;
    }
    case "branch-24":
      appendStageStrokePath(svg, { d: "M8 7.5v9" });
      appendStageStrokePath(svg, { d: "M8 12.5h7" });
      appendStageStrokePath(svg, { d: "M15 12.5V7.5" });
      for (const [cx, cy] of [["8", "6"], ["15", "6"], ["15", "18"]] as Array<[string, string]>) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", cx);
        circle.setAttribute("cy", cy);
        circle.setAttribute("r", "2");
        circle.setAttribute("fill", "currentColor");
        svg.append(circle);
      }
      return svg;
    case "sparkle-24":
    default: {
      const sparkle = document.createElementNS("http://www.w3.org/2000/svg", "path");
      sparkle.setAttribute("d", "M12 3.5 14.4 9l5.6 2.4-5.6 2.4L12 19.5l-2.4-5.7L4 11.4 9.6 9 12 3.5Z");
      sparkle.setAttribute("fill", "currentColor");
      svg.append(sparkle);
      return svg;
    }
  }
}

function applyDeclaredStageStyles(element: HTMLElement, style: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(style)) {
    if (typeof value !== "string" && typeof value !== "number") {
      continue;
    }
    const cssName = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    const cssValue = typeof value === "number" && !UNIT_LESS_STYLES.has(key) ? `${value}px` : String(value);
    element.style.setProperty(cssName, cssValue);
  }
}

function renderInspector(): void {
  const node = getSelectedNode();
  nameInput.disabled = !node || Boolean(currentState?.pendingMutation);
  textInput.disabled = !node || Boolean(currentState?.pendingMutation);
  deleteNodeButton.disabled = !node || Boolean(currentState?.pendingMutation);
  nameInput.value = node?.name ?? "";
  textInput.value = node ? nodeText(node) : "";
  renderSelectionMeta();
}

function renderSelectionMeta(): void {
  selectionMetaElement.innerHTML = "";
  const node = getSelectedNode();
  const items: Array<[string, string]> = [
    ["Selected", node?.id ?? "none"],
    ["Position", node ? `${node.rect.x}, ${node.rect.y}` : "n/a"],
    ["Size", node ? `${node.rect.width} × ${node.rect.height}` : "n/a"]
  ];
  for (const [label, value] of items) {
    const row = document.createElement("div");
    row.className = "canvas-summary-item";
    const title = document.createElement("div");
    title.className = "canvas-summary-label";
    title.textContent = label;
    const body = document.createElement("div");
    body.className = "canvas-summary-value";
    body.textContent = value;
    row.append(title, body);
    selectionMetaElement.append(row);
  }
}

function renderAnnotationPanel(): void {
  const node = getSelectedNode();
  annotationAddButton.disabled = !node || !currentState || annotationDrafts.some((entry) => entry.nodeId === node.id);
  annotationCopyButton.disabled = annotationDrafts.length === 0 || !currentState;
  annotationSendButton.disabled = annotationDrafts.length === 0 || !currentState;

  annotationListElement.innerHTML = "";
  if (!currentState || annotationDrafts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "canvas-annotation-empty";
    empty.textContent = currentState ? "No canvas annotations captured yet." : "Waiting for canvas state...";
    annotationListElement.append(empty);
    return;
  }

  for (const draft of annotationDrafts) {
    const itemPayload = buildCanvasAnnotationPayloadForDrafts([draft]);
    const annotation = itemPayload?.annotations[0];
    const nodeLabel = annotation ? describeAnnotationItem(annotation) : draft.nodeId;
    const row = document.createElement("div");
    row.className = "canvas-annotation-item";

    const head = document.createElement("div");
    head.className = "canvas-annotation-head";

    const summary = document.createElement("div");
    const title = document.createElement("div");
    title.className = "canvas-annotation-title";
    title.textContent = nodeLabel;
    const meta = document.createElement("div");
    meta.className = "canvas-annotation-meta";
    meta.textContent = annotation ? `${annotation.tag} • ${Math.round(annotation.rect.width)}×${Math.round(annotation.rect.height)}` : draft.nodeId;
    summary.append(title, meta);

    const removeButton = document.createElement("button");
    removeButton.className = "canvas-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      removeAnnotationDraft(draft.nodeId);
    });

    head.append(summary, removeButton);

    const noteField = document.createElement("textarea");
    noteField.className = "canvas-textarea";
    noteField.value = draft.note ?? "";
    noteField.placeholder = "Add note for this node";
    noteField.addEventListener("input", () => {
      updateAnnotationDraft(draft.nodeId, { note: noteField.value });
    });

    const actions = document.createElement("div");
    actions.className = "canvas-actions-grid";

    const copyButton = document.createElement("button");
    copyButton.className = "canvas-button";
    copyButton.type = "button";
    copyButton.textContent = "Copy item";
    copyButton.addEventListener("click", () => {
      void copyCanvasAnnotation([draft], copyButton).catch((error) => {
        setCanvasButtonFeedback(copyButton, "Copy failed");
        console.error("[opendevbrowser canvas]", error);
      });
    });

    const sendButton = document.createElement("button");
    sendButton.className = "canvas-button";
    sendButton.type = "button";
    sendButton.textContent = "Send item";
    sendButton.addEventListener("click", () => {
      void sendCanvasAnnotation([draft], "canvas_item", nodeLabel, sendButton).catch((error) => {
        setCanvasButtonFeedback(sendButton, "Send failed");
        console.error("[opendevbrowser canvas]", error);
      });
    });

    actions.append(copyButton, sendButton);
    row.append(head, noteField, actions);
    annotationListElement.append(row);
  }
}

function buildCanvasAnnotationPayloadForDrafts(drafts: CanvasAnnotationDraft[]): ReturnType<typeof buildCanvasAnnotationPayload> | null {
  if (!currentState) {
    return null;
  }
  const page = currentState.document.pages[0];
  if (!page || drafts.length === 0) {
    return null;
  }
  return buildCanvasAnnotationPayload({
    document: currentState.document,
    page,
    drafts,
    context: annotationContextInput.value.trim() || undefined
  });
}

function addSelectedAnnotationDraft(): void {
  const node = getSelectedNode();
  if (!node || annotationDrafts.some((entry) => entry.nodeId === node.id)) {
    renderAnnotationPanel();
    return;
  }
  annotationDrafts = [...annotationDrafts, { nodeId: node.id, note: "" }];
  renderAnnotationPanel();
}

function updateAnnotationDraft(nodeId: string, patch: Partial<CanvasAnnotationDraft>): void {
  annotationDrafts = annotationDrafts.map((entry) => entry.nodeId === nodeId ? { ...entry, ...patch } : entry);
}

function removeAnnotationDraft(nodeId: string): void {
  annotationDrafts = annotationDrafts.filter((entry) => entry.nodeId !== nodeId);
  renderAnnotationPanel();
}

function syncAnnotationDrafts(): void {
  if (!currentState) {
    annotationDrafts = [];
    renderAnnotationPanel();
    return;
  }
  const page = currentState.document.pages[0];
  const validIds = new Set(page?.nodes.map((node) => node.id) ?? []);
  const next = annotationDrafts.filter((entry) => validIds.has(entry.nodeId));
  if (next.length !== annotationDrafts.length) {
    annotationDrafts = next;
  }
  renderAnnotationPanel();
}

async function copyCanvasAnnotation(drafts: CanvasAnnotationDraft[] | undefined, button: HTMLButtonElement): Promise<void> {
  const payload = buildCanvasAnnotationPayloadForDrafts(drafts ?? annotationDrafts);
  if (!payload) {
    setCanvasButtonFeedback(button, "No items");
    return;
  }
  await writeTextToClipboard(JSON.stringify(payload, null, 2));
  setCanvasButtonFeedback(button, "Copied");
}

async function sendCanvasAnnotation(
  drafts: CanvasAnnotationDraft[] | undefined,
  source: AnnotationDispatchSource,
  label: string,
  button: HTMLButtonElement
): Promise<void> {
  const payload = buildCanvasAnnotationPayloadForDrafts(drafts ?? annotationDrafts);
  if (!payload) {
    setCanvasButtonFeedback(button, "No items");
    return;
  }
  const response = await new Promise<PopupAnnotationSendPayloadResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "annotation:sendPayload",
        payload,
        source,
        label
      },
      (message) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(message as PopupAnnotationSendPayloadResponse);
      }
    );
  });
  if (!response.ok) {
    throw new Error(response.error?.message ?? "Canvas annotation send failed.");
  }
  setCanvasButtonFeedback(button, "Sent");
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand below.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) {
    throw new Error("Clipboard copy failed");
  }
}

function setCanvasButtonFeedback(button: HTMLButtonElement, label: string): void {
  const original = button.dataset.originalLabel ?? button.textContent ?? "Action";
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = original;
  }
  button.textContent = label;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

function getSelectedNode(): CanvasNode | null {
  if (!currentState?.selection.nodeId) {
    return null;
  }
  return findNode(currentState.document, currentState.selection.nodeId);
}

function applyOptimisticPatch(
  patches: unknown[],
  selection: Partial<CanvasEditorSelection> | undefined,
  options: { skipOptimisticMutation?: boolean } = {}
): void {
  if (!currentState || currentState.documentRevision === null || currentState.pendingMutation) {
    return;
  }
  if (!options.skipOptimisticMutation) {
    applyLocalPatchMutation(currentState.document, patches);
  }
  currentState.pendingMutation = true;
  currentState.selection = {
    pageId: selection?.pageId ?? currentState.selection.pageId,
    nodeId: selection?.nodeId ?? currentState.selection.nodeId,
    targetId: selection?.targetId ?? currentState.selection.targetId,
    updatedAt: new Date().toISOString()
  };
  renderState();
  schedulePersist(currentState);
  port.postMessage({
    type: "canvas-page-patch-request",
    baseRevision: currentState.documentRevision,
    patches,
    selection: currentState.selection
  } satisfies CanvasPagePortMessage);
}

function applyLocalPatchMutation(document: CanvasDocument, patches: unknown[]): void {
  for (const patch of patches) {
    if (!isRecord(patch) || typeof patch.op !== "string") {
      continue;
    }
    if (patch.op === "node.insert") {
      const page = document.pages.find((entry) => entry.id === patch.pageId);
      const node = isRecord(patch.node) ? patch.node : null;
      if (!page || !node || typeof node.id !== "string" || typeof node.kind !== "string") {
        continue;
      }
      const inserted: CanvasNode = {
        id: node.id,
        kind: node.kind,
        name: typeof node.name === "string" ? node.name : node.id,
        pageId: typeof patch.pageId === "string" ? patch.pageId : page.id,
        parentId: typeof patch.parentId === "string" ? patch.parentId : null,
        childIds: Array.isArray(node.childIds) ? node.childIds.filter((entry): entry is string => typeof entry === "string") : [],
        rect: isRecord(node.rect) ? {
          x: typeof node.rect.x === "number" ? node.rect.x : 0,
          y: typeof node.rect.y === "number" ? node.rect.y : 0,
          width: typeof node.rect.width === "number" ? node.rect.width : 240,
          height: typeof node.rect.height === "number" ? node.rect.height : 120
        } : { x: 0, y: 0, width: 240, height: 120 },
        props: isRecord(node.props) ? { ...node.props } : {},
        style: isRecord(node.style) ? { ...node.style } : {},
        bindingRefs: isRecord(node.bindingRefs) ? { ...node.bindingRefs } : {},
        metadata: isRecord(node.metadata) ? { ...node.metadata } : {}
      };
      page.nodes.push(inserted);
      if (inserted.parentId) {
        const parent = page.nodes.find((entry) => entry.id === inserted.parentId);
        if (parent && !parent.childIds.includes(inserted.id)) {
          parent.childIds.push(inserted.id);
        }
      } else {
        page.rootNodeId = inserted.id;
      }
      continue;
    }
    if (patch.op === "node.remove" && typeof patch.nodeId === "string") {
      for (const page of document.pages) {
        page.nodes = page.nodes.filter((entry) => entry.id !== patch.nodeId);
        for (const node of page.nodes) {
          node.childIds = node.childIds.filter((entry) => entry !== patch.nodeId);
        }
        if (page.rootNodeId === patch.nodeId) {
          page.rootNodeId = null;
        }
      }
      continue;
    }
    if (patch.op === "node.update" && typeof patch.nodeId === "string" && isRecord(patch.changes)) {
      const node = findNode(document, patch.nodeId);
      if (!node) {
        continue;
      }
      for (const [path, value] of Object.entries(patch.changes)) {
        setNestedValue(node as unknown as Record<string, unknown>, path, value);
      }
    }
  }
}

function postViewState(): void {
  if (!currentState) {
    return;
  }
  port.postMessage({
    type: "canvas-page-view-state",
    viewport: currentState.viewport,
    selection: currentState.selection
  } satisfies CanvasPagePortMessage);
}

function schedulePersist(state: CanvasPageState): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    void flushPersist(state);
  }, SAVE_DEBOUNCE_MS);
}

async function flushPersist(state = currentState): Promise<void> {
  if (!state) {
    return;
  }
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  await saveCachedState(currentTabId, state);
  broadcastChannel?.postMessage({ type: "canvas-page:broadcast", state });
}

async function getCurrentTabId(): Promise<number | null> {
  return await new Promise((resolve) => {
    chrome.tabs.getCurrent((tab) => {
      const tabId = tab?.id;
      resolve(typeof tabId === "number" ? tabId : null);
    });
  });
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) {
    return await databasePromise;
  }
  if (typeof indexedDB === "undefined") {
    return null;
  }
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return await databasePromise;
}

async function loadCachedState(tabId: number | null): Promise<CanvasPageState | null> {
  const db = await openDatabase();
  if (!db || tabId === null) {
    return null;
  }
  const tabState = await readStoredState(db, `tab:${tabId}`);
  if (tabState) {
    return tabState;
  }
  return null;
}

async function readStoredState(db: IDBDatabase, key: string): Promise<CanvasPageState | null> {
  return await new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(normalizeCanvasPageState(request.result));
    request.onerror = () => resolve(null);
  });
}

async function saveCachedState(tabId: number | null, state: CanvasPageState): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    return;
  }
  const writes = [`doc:${state.documentId}`, `session:${state.canvasSessionId}`];
  if (tabId !== null) {
    writes.push(`tab:${tabId}`);
  }
  await Promise.all(writes.map((key) => writeStoredState(db, key, state)));
}

async function writeStoredState(db: IDBDatabase, key: string, state: CanvasPageState): Promise<void> {
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(state, key);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

function shouldAcceptBroadcast(state: CanvasPageState): boolean {
  if (!currentState) {
    return true;
  }
  return state.documentId === currentState.documentId && state.updatedAt >= currentState.updatedAt;
}

function normalizeCanvasPageState(value: unknown): CanvasPageState | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.tabId !== "number"
    || typeof value.targetId !== "string"
    || typeof value.canvasSessionId !== "string"
    || typeof value.documentId !== "string"
    || typeof value.title !== "string"
    || typeof value.html !== "string"
    || typeof value.updatedAt !== "string"
    || !isRecord(value.document)
  ) {
    return null;
  }
  const summary = normalizeCanvasSessionSummary(value.summary);
  return {
    tabId: value.tabId,
    targetId: value.targetId,
    canvasSessionId: value.canvasSessionId,
    documentId: value.documentId,
    documentRevision: typeof value.documentRevision === "number" ? value.documentRevision : null,
    title: value.title,
    document: normalizeDocument(value.document),
    html: value.html,
    previewMode: normalizePreviewState(value.previewMode) ?? "background",
    previewState: normalizePreviewState(value.previewState) ?? "background",
    updatedAt: value.updatedAt,
    summary,
    targets: normalizeCanvasTargetStateSummaries(value.targets ?? summary.targets),
    overlayMounts: Array.isArray(value.overlayMounts) ? value.overlayMounts.filter(isRecord) as CanvasPageState["overlayMounts"] : [],
    feedback: Array.isArray(value.feedback) ? value.feedback.filter(isRecord) as CanvasFeedbackEvent[] : [],
    feedbackCursor: typeof value.feedbackCursor === "string" ? value.feedbackCursor : null,
    selection: normalizeSelection(value.selection),
    viewport: normalizeViewport(value.viewport),
    pendingMutation: value.pendingMutation === true
  };
}

function normalizeDocument(value: Record<string, unknown>): CanvasDocument {
  return {
    documentId: typeof value.documentId === "string" ? value.documentId : "dc_unknown",
    title: typeof value.title === "string" ? value.title : "OpenDevBrowser Canvas",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    pages: Array.isArray(value.pages) ? value.pages.flatMap((entry) => normalizePage(entry)) : [],
    bindings: Array.isArray(value.bindings) ? value.bindings.flatMap((entry) => normalizeBinding(entry)) : [],
    assets: Array.isArray(value.assets) ? value.assets.flatMap((entry) => normalizeAsset(entry)) : [],
    componentInventory: Array.isArray(value.componentInventory)
      ? value.componentInventory.filter(isRecord)
      : []
  };
}

function normalizePage(value: unknown): CanvasDocument["pages"] {
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
    bindingRefs: isRecord(value.bindingRefs) ? value.bindingRefs : {},
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeBinding(value: unknown): CanvasDocument["bindings"] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.nodeId !== "string") {
    return [];
  }
  return [{
    id: value.id,
    nodeId: value.nodeId,
    kind: typeof value.kind === "string" ? value.kind : "component",
    componentName: typeof value.componentName === "string" ? value.componentName : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizeAsset(value: unknown): CanvasDocument["assets"] {
  if (!isRecord(value) || typeof value.id !== "string") {
    return [];
  }
  return [{
    id: value.id,
    sourceType: typeof value.sourceType === "string" ? value.sourceType : undefined,
    kind: typeof value.kind === "string" ? value.kind : undefined,
    repoPath: typeof value.repoPath === "string" ? value.repoPath : null,
    url: typeof value.url === "string" ? value.url : null,
    mime: typeof value.mime === "string" ? value.mime : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : {}
  }];
}

function normalizePreviewState(value: unknown): CanvasPageState["previewState"] | null {
  return value === "focused" || value === "pinned" || value === "background" || value === "degraded"
    ? value
    : null;
}

function normalizeSelection(value: unknown): CanvasEditorSelection {
  if (!isRecord(value)) {
    return { pageId: null, nodeId: null, targetId: null, updatedAt: new Date().toISOString() };
  }
  return {
    pageId: typeof value.pageId === "string" || value.pageId === null ? value.pageId : null,
    nodeId: typeof value.nodeId === "string" || value.nodeId === null ? value.nodeId : null,
    targetId: typeof value.targetId === "string" || value.targetId === null ? value.targetId : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
  };
}

function normalizeViewport(value: unknown): CanvasEditorViewport {
  if (!isRecord(value)) {
    return { ...DEFAULT_EDITOR_VIEWPORT };
  }
  return {
    x: typeof value.x === "number" ? value.x : DEFAULT_EDITOR_VIEWPORT.x,
    y: typeof value.y === "number" ? value.y : DEFAULT_EDITOR_VIEWPORT.y,
    zoom: typeof value.zoom === "number" ? value.zoom : DEFAULT_EDITOR_VIEWPORT.zoom
  };
}

function nodeText(node: CanvasNode): string {
  const raw = node.props.text ?? node.metadata.text;
  if (raw !== undefined && raw !== null) {
    return typeof raw === "string" ? raw : String(raw);
  }
  return node.kind === "text" || node.kind === "note" || node.kind === "component-instance"
    ? node.name
    : "";
}

function formatSummaryValue(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "n/a";
}

function formatAttachedClients(clients: CanvasSessionSummary["attachedClients"]): string {
  if (clients.length === 0) {
    return "none";
  }
  return clients
    .map((entry) => `${entry.clientId} (${entry.role === "lease_holder" ? "lease" : "observer"})`)
    .join(", ");
}

function formatCodeSyncStatus(summary: CanvasSessionSummary, watchConflict: boolean): string {
  if (!summary.codeSyncState && !summary.watchState && summary.bindings.length === 0) {
    return "not bound";
  }
  const segments = [
    summary.watchState ?? "idle",
    summary.codeSyncState ?? "idle",
    summary.driftState ?? "clean",
    watchConflict ? "watch conflict" : null
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return segments.join(" • ");
}

function formatProjectionSummary(summary: ReturnType<typeof summarizeCanvasProjectionState>): string {
  if (summary.activeProjections.length === 0) {
    return "n/a";
  }
  return summary.activeProjections.join(", ");
}

function readSummaryLibraryList(summary: Record<string, unknown>, key: "components" | "icons" | "styling"): string[] {
  const libraryPolicy = isRecord(summary.libraryPolicy) ? summary.libraryPolicy : null;
  return libraryPolicy ? readSummaryStringArray(libraryPolicy[key]) : [];
}

function readSummaryStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function formatSummaryList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatViewport(viewport: CanvasEditorViewport): string {
  return `View ${viewport.zoom.toFixed(2)}× @ ${viewport.x}, ${viewport.y}`;
}

function countFeedbackItems(events: CanvasFeedbackEvent[]): number {
  return events.filter((entry) => entry.eventType === "feedback.item").length;
}

function computeDocumentBounds(nodes: CanvasNode[]): { width: number; height: number } {
  if (nodes.length === 0) {
    return { width: 1600, height: 1200 };
  }
  const maxX = Math.max(...nodes.map((node) => node.rect.x + node.rect.width));
  const maxY = Math.max(...nodes.map((node) => node.rect.y + node.rect.height));
  return {
    width: Math.max(maxX + 240, 1600),
    height: Math.max(maxY + 240, 1200)
  };
}

function queueViewportFitIfNeeded(): void {
  if (!currentState || !isDefaultEditorViewport(currentState.viewport)) {
    return;
  }
  const page = currentState.document.pages[0];
  if (!page || page.nodes.length === 0) {
    return;
  }
  if (fitViewportFrame !== null) {
    cancelAnimationFrame(fitViewportFrame);
  }
  fitViewportFrame = requestAnimationFrame(() => {
    fitViewportFrame = null;
    if (!currentState || !isDefaultEditorViewport(currentState.viewport)) {
      return;
    }
    const nextViewport = resolvePreferredViewport(currentState);
    if (
      nextViewport.x === currentState.viewport.x
      && nextViewport.y === currentState.viewport.y
      && nextViewport.zoom === currentState.viewport.zoom
    ) {
      return;
    }
    currentState.viewport = nextViewport;
    toolbarMetaElement.textContent = formatViewport(currentState.viewport);
    renderStage();
    postViewState();
    schedulePersist(currentState);
  });
}

function resolvePreferredViewport(state: CanvasPageState): CanvasEditorViewport {
  const page = state.document.pages[0];
  if (!page || page.nodes.length === 0) {
    return { ...DEFAULT_EDITOR_VIEWPORT };
  }
  return computeFittedViewport(page.nodes, stageElement.clientWidth, stageElement.clientHeight);
}

function findNode(document: CanvasDocument | null, nodeId: string): CanvasNode | null {
  if (!document) {
    return null;
  }
  for (const page of document.pages) {
    const match = page.nodes.find((node) => node.id === nodeId);
    if (match) {
      return match;
    }
  }
  return null;
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!segment) {
      return;
    }
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (!last) {
    return;
  }
  current[last] = value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
