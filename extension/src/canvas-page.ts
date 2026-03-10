import type {
  CanvasDocument,
  CanvasEditorSelection,
  CanvasEditorViewport,
  CanvasFeedbackEvent,
  CanvasNode,
  CanvasPageMessage,
  CanvasPagePortMessage,
  CanvasPageState
} from "./canvas/model.js";

const DB_NAME = "opendevbrowser-canvas";
const DB_VERSION = 2;
const STORE_NAME = "editor-state";
const CHANNEL_NAME = "opendevbrowser-canvas";
const SAVE_DEBOUNCE_MS = 180;

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

const broadcastChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
const port = chrome.runtime.connect({ name: "canvas-page" });

let currentState: CanvasPageState | null = null;
let currentTabId: number | null = null;
let databasePromise: Promise<IDBDatabase | null> | null = null;
let persistTimer: number | null = null;
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
    const center = viewportCanvasCenter(currentState.viewport);
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
    currentState.viewport = { x: 120, y: 96, zoom: 1 };
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
  if (!message || (message.type !== "canvas-page:init" && message.type !== "canvas-page:update" && message.type !== "canvas-page:closed")) {
    return;
  }
  if (message.type === "canvas-page:closed") {
    currentState = null;
    previewElement.srcdoc = "";
    emptyElement.hidden = false;
    renderMeta(`Canvas closed${message.reason ? `: ${message.reason}` : "."}`);
    stageInnerElement.innerHTML = "";
    return;
  }
  const state = normalizeCanvasPageState(message.state);
  if (!state) {
    return;
  }
  applyState(state, true);
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
  if (persist) {
    schedulePersist(state);
  }
}

function renderState(): void {
  if (!currentState) {
    return;
  }
  stageMetaElement.textContent = `${currentState.document.pages[0]?.nodes.length ?? 0} nodes • ${currentState.pendingMutation ? "sync pending" : "live"}`;
  renderStage();
  renderInspector();
}

function renderBadges(state: CanvasPageState): void {
  badgesElement.innerHTML = "";
  for (const label of [
    state.previewState,
    state.previewMode,
    state.documentRevision === null ? "revision pending" : `revision ${state.documentRevision}`,
    state.pendingMutation ? "sync pending" : "synced"
  ]) {
    const badge = document.createElement("span");
    badge.className = "canvas-badge";
    badge.textContent = label;
    badgesElement.append(badge);
  }
}

function renderMeta(text: string): void {
  metaElement.textContent = text;
}

function renderSummary(summary: Record<string, unknown>, state: CanvasPageState): void {
  summaryElement.innerHTML = "";
  const items: Array<[string, string]> = [
    ["Target", state.targetId],
    ["Session", formatSummaryValue(summary.canvasSessionId)],
    ["Mode", formatSummaryValue(summary.mode)],
    ["Plan", formatSummaryValue(summary.planStatus)],
    ["Preflight", formatSummaryValue(summary.preflightState)],
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
  for (const node of page.nodes) {
    const element = document.createElement(node.kind === "text" ? "p" : node.kind === "note" ? "aside" : "div");
    element.className = "canvas-node";
    element.dataset.nodeId = node.id;
    element.dataset.selected = String(currentState.selection.nodeId === node.id);
    element.style.left = `${node.rect.x}px`;
    element.style.top = `${node.rect.y}px`;
    element.style.width = `${Math.max(node.rect.width, 80)}px`;
    element.style.height = `${Math.max(node.rect.height, 48)}px`;
    const kind = document.createElement("div");
    kind.className = "canvas-node-kind";
    kind.textContent = node.kind;
    const title = document.createElement("div");
    title.className = "canvas-node-name";
    title.textContent = node.name;
    const body = document.createElement("div");
    body.className = "canvas-node-body";
    body.textContent = nodeText(node);
    element.append(kind, title, body);
    stageInnerElement.append(element);
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
    summary: isRecord(value.summary) ? value.summary : {},
    targets: Array.isArray(value.targets) ? value.targets.filter(isRecord) as CanvasPageState["targets"] : [],
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
    pages: Array.isArray(value.pages) ? value.pages.flatMap((entry) => normalizePage(entry)) : []
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
    return { x: 120, y: 96, zoom: 1 };
  }
  return {
    x: typeof value.x === "number" ? value.x : 120,
    y: typeof value.y === "number" ? value.y : 96,
    zoom: typeof value.zoom === "number" ? value.zoom : 1
  };
}

function nodeText(node: CanvasNode): string {
  const raw = node.props.text ?? node.metadata.text ?? node.name;
  return typeof raw === "string" ? raw : String(raw ?? "");
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

function viewportCanvasCenter(viewport: CanvasEditorViewport): { x: number; y: number } {
  return {
    x: (480 - viewport.x) / viewport.zoom,
    y: (320 - viewport.y) / viewport.zoom
  };
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
