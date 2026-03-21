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
  summarizeCanvasHistoryState,
  readLatestImportProvenance,
  readSelectedBindingIdentity,
  normalizeCanvasSessionSummary,
  normalizeCanvasTargetStateSummaries
} from "./canvas/model.js";
import {
  buildCanvasAnnotationPayload,
  describeAnnotationItem,
  formatAnnotationDispatchReceipt,
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
const pageDetailsElement = requiredElement("canvas-page-details");
const pageSelectElement = requiredElement("canvas-page-select") as HTMLSelectElement;
const layersTreeElement = requiredElement("canvas-layers-tree");
const selectionMetaElement = requiredElement("canvas-selection-meta");
const stageElement = requiredElement("canvas-stage");
const stageInnerElement = requiredElement("canvas-stage-inner");
const stageOverlayElement = requiredElement("canvas-stage-overlay");
const stageMetaElement = requiredElement("canvas-stage-meta");
const stageHintElement = requiredElement("canvas-stage-hint");
const previewElement = requiredElement("canvas-preview") as HTMLIFrameElement;
const emptyElement = requiredElement("canvas-empty");
const historyUndoButton = requiredElement("canvas-history-undo") as HTMLButtonElement;
const historyRedoButton = requiredElement("canvas-history-redo") as HTMLButtonElement;
const panelHistoryUndoButton = requiredElement("canvas-history-panel-undo") as HTMLButtonElement;
const panelHistoryRedoButton = requiredElement("canvas-history-panel-redo") as HTMLButtonElement;
const historyStatusElement = requiredElement("canvas-history-status");
const nameInput = requiredElement("canvas-node-name") as HTMLInputElement;
const textInput = requiredElement("canvas-node-text") as HTMLTextAreaElement;
const nodeXInput = requiredElement("canvas-node-x") as HTMLInputElement;
const nodeYInput = requiredElement("canvas-node-y") as HTMLInputElement;
const nodeWidthInput = requiredElement("canvas-node-width") as HTMLInputElement;
const nodeHeightInput = requiredElement("canvas-node-height") as HTMLInputElement;
const paddingInput = requiredElement("canvas-style-padding") as HTMLInputElement;
const gapInput = requiredElement("canvas-style-gap") as HTMLInputElement;
const fontSizeInput = requiredElement("canvas-style-font-size") as HTMLInputElement;
const fontWeightInput = requiredElement("canvas-style-font-weight") as HTMLInputElement;
const lineHeightInput = requiredElement("canvas-style-line-height") as HTMLInputElement;
const colorInput = requiredElement("canvas-style-color") as HTMLInputElement;
const backgroundInput = requiredElement("canvas-style-background") as HTMLInputElement;
const borderColorInput = requiredElement("canvas-style-border-color") as HTMLInputElement;
const borderWidthInput = requiredElement("canvas-style-border-width") as HTMLInputElement;
const borderRadiusInput = requiredElement("canvas-style-border-radius") as HTMLInputElement;
const shadowInput = requiredElement("canvas-style-shadow") as HTMLInputElement;
const bindingKindInput = requiredElement("canvas-binding-kind") as HTMLInputElement;
const bindingComponentInput = requiredElement("canvas-binding-component") as HTMLInputElement;
const bindingSelectorInput = requiredElement("canvas-binding-selector") as HTMLInputElement;
const a11yRoleInput = requiredElement("canvas-a11y-role") as HTMLInputElement;
const a11yLabelInput = requiredElement("canvas-a11y-label") as HTMLInputElement;
const propertiesStatusElement = requiredElement("canvas-properties-status");
const tokenStatusElement = requiredElement("canvas-token-status");
const tokenCollectionSelect = requiredElement("canvas-token-collection-select") as HTMLSelectElement;
const tokenCollectionNameInput = requiredElement("canvas-token-collection-name") as HTMLInputElement;
const tokenCollectionCreateButton = requiredElement("canvas-token-collection-create") as HTMLButtonElement;
const tokenModeSelect = requiredElement("canvas-token-mode-select") as HTMLSelectElement;
const tokenModeNameInput = requiredElement("canvas-token-mode-name") as HTMLInputElement;
const tokenModeCreateButton = requiredElement("canvas-token-mode-create") as HTMLButtonElement;
const tokenPathInput = requiredElement("canvas-token-path") as HTMLInputElement;
const tokenValueInput = requiredElement("canvas-token-value") as HTMLInputElement;
const tokenAliasInput = requiredElement("canvas-token-alias") as HTMLInputElement;
const tokenBindingPropertySelect = requiredElement("canvas-token-binding-property") as HTMLSelectElement;
const tokenSaveButton = requiredElement("canvas-token-save") as HTMLButtonElement;
const tokenBindButton = requiredElement("canvas-token-bind") as HTMLButtonElement;
const tokenBindingClearButton = requiredElement("canvas-token-binding-clear") as HTMLButtonElement;
const tokenSummaryElement = requiredElement("canvas-token-summary");
const tokenUsageElement = requiredElement("canvas-token-usage");
const duplicateNodeButton = requiredElement("canvas-duplicate-node") as HTMLButtonElement;
const addNoteButton = requiredElement("canvas-add-note") as HTMLButtonElement;
const resetViewButton = requiredElement("canvas-reset-view") as HTMLButtonElement;
const deleteNodeButton = requiredElement("canvas-delete-node") as HTMLButtonElement;
const annotationModeSelect = requiredElement("canvas-annotation-mode") as HTMLSelectElement;
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
let activePageId: string | null = null;
let annotationMode: "selected" | "region" = "selected";
let annotationDrafts: CanvasAnnotationDraft[] = [];
let expandedLayerNodeIds = new Set<string>();
let selectedTokenCollectionId = "__values__";
let selectedTokenModeId = "__base__";
let selectedTokenPath = "";
let draggingNode: {
  nodeId: string;
  originX: number;
  originY: number;
  startRectX: number;
  startRectY: number;
} | null = null;
let layerDragState: { nodeId: string } | null = null;
let panningState: {
  originX: number;
  originY: number;
  startX: number;
  startY: number;
} | null = null;
let marqueeState: {
  originClientX: number;
  originClientY: number;
  currentClientX: number;
  currentClientY: number;
  targetNodeId: string | null;
} | null = null;
let spacePanActive = false;

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
  bindTokenPanel();
  bindToolbar();
  bindAnnotationPanel();
  bindPageSelector();
  bindKeyboardShortcuts();
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
  const handleUndo = () => {
    requestHistory("undo");
  };
  const handleRedo = () => {
    requestHistory("redo");
  };
  historyUndoButton.addEventListener("click", handleUndo);
  historyRedoButton.addEventListener("click", handleRedo);
  panelHistoryUndoButton.addEventListener("click", handleUndo);
  panelHistoryRedoButton.addEventListener("click", handleRedo);
  duplicateNodeButton.addEventListener("click", () => {
    duplicateSelectedNode();
  });
  addNoteButton.addEventListener("click", () => {
    if (!currentState || currentState.pendingMutation) {
      return;
    }
    const page = getActivePage();
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
  annotationModeSelect.addEventListener("change", () => {
    annotationMode = annotationModeSelect.value === "region" ? "region" : "selected";
    renderState();
  });
  annotationAddButton.addEventListener("click", () => {
    if (annotationMode === "region") {
      setCanvasButtonFeedback(annotationAddButton, "Drag on stage");
      return;
    }
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

function bindPageSelector(): void {
  pageSelectElement.addEventListener("change", () => {
    if (!currentState) {
      return;
    }
    const pageId = pageSelectElement.value || null;
    setActivePage(pageId, { clearSelectionIfMissing: true, broadcast: true });
  });
}

function bindKeyboardShortcuts(): void {
  document.addEventListener("keydown", (event) => {
    if (!currentState) {
      return;
    }
    if (event.key === " ") {
      if (!isEditableTarget(event.target)) {
        spacePanActive = true;
        stageElement.dataset.mode = "panning";
        event.preventDefault();
      }
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      requestHistory(event.shiftKey ? "redo" : "undo");
      return;
    }
    if (modifier && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelectedNode();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && currentState.selection.nodeId) {
      event.preventDefault();
      deleteNodeButton.click();
      return;
    }
    if (event.key.startsWith("Arrow") && currentState.selection.nodeId && !event.altKey) {
      event.preventDefault();
      nudgeSelectedNode(event.key, event.shiftKey ? 10 : 1);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      fitActivePageViewport();
      return;
    }
    if (event.key === "1") {
      event.preventDefault();
      resetZoomToDefault();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === " ") {
      spacePanActive = false;
      if (!panningState) {
        stageElement.dataset.mode = "";
      }
    }
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

  bindFieldCommit(nodeXInput, () => {
    commitSelectedNodeChanges({ "rect.x": readNumberInput(nodeXInput, getSelectedNode()?.rect.x ?? 0) });
  });
  bindFieldCommit(nodeYInput, () => {
    commitSelectedNodeChanges({ "rect.y": readNumberInput(nodeYInput, getSelectedNode()?.rect.y ?? 0) });
  });
  bindFieldCommit(nodeWidthInput, () => {
    commitSelectedNodeChanges({ "rect.width": Math.max(readNumberInput(nodeWidthInput, getSelectedNode()?.rect.width ?? 1), 1) });
  });
  bindFieldCommit(nodeHeightInput, () => {
    commitSelectedNodeChanges({ "rect.height": Math.max(readNumberInput(nodeHeightInput, getSelectedNode()?.rect.height ?? 1), 1) });
  });
  bindFieldCommit(paddingInput, () => {
    commitSelectedNodeChanges({ "style.padding": readTextInput(paddingInput) });
  });
  bindFieldCommit(gapInput, () => {
    commitSelectedNodeChanges({ "style.gap": readTextInput(gapInput) });
  });
  bindFieldCommit(fontSizeInput, () => {
    commitSelectedNodeChanges({ "style.fontSize": readTextInput(fontSizeInput) });
  });
  bindFieldCommit(fontWeightInput, () => {
    commitSelectedNodeChanges({ "style.fontWeight": readTextInput(fontWeightInput) });
  });
  bindFieldCommit(lineHeightInput, () => {
    commitSelectedNodeChanges({ "style.lineHeight": readTextInput(lineHeightInput) });
  });
  bindFieldCommit(colorInput, () => {
    commitSelectedNodeChanges({ "style.color": readTextInput(colorInput) });
  });
  bindFieldCommit(backgroundInput, () => {
    commitSelectedNodeChanges({ "style.backgroundColor": readTextInput(backgroundInput) });
  });
  bindFieldCommit(borderColorInput, () => {
    commitSelectedNodeChanges({ "style.borderColor": readTextInput(borderColorInput) });
  });
  bindFieldCommit(borderWidthInput, () => {
    commitSelectedNodeChanges({ "style.borderWidth": readTextInput(borderWidthInput) });
  });
  bindFieldCommit(borderRadiusInput, () => {
    commitSelectedNodeChanges({ "style.borderRadius": readTextInput(borderRadiusInput) });
  });
  bindFieldCommit(shadowInput, () => {
    commitSelectedNodeChanges({ "style.boxShadow": readTextInput(shadowInput) });
  });
  bindFieldCommit(a11yRoleInput, () => {
    commitSelectedNodeChanges({ "metadata.accessibility.role": readTextInput(a11yRoleInput) });
  });
  bindFieldCommit(a11yLabelInput, () => {
    commitSelectedNodeChanges({ "metadata.accessibility.label": readTextInput(a11yLabelInput) });
  });
  bindFieldCommit(bindingKindInput, () => {
    commitSelectedBindingPatch();
  });
  bindFieldCommit(bindingComponentInput, () => {
    commitSelectedBindingPatch();
  });
  bindFieldCommit(bindingSelectorInput, () => {
    commitSelectedBindingPatch();
  });
}

function bindTokenPanel(): void {
  tokenCollectionSelect.addEventListener("change", () => {
    selectedTokenCollectionId = tokenCollectionSelect.value || "__values__";
    selectedTokenModeId = selectedTokenCollectionId === "__values__" ? "__base__" : tokenModeSelect.value || "__base__";
    syncTokenEditorSelection();
    renderTokenSummary();
  });
  tokenCollectionCreateButton.addEventListener("click", () => {
    createTokenCollection();
  });
  tokenModeSelect.addEventListener("change", () => {
    selectedTokenModeId = tokenModeSelect.value || "__base__";
    updateActiveTokenMode();
    syncTokenEditorSelection();
    renderTokenSummary();
  });
  tokenModeCreateButton.addEventListener("click", () => {
    createTokenMode();
  });
  tokenPathInput.addEventListener("input", () => {
    selectedTokenPath = normalizeTokenPath(tokenPathInput.value);
    renderTokenSummary();
  });
  tokenSaveButton.addEventListener("click", () => {
    saveTokenEditor();
  });
  tokenBindButton.addEventListener("click", () => {
    bindSelectedNodeToToken();
  });
  tokenBindingClearButton.addEventListener("click", () => {
    clearSelectedTokenBinding();
  });
}

function bindStageInteractions(): void {
  stageElement.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-node-id]") : null;
    const targetNodeId = target?.dataset.nodeId ?? null;
    if (!currentState) {
      return;
    }
    if (annotationMode === "region" && event.button === 0) {
      marqueeState = {
        originClientX: event.clientX,
        originClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        targetNodeId
      };
      renderStageOverlay();
      stageElement.setPointerCapture(event.pointerId);
      return;
    }
    if (spacePanActive) {
      panningState = {
        originX: event.clientX,
        originY: event.clientY,
        startX: currentState.viewport.x,
        startY: currentState.viewport.y
      };
      stageElement.dataset.mode = "panning";
      stageElement.setPointerCapture(event.pointerId);
      return;
    }
    if (target) {
      const node = targetNodeId ? findNode(currentState.document, targetNodeId) : null;
      if (!node) {
        return;
      }
      currentState.selection = {
        pageId: node.pageId ?? getActivePage()?.id ?? null,
        nodeId: node.id,
        targetId: currentState.selection.targetId,
        updatedAt: new Date().toISOString()
      };
      activePageId = node.pageId ?? activePageId;
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
    if (marqueeState) {
      marqueeState.currentClientX = event.clientX;
      marqueeState.currentClientY = event.clientY;
      renderStageOverlay();
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
      marqueeState = null;
      stageElement.dataset.mode = "";
      renderStageOverlay();
      return;
    }
    if (marqueeState) {
      const completedMarquee = marqueeState;
      marqueeState = null;
      renderStageOverlay();
      if (annotationMode === "region") {
        commitAnnotationCapture(completedMarquee);
      }
    } else if (draggingNode && !currentState.pendingMutation) {
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
    stageElement.dataset.mode = spacePanActive ? "panning" : "";
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
  if (!activePageId || !state.document.pages.some((page) => page.id === activePageId)) {
    activePageId = state.selection.pageId ?? state.document.pages[0]?.id ?? null;
  }
  annotationModeSelect.value = annotationMode;
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
    renderHistoryState();
    renderTokenSummary();
    return;
  }
  const projectionSummary = summarizeCanvasProjectionState(currentState.summary, currentState.targets);
  const activePage = getActivePage();
  const syncFragments = [
    currentState.pendingMutation ? "sync pending" : "live",
    currentState.summary.codeSyncState ?? null,
    projectionSummary.conflictCount > 0 ? `${projectionSummary.conflictCount} conflict${projectionSummary.conflictCount === 1 ? "" : "s"}` : null
  ].filter((entry): entry is string => typeof entry === "string");
  stageMetaElement.textContent = `${activePage?.nodes.length ?? 0} nodes • ${syncFragments.join(" • ")}`;
  stageHintElement.textContent = annotationMode === "region"
    ? "Drag on the stage to capture a region, or click a node to capture it."
    : "Drag to pan. Scroll to zoom. Drag nodes to move them.";
  renderPagesAndLayers();
  renderHistoryState();
  renderStage();
  renderInspector();
  renderTokenSummary();
  syncAnnotationDrafts();
}

function renderBadges(state: CanvasPageState): void {
  badgesElement.innerHTML = "";
  const projectionSummary = summarizeCanvasProjectionState(state.summary, state.targets);
  const latestImport = readLatestImportProvenance(state.summary, state.document);
  for (const label of [
    state.previewState,
    state.previewMode,
    state.documentRevision === null ? "revision pending" : `revision ${state.documentRevision}`,
    state.pendingMutation ? "sync pending" : "synced",
    state.summary.codeSyncState,
    projectionSummary.activeProjections[0],
    projectionSummary.conflictCount > 0 ? `${projectionSummary.conflictCount} conflicts` : null,
    latestImport ? `import ${latestImport}` : null
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
  const appliedStarter = formatAppliedStarterSummary(summary, state.document);
  const latestImport = readLatestImportProvenance(summary, state.document);
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
    ["Starters", typeof summary.availableStarterCount === "number" ? `${summary.availableStarterCount} available` : "n/a"],
    ["Applied starter", appliedStarter],
    ["Inventory sources", inventorySources],
    ["Targets", String(state.targets.length)],
    ["Overlays", String(state.overlayMounts.length)],
    ["Feedback", String(countFeedbackItems(state.feedback))],
    ["History", summarizeCanvasHistoryState(summary)],
    ["Latest import", latestImport ?? "none"]
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

function formatAppliedStarterSummary(summary: CanvasSessionSummary, documentState: CanvasDocument): string {
  const starter = isRecord(documentState.meta.starter) ? documentState.meta.starter : null;
  const name = summary.starterName
    ?? (typeof starter?.template === "object" && starter.template && typeof (starter.template as Record<string, unknown>).name === "string"
      ? (starter.template as Record<string, unknown>).name as string
      : null);
  if (!name) {
    return "none";
  }
  const frameworkId = summary.starterFrameworkId
    ?? (typeof starter?.frameworkId === "string" ? starter.frameworkId : null);
  const appliedAt = summary.starterAppliedAt
    ?? (typeof starter?.appliedAt === "string" ? starter.appliedAt : null);
  return [name, frameworkId, appliedAt].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).join(" • ");
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

function renderHistoryState(): void {
  const history = currentState?.summary.history;
  const canUndo = Boolean(history?.canUndo) && !currentState?.pendingMutation;
  const canRedo = Boolean(history?.canRedo) && !currentState?.pendingMutation;
  historyUndoButton.disabled = !canUndo;
  historyRedoButton.disabled = !canRedo;
  panelHistoryUndoButton.disabled = !canUndo;
  panelHistoryRedoButton.disabled = !canRedo;
  historyStatusElement.textContent = currentState ? summarizeCanvasHistoryState(currentState.summary) : "No history yet";
}

function renderPagesAndLayers(): void {
  pageSelectElement.innerHTML = "";
  layersTreeElement.innerHTML = "";
  if (!currentState) {
    pageDetailsElement.textContent = "Waiting for canvas state.";
    const empty = document.createElement("div");
    empty.className = "canvas-empty-inline";
    empty.textContent = "No pages loaded.";
    layersTreeElement.append(empty);
    return;
  }
  const activePage = getActivePage();
  for (const page of currentState.document.pages) {
    const option = document.createElement("option");
    option.value = page.id;
    option.textContent = `${page.name} (${page.nodes.length})`;
    option.selected = page.id === activePage?.id;
    pageSelectElement.append(option);
  }
  pageSelectElement.disabled = currentState.document.pages.length <= 1;
  if (!activePage) {
    pageDetailsElement.textContent = "No page selected.";
    const empty = document.createElement("div");
    empty.className = "canvas-empty-inline";
    empty.textContent = "No nodes on this page.";
    layersTreeElement.append(empty);
    return;
  }
  ensureExpandedNodePath(activePage, currentState.selection.nodeId);
  pageDetailsElement.textContent = `${activePage.path} • ${activePage.nodes.length} nodes`;
  const rootNodes = getRootNodes(activePage);
  if (rootNodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "canvas-empty-inline";
    empty.textContent = "No nodes on this page.";
    layersTreeElement.append(empty);
    return;
  }
  for (const node of rootNodes) {
    layersTreeElement.append(renderLayerNode(activePage, node, 0));
  }
}

function renderLayerNode(
  page: CanvasDocument["pages"][number],
  node: CanvasNode,
  depth: number
): HTMLElement {
  const row = document.createElement("div");
  row.className = "canvas-layer-row";
  row.dataset.nodeId = node.id;
  row.dataset.selected = String(currentState?.selection.nodeId === node.id);
  row.dataset.hidden = String(isNodeHidden(node));
  row.draggable = true;
  row.style.marginLeft = `${depth * 14}px`;

  const head = document.createElement("div");
  head.className = "canvas-layer-head";

  const toggleButton = document.createElement("button");
  toggleButton.className = "canvas-button canvas-layer-toggle";
  toggleButton.type = "button";
  toggleButton.textContent = node.childIds.length > 0 ? (expandedLayerNodeIds.has(node.id) ? "−" : "+") : "·";
  toggleButton.disabled = node.childIds.length === 0;
  toggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (expandedLayerNodeIds.has(node.id)) {
      expandedLayerNodeIds.delete(node.id);
    } else {
      expandedLayerNodeIds.add(node.id);
    }
    renderPagesAndLayers();
  });

  const visibilityButton = document.createElement("button");
  visibilityButton.className = "canvas-button canvas-layer-visibility";
  visibilityButton.type = "button";
  visibilityButton.textContent = isNodeHidden(node) ? "🙈" : "👁";
  visibilityButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!currentState?.pendingMutation) {
      applyOptimisticPatch([{ op: "node.visibility.set", nodeId: node.id, hidden: !isNodeHidden(node) }], {
        pageId: page.id,
        nodeId: node.id,
        targetId: currentState?.selection.targetId ?? null
      });
    }
  });

  const main = document.createElement("div");
  main.className = "canvas-layer-main";
  main.addEventListener("click", () => {
    selectNode(node.id, page.id);
  });

  const renameInput = document.createElement("input");
  renameInput.className = "canvas-layer-name-input";
  renameInput.value = node.name;
  renameInput.disabled = Boolean(currentState?.pendingMutation);
  renameInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  renameInput.addEventListener("change", () => {
    if (!currentState?.pendingMutation && renameInput.value.trim().length > 0 && renameInput.value !== node.name) {
      applyOptimisticPatch([{ op: "node.update", nodeId: node.id, changes: { name: renameInput.value.trim() } }], {
        pageId: page.id,
        nodeId: node.id,
        targetId: currentState?.selection.targetId ?? null
      });
    }
  });

  const meta = document.createElement("div");
  meta.className = "canvas-layer-meta";
  meta.textContent = [node.kind, node.childIds.length > 0 ? `${node.childIds.length} children` : "leaf", isNodeHidden(node) ? "hidden" : "visible"].join(" • ");

  main.append(renameInput, meta);
  head.append(toggleButton, visibilityButton, main);
  row.append(head);

  row.addEventListener("dragstart", (event) => {
    layerDragState = { nodeId: node.id };
    event.dataTransfer?.setData("text/plain", node.id);
  });
  row.addEventListener("dragend", () => {
    layerDragState = null;
  });
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const draggedId = layerDragState?.nodeId;
    if (!draggedId || draggedId === node.id) {
      return;
    }
    commitLayerMove(draggedId, node.parentId ?? null, findSiblingInsertIndex(page, node.id));
  });

  if (node.childIds.length > 0) {
    const children = document.createElement("div");
    children.className = "canvas-layer-children";
    children.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    children.addEventListener("drop", (event) => {
      event.preventDefault();
      const draggedId = layerDragState?.nodeId;
      if (!draggedId || draggedId === node.id) {
        return;
      }
      commitLayerMove(draggedId, node.id, node.childIds.length);
    });
    if (expandedLayerNodeIds.has(node.id)) {
      for (const childId of node.childIds) {
        const child = page.nodes.find((entry) => entry.id === childId);
        if (child) {
          children.append(renderLayerNode(page, child, depth + 1));
        }
      }
    }
    row.append(children);
  }

  return row;
}

function renderTokenSummary(): void {
  populateTokenControls();
  tokenSummaryElement.innerHTML = "";
  tokenUsageElement.innerHTML = "";
  const controlsDisabled = !currentState || Boolean(currentState.pendingMutation);
  for (const control of [
    tokenCollectionSelect,
    tokenCollectionNameInput,
    tokenCollectionCreateButton,
    tokenModeSelect,
    tokenModeNameInput,
    tokenModeCreateButton,
    tokenPathInput,
    tokenValueInput,
    tokenAliasInput,
    tokenBindingPropertySelect,
    tokenSaveButton,
    tokenBindButton,
    tokenBindingClearButton
  ]) {
    control.disabled = controlsDisabled;
  }
  if (!currentState) {
    tokenStatusElement.textContent = "Waiting for canvas state...";
    const empty = document.createElement("div");
    empty.className = "canvas-empty-inline";
    empty.textContent = "Waiting for canvas state...";
    tokenSummaryElement.append(empty.cloneNode(true));
    tokenUsageElement.append(empty);
    return;
  }
  const node = getSelectedNode();
  const normalizedPath = normalizeTokenPath(selectedTokenPath || tokenPathInput.value);
  const resolvedValue = normalizedPath
    ? resolveTokenValue(currentState.document.tokens, normalizedPath, selectedTokenModeId === "__base__" ? null : selectedTokenModeId)
    : null;
  const aliasTarget = normalizedPath
    ? readTokenAliasTarget(currentState.document.tokens, normalizedPath, selectedTokenModeId === "__base__" ? null : selectedTokenModeId)
    : null;
  const bindingProperty = tokenBindingPropertySelect.value || "backgroundColor";
  tokenPathInput.value = selectedTokenPath;
  tokenValueInput.value = formatTokenEditorValue(resolvedValue);
  tokenAliasInput.value = aliasTarget ?? "";
  tokenBindButton.disabled = controlsDisabled || !node || normalizedPath.length === 0;
  tokenBindingClearButton.disabled = controlsDisabled || !node || !hasSelectedTokenBinding(node, bindingProperty);
  tokenStatusElement.textContent = normalizedPath
    ? aliasTarget
      ? `${normalizedPath} aliases ${aliasTarget}${resolvedValue !== null ? ` • ${formatTokenEditorValue(resolvedValue)}` : ""}`
      : `${normalizedPath}${resolvedValue !== null ? ` • ${formatTokenEditorValue(resolvedValue)}` : ""}`
    : "Edit collections, modes, aliases, and bindings.";
  if (!node) {
    const empty = document.createElement("div");
    empty.className = "canvas-empty-inline";
    empty.textContent = "Select a node to inspect token usage.";
    tokenSummaryElement.append(empty);
  } else {
    const tokenRefs = Object.entries(isRecord(node.tokenRefs) ? node.tokenRefs : {});
    if (tokenRefs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "canvas-empty-inline";
      empty.textContent = "No token bindings on this node.";
      tokenSummaryElement.append(empty);
    } else {
      for (const [property, value] of tokenRefs) {
        const row = document.createElement("div");
        row.className = "canvas-token-item";
        const title = document.createElement("div");
        title.className = "canvas-summary-label";
        title.textContent = property;
        const body = document.createElement("div");
        body.className = "canvas-summary-value";
        const tokenPath = readTokenPath(value);
        const resolved = tokenPath
          ? resolveTokenValue(currentState.document.tokens, tokenPath, readActiveTokenModeId(currentState.document.tokens))
          : null;
        body.textContent = tokenPath
          ? resolved !== null ? `${tokenPath} → ${formatTokenEditorValue(resolved)}` : tokenPath
          : JSON.stringify(value);
        row.append(title, body);
        tokenSummaryElement.append(row);
      }
    }
  }

  const usages = normalizedPath ? collectTokenUsages(currentState.document, normalizedPath) : [];
  if (usages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "canvas-empty-inline";
    empty.textContent = normalizedPath ? "No bound nodes use this token yet." : "Choose a token path to inspect usage.";
    tokenUsageElement.append(empty);
    return;
  }
  for (const usage of usages) {
    const row = document.createElement("div");
    row.className = "canvas-summary-item";
    const title = document.createElement("div");
    title.className = "canvas-summary-label";
    title.textContent = `${usage.pageName} • ${usage.property}`;
    const body = document.createElement("div");
    body.className = "canvas-summary-value";
    body.textContent = `${usage.nodeName} (${usage.nodeId})${usage.resolvedValue !== null ? ` → ${formatTokenEditorValue(usage.resolvedValue)}` : ""}`;
    row.append(title, body);
    tokenUsageElement.append(row);
  }
}

function populateTokenControls(): void {
  if (!currentState) {
    tokenCollectionSelect.innerHTML = "";
    tokenModeSelect.innerHTML = "";
    return;
  }
  const tokens = currentState.document.tokens;
  const collections = [
    { id: "__values__", name: "Values" },
    ...tokens.collections.map((collection) => ({ id: collection.id, name: collection.name }))
  ];
  if (!collections.some((entry) => entry.id === selectedTokenCollectionId)) {
    selectedTokenCollectionId = findTokenCollectionId(tokens, selectedTokenPath) ?? "__values__";
  }
  tokenCollectionSelect.innerHTML = collections
    .map((collection) => `<option value="${escapeHtmlAttribute(collection.id)}">${escapeHtmlText(collection.name)}</option>`)
    .join("");
  tokenCollectionSelect.value = selectedTokenCollectionId;

  const modes = listTokenModes(tokens, selectedTokenCollectionId);
  if (!modes.some((entry) => entry.id === selectedTokenModeId)) {
    const activeModeId = readActiveTokenModeId(tokens);
    selectedTokenModeId = activeModeId && modes.some((entry) => entry.id === activeModeId) ? activeModeId : "__base__";
  }
  tokenModeSelect.innerHTML = modes
    .map((mode) => `<option value="${escapeHtmlAttribute(mode.id)}">${escapeHtmlText(mode.name)}</option>`)
    .join("");
  tokenModeSelect.value = selectedTokenModeId;
}

function renderStage(): void {
  if (!currentState) {
    stageInnerElement.innerHTML = "";
    renderStageOverlay();
    return;
  }
  const page = getActivePage();
  if (!page) {
    stageInnerElement.innerHTML = "";
    renderStageOverlay();
    return;
  }
  const visibleNodes = page.nodes.filter((node) => !isNodeHidden(node));
  const bounds = computeDocumentBounds(visibleNodes);
  stageInnerElement.style.width = `${bounds.width}px`;
  stageInnerElement.style.height = `${bounds.height}px`;
  stageInnerElement.style.transform = `translate(${currentState.viewport.x}px, ${currentState.viewport.y}px) scale(${currentState.viewport.zoom})`;
  stageInnerElement.innerHTML = "";
  const sortedNodes = [...visibleNodes].sort(compareStageNodes);
  for (const node of sortedNodes) {
    stageInnerElement.append(buildStageNodeElement(currentState.document, node, currentState.selection.nodeId === node.id));
  }
  renderStageOverlay();
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
  applyDeclaredStageStyles(element, documentState, node);
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

function applyDeclaredStageStyles(element: HTMLElement, documentState: CanvasDocument, node: CanvasNode): void {
  for (const [key, value] of Object.entries(resolveStageStyle(documentState, node))) {
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
  const disabled = !node || Boolean(currentState?.pendingMutation);
  const inputs = [
    nameInput,
    textInput,
    nodeXInput,
    nodeYInput,
    nodeWidthInput,
    nodeHeightInput,
    paddingInput,
    gapInput,
    fontSizeInput,
    fontWeightInput,
    lineHeightInput,
    colorInput,
    backgroundInput,
    borderColorInput,
    borderWidthInput,
    borderRadiusInput,
    shadowInput,
    bindingKindInput,
    bindingComponentInput,
    bindingSelectorInput,
    a11yRoleInput,
    a11yLabelInput
  ];
  for (const input of inputs) {
    input.disabled = disabled;
  }
  duplicateNodeButton.disabled = disabled;
  deleteNodeButton.disabled = disabled;
  propertiesStatusElement.textContent = node
    ? `${node.kind} • ${node.rect.width}×${node.rect.height}`
    : "No node selected.";
  nameInput.value = node?.name ?? "";
  textInput.value = node ? nodeText(node) : "";
  nodeXInput.value = node ? String(node.rect.x) : "";
  nodeYInput.value = node ? String(node.rect.y) : "";
  nodeWidthInput.value = node ? String(node.rect.width) : "";
  nodeHeightInput.value = node ? String(node.rect.height) : "";
  paddingInput.value = node ? readStyleText(node.style.padding) : "";
  gapInput.value = node ? readStyleText(node.style.gap) : "";
  fontSizeInput.value = node ? readStyleText(node.style.fontSize) : "";
  fontWeightInput.value = node ? readStyleText(node.style.fontWeight) : "";
  lineHeightInput.value = node ? readStyleText(node.style.lineHeight) : "";
  colorInput.value = node ? readStyleText(node.style.color) : "";
  backgroundInput.value = node ? readStyleText(node.style.backgroundColor) : "";
  borderColorInput.value = node ? readStyleText(node.style.borderColor) : "";
  borderWidthInput.value = node ? readStyleText(node.style.borderWidth) : "";
  borderRadiusInput.value = node ? readStyleText(node.style.borderRadius) : "";
  shadowInput.value = node ? readStyleText(node.style.boxShadow) : "";
  const binding = currentState && node ? readSelectedBindingIdentity(currentState.document, node.id) : null;
  bindingKindInput.value = binding?.bindingKind ?? "";
  bindingComponentInput.value = binding?.componentName ?? "";
  bindingSelectorInput.value = node && currentState
    ? readBindingSelector(currentState.document, node.id)
    : "";
  const accessibility = node && isRecord(node.metadata.accessibility) ? node.metadata.accessibility : {};
  a11yRoleInput.value = typeof accessibility.role === "string" ? accessibility.role : "";
  a11yLabelInput.value = typeof accessibility.label === "string" ? accessibility.label : "";
  renderSelectionMeta();
  syncTokenEditorSelection();
}

function renderSelectionMeta(): void {
  selectionMetaElement.innerHTML = "";
  const node = getSelectedNode();
  const bindingIdentity = currentState ? readSelectedBindingIdentity(currentState.document, node?.id ?? null) : null;
  const latestImport = currentState ? readLatestImportProvenance(currentState.summary, currentState.document) : null;
  const items: Array<[string, string]> = [
    ["Selected", node?.id ?? "none"],
    ["Page", getActivePage()?.name ?? "n/a"],
    ["Position", node ? `${node.rect.x}, ${node.rect.y}` : "n/a"],
    ["Size", node ? `${node.rect.width} × ${node.rect.height}` : "n/a"],
    ["Binding", bindingIdentity?.componentName ?? "none"],
    ["Framework", bindingIdentity?.framework ?? "n/a"],
    ["Adapter", bindingIdentity?.adapter ?? "n/a"],
    ["Plugin", bindingIdentity?.plugin ?? "n/a"],
    ["Variants", node ? String(node.variantPatches.length) : "0"],
    ["Latest import", latestImport ?? "none"]
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
  annotationAddButton.textContent = annotationMode === "region" ? "Capture Region" : "Add Selected";
  annotationAddButton.disabled = annotationMode === "selected"
    ? (!node || !currentState || annotationDrafts.some((entry) => entry.kind !== "region" && entry.nodeId === node.id))
    : !currentState;
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
    const nodeLabel = annotation
      ? describeAnnotationItem(annotation)
      : draft.kind === "region"
        ? draft.label ?? draft.regionId
        : draft.nodeId;
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
    meta.textContent = annotation
      ? `${annotation.tag} • ${Math.round(annotation.rect.width)}×${Math.round(annotation.rect.height)}`
      : draft.kind === "region"
        ? `${Math.round(draft.rect.width)}×${Math.round(draft.rect.height)}`
        : draft.nodeId;
    summary.append(title, meta);

    const removeButton = document.createElement("button");
    removeButton.className = "canvas-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      removeAnnotationDraft(getDraftId(draft));
    });

    head.append(summary, removeButton);

    const noteField = document.createElement("textarea");
    noteField.className = "canvas-textarea";
    noteField.value = draft.note ?? "";
    noteField.placeholder = draft.kind === "region" ? "Add note for this captured region" : "Add note for this node";
    noteField.addEventListener("input", () => {
      updateAnnotationDraft(getDraftId(draft), { note: noteField.value });
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
  const page = getActivePage();
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
  if (!node || annotationDrafts.some((entry) => entry.kind !== "region" && entry.nodeId === node.id)) {
    renderAnnotationPanel();
    return;
  }
  annotationDrafts = [...annotationDrafts, { kind: "node", nodeId: node.id, note: "" }];
  renderAnnotationPanel();
}

function updateAnnotationDraft(draftId: string, patch: { note?: string }): void {
  annotationDrafts = annotationDrafts.map((entry) => getDraftId(entry) === draftId
    ? { ...entry, note: patch.note ?? entry.note }
    : entry);
}

function removeAnnotationDraft(draftId: string): void {
  annotationDrafts = annotationDrafts.filter((entry) => getDraftId(entry) !== draftId);
  renderAnnotationPanel();
}

function syncAnnotationDrafts(): void {
  if (!currentState) {
    annotationDrafts = [];
    renderAnnotationPanel();
    return;
  }
  const page = getActivePage();
  const validIds = new Set(page?.nodes.map((node) => node.id) ?? []);
  const next = annotationDrafts.filter((entry) => entry.kind === "region" || validIds.has(entry.nodeId));
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
  setCanvasButtonFeedback(button, formatAnnotationDispatchReceipt(response.receipt));
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
  activePageId = currentState.selection.pageId ?? activePageId;
  renderState();
  schedulePersist(currentState);
  port.postMessage({
    type: "canvas-page-patch-request",
    baseRevision: currentState.documentRevision,
    patches,
    selection: currentState.selection,
    viewport: currentState.viewport
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
        tokenRefs: isRecord(node.tokenRefs) ? { ...node.tokenRefs } : {},
        bindingRefs: isRecord(node.bindingRefs) ? { ...node.bindingRefs } : {},
        variantPatches: Array.isArray(node.variantPatches) ? node.variantPatches.filter(isRecord) : [],
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
        const removedIds = collectNodeSubtreeIds(page, patch.nodeId);
        if (removedIds.length === 0) {
          continue;
        }
        const removedSet = new Set(removedIds);
        page.nodes = page.nodes.filter((entry) => !removedSet.has(entry.id));
        for (const node of page.nodes) {
          node.childIds = node.childIds.filter((entry) => !removedSet.has(entry));
        }
        if (page.rootNodeId && removedSet.has(page.rootNodeId)) {
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
      continue;
    }
    if (patch.op === "node.visibility.set" && typeof patch.nodeId === "string" && typeof patch.hidden === "boolean") {
      const node = findNode(document, patch.nodeId);
      if (!node) {
        continue;
      }
      const visibility = isRecord(node.metadata.visibility) ? { ...node.metadata.visibility } : {};
      visibility.hidden = patch.hidden;
      node.metadata.visibility = visibility;
      continue;
    }
    if (patch.op === "node.reorder" && typeof patch.nodeId === "string" && typeof patch.index === "number") {
      const page = findPageForNode(document, patch.nodeId);
      const node = page?.nodes.find((entry) => entry.id === patch.nodeId);
      if (!page || !node) {
        continue;
      }
      const siblings = getSiblingIds(page, node.parentId ?? null);
      const currentIndex = siblings.indexOf(node.id);
      if (currentIndex === -1) {
        continue;
      }
      siblings.splice(currentIndex, 1);
      const nextIndex = clampIndex(patch.index, siblings.length);
      siblings.splice(nextIndex, 0, node.id);
      assignSiblingIds(page, node.parentId ?? null, siblings);
      continue;
    }
    if (patch.op === "node.reparent" && typeof patch.nodeId === "string" && typeof patch.index === "number") {
      const page = findPageForNode(document, patch.nodeId);
      const node = page?.nodes.find((entry) => entry.id === patch.nodeId);
      if (!page || !node) {
        continue;
      }
      const previousParentId = node.parentId ?? null;
      const currentSiblings = getSiblingIds(page, previousParentId).filter((entry) => entry !== node.id);
      assignSiblingIds(page, previousParentId, currentSiblings);
      node.parentId = typeof patch.parentId === "string" ? patch.parentId : null;
      const nextSiblings = getSiblingIds(page, node.parentId ?? null);
      const nextIndex = clampIndex(patch.index, nextSiblings.length);
      nextSiblings.splice(nextIndex, 0, node.id);
      assignSiblingIds(page, node.parentId ?? null, nextSiblings);
      continue;
    }
    if (patch.op === "node.duplicate" && typeof patch.nodeId === "string") {
      const page = findPageForNode(document, patch.nodeId);
      const sourceNode = page?.nodes.find((entry) => entry.id === patch.nodeId);
      if (!page || !sourceNode) {
        continue;
      }
      const idMap = isRecord(patch.idMap) ? patch.idMap : {};
      const sourceIds = collectNodeSubtreeIds(page, sourceNode.id);
      for (const sourceId of sourceIds) {
        if (typeof idMap[sourceId] !== "string") {
          idMap[sourceId] = `node_${crypto.randomUUID().slice(0, 8)}`;
        }
      }
      const clones: CanvasNode[] = [];
      for (const sourceId of sourceIds) {
        const original = page.nodes.find((entry) => entry.id === sourceId);
        if (!original) {
          continue;
        }
        const cloneNode: CanvasNode = structuredCloneNode(original);
        cloneNode.id = String(idMap[sourceId]);
        cloneNode.pageId = page.id;
        cloneNode.parentId = sourceId === sourceNode.id
          ? (typeof patch.parentId === "string" ? patch.parentId : sourceNode.parentId)
          : (original.parentId ? String(idMap[original.parentId] ?? original.parentId) : null);
        cloneNode.childIds = original.childIds.map((childId) => String(idMap[childId] ?? childId));
        cloneNode.rect = {
          ...cloneNode.rect,
          x: cloneNode.rect.x + 24,
          y: cloneNode.rect.y + 24
        };
        if (cloneNode.bindingRefs.primary && typeof cloneNode.bindingRefs.primary === "string") {
          cloneNode.bindingRefs.primary = `${cloneNode.bindingRefs.primary}_${cloneNode.id}`;
        }
        clones.push(cloneNode);
      }
      page.nodes.push(...clones);
      const duplicateRootId = String(idMap[sourceNode.id]);
      const parentId = typeof patch.parentId === "string" ? patch.parentId : sourceNode.parentId ?? null;
      const siblings = getSiblingIds(page, parentId);
      const nextIndex = clampIndex(typeof patch.index === "number" ? patch.index : siblings.length, siblings.length);
      siblings.splice(nextIndex, 0, duplicateRootId);
      assignSiblingIds(page, parentId, siblings);
      continue;
    }
    if (patch.op === "token.set" && typeof patch.path === "string") {
      setNestedValue(document.tokens.values, normalizeTokenPath(patch.path), patch.value);
      continue;
    }
    if (patch.op === "tokens.merge" && isRecord(patch.tokens)) {
      document.tokens = normalizeTokenStore({
        ...structuredClone(document.tokens),
        ...patch.tokens
      });
      continue;
    }
    if (patch.op === "tokens.replace" && isRecord(patch.tokens)) {
      document.tokens = normalizeTokenStore(patch.tokens);
      continue;
    }
  }
}

function getActivePage(): CanvasDocument["pages"][number] | null {
  if (!currentState) {
    return null;
  }
  const pageId = activePageId ?? currentState.selection.pageId ?? currentState.document.pages[0]?.id ?? null;
  return currentState.document.pages.find((entry) => entry.id === pageId) ?? currentState.document.pages[0] ?? null;
}

function setActivePage(
  pageId: string | null,
  options: { clearSelectionIfMissing?: boolean; broadcast?: boolean } = {}
): void {
  if (!currentState) {
    activePageId = pageId;
    return;
  }
  const page = currentState.document.pages.find((entry) => entry.id === pageId) ?? currentState.document.pages[0] ?? null;
  activePageId = page?.id ?? null;
  if (!page) {
    renderState();
    return;
  }
  const selectedNode = currentState.selection.nodeId ? findNode(currentState.document, currentState.selection.nodeId) : null;
  if (!selectedNode || selectedNode.pageId !== page.id || options.clearSelectionIfMissing) {
    currentState.selection = {
      pageId: page.id,
      nodeId: selectedNode?.pageId === page.id ? selectedNode.id : null,
      targetId: currentState.selection.targetId,
      updatedAt: new Date().toISOString()
    };
  } else {
    currentState.selection.pageId = page.id;
  }
  renderState();
  if (options.broadcast) {
    postViewState();
    schedulePersist(currentState);
  }
}

function selectNode(nodeId: string, pageId: string): void {
  if (!currentState) {
    return;
  }
  activePageId = pageId;
  currentState.selection = {
    pageId,
    nodeId,
    targetId: currentState.selection.targetId,
    updatedAt: new Date().toISOString()
  };
  renderState();
  postViewState();
  schedulePersist(currentState);
}

function requestHistory(direction: "undo" | "redo"): void {
  if (!currentState || currentState.pendingMutation) {
    return;
  }
  const history = currentState.summary.history;
  if ((direction === "undo" && !history?.canUndo) || (direction === "redo" && !history?.canRedo)) {
    return;
  }
  currentState.pendingMutation = true;
  renderState();
  port.postMessage({
    type: "canvas-page-history-request",
    direction
  } satisfies CanvasPagePortMessage);
}

function duplicateSelectedNode(): void {
  if (!currentState || currentState.pendingMutation) {
    return;
  }
  const node = getSelectedNode();
  const page = getActivePage();
  if (!node || !page) {
    return;
  }
  const siblingIds = getSiblingIds(page, node.parentId ?? null);
  const currentIndex = siblingIds.indexOf(node.id);
  const idMap = buildDuplicateIdMap(page, node.id);
  const duplicateRootId = idMap[node.id];
  if (!duplicateRootId) {
    return;
  }
  applyOptimisticPatch([{
    op: "node.duplicate",
    nodeId: node.id,
    parentId: node.parentId ?? null,
    index: currentIndex >= 0 ? currentIndex + 1 : siblingIds.length,
    idMap
  }], {
    pageId: page.id,
    nodeId: duplicateRootId,
    targetId: currentState.selection.targetId
  });
}

function nudgeSelectedNode(key: string, delta: number): void {
  const node = getSelectedNode();
  if (!node || !currentState || currentState.pendingMutation) {
    return;
  }
  const changes: Record<string, unknown> = {};
  if (key === "ArrowUp") {
    changes["rect.y"] = node.rect.y - delta;
  } else if (key === "ArrowDown") {
    changes["rect.y"] = node.rect.y + delta;
  } else if (key === "ArrowLeft") {
    changes["rect.x"] = node.rect.x - delta;
  } else if (key === "ArrowRight") {
    changes["rect.x"] = node.rect.x + delta;
  }
  if (Object.keys(changes).length > 0) {
    applyOptimisticPatch([{ op: "node.update", nodeId: node.id, changes }], currentState.selection);
  }
}

function fitActivePageViewport(): void {
  if (!currentState) {
    return;
  }
  currentState.viewport = resolvePreferredViewport(currentState);
  renderState();
  postViewState();
  schedulePersist(currentState);
}

function resetZoomToDefault(): void {
  if (!currentState) {
    return;
  }
  currentState.viewport = {
    ...currentState.viewport,
    zoom: DEFAULT_EDITOR_VIEWPORT.zoom
  };
  renderState();
  postViewState();
  schedulePersist(currentState);
}

function commitSelectedNodeChanges(changes: Record<string, unknown>): void {
  const node = getSelectedNode();
  if (!node || !currentState || currentState.pendingMutation) {
    return;
  }
  applyOptimisticPatch([{ op: "node.update", nodeId: node.id, changes }], currentState.selection);
}

function commitSelectedBindingPatch(): void {
  const node = getSelectedNode();
  if (!node || !currentState || currentState.pendingMutation) {
    return;
  }
  const page = getActivePage();
  if (!page) {
    return;
  }
  const bindingIdentity = readSelectedBindingIdentity(currentState.document, node.id);
  const bindingId = bindingIdentity.bindingId ?? `binding_${crypto.randomUUID().slice(0, 8)}`;
  applyOptimisticPatch([{
    op: "binding.set",
    nodeId: node.id,
    binding: {
      id: bindingId,
      kind: readTextInput(bindingKindInput) || bindingIdentity.bindingKind || "component",
      selector: readTextInput(bindingSelectorInput) || undefined,
      componentName: readTextInput(bindingComponentInput) || undefined,
      metadata: {
        ...(readExistingBindingMetadata(currentState.document, bindingId) ?? {}),
        sourceKind: bindingIdentity.sourceKind ?? undefined
      }
    }
  }], {
    pageId: page.id,
    nodeId: node.id,
    targetId: currentState.selection.targetId
  });
}

function commitLayerMove(nodeId: string, parentId: string | null, index: number): void {
  if (!currentState || currentState.pendingMutation) {
    return;
  }
  const page = getActivePage();
  const node = findNode(currentState.document, nodeId);
  if (!page || !node || parentId === node.id) {
    return;
  }
  const patch = node.parentId === parentId
    ? { op: "node.reorder" as const, nodeId, index }
    : { op: "node.reparent" as const, nodeId, parentId, index };
  applyOptimisticPatch([patch], {
    pageId: page.id,
    nodeId,
    targetId: currentState.selection.targetId
  });
}

function commitAnnotationCapture(marquee: NonNullable<typeof marqueeState>): void {
  const page = getActivePage();
  if (!currentState || !page) {
    return;
  }
  const dx = Math.abs(marquee.currentClientX - marquee.originClientX);
  const dy = Math.abs(marquee.currentClientY - marquee.originClientY);
  if (dx < 6 && dy < 6) {
    if (marquee.targetNodeId && !annotationDrafts.some((entry) => entry.kind !== "region" && entry.nodeId === marquee.targetNodeId)) {
      annotationDrafts = [...annotationDrafts, { kind: "node", nodeId: marquee.targetNodeId, note: "" }];
      renderAnnotationPanel();
    }
    return;
  }
  const rect = marqueeClientRectToCanvasRect(marquee);
  const intersectingNodes = page.nodes.filter((node) => rectsIntersect(node.rect, rect));
  const regionId = `region_${crypto.randomUUID().slice(0, 8)}`;
  annotationDrafts = [
    ...annotationDrafts,
    {
      kind: "region",
      regionId,
      rect,
      pageId: page.id,
      label: intersectingNodes.length > 0 ? `Region • ${intersectingNodes.length} nodes` : "Region",
      note: ""
    }
  ];
  renderAnnotationPanel();
}

function renderStageOverlay(): void {
  stageOverlayElement.innerHTML = "";
  if (!marqueeState) {
    return;
  }
  const marquee = document.createElement("div");
  marquee.className = "canvas-stage-marquee";
  const bounds = marqueeClientRectToStageRect(marqueeState);
  marquee.style.left = `${bounds.left}px`;
  marquee.style.top = `${bounds.top}px`;
  marquee.style.width = `${bounds.width}px`;
  marquee.style.height = `${bounds.height}px`;
  stageOverlayElement.append(marquee);
}

function bindFieldCommit(
  input: HTMLInputElement | HTMLTextAreaElement,
  callback: () => void
): void {
  input.addEventListener("change", callback);
  input.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" && !(input instanceof HTMLTextAreaElement && !keyboardEvent.metaKey && !keyboardEvent.ctrlKey)) {
      keyboardEvent.preventDefault();
      callback();
    }
  });
}

function readTextInput(input: HTMLInputElement | HTMLTextAreaElement): string {
  return input.value.trim();
}

function readNumberInput(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function readStyleText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function readExistingBindingMetadata(document: CanvasDocument, bindingId: string): Record<string, unknown> | null {
  const binding = document.bindings.find((entry) => entry.id === bindingId);
  return binding ? { ...binding.metadata } : null;
}

function readBindingSelector(document: CanvasDocument, nodeId: string): string {
  const bindingIdentity = readSelectedBindingIdentity(document, nodeId);
  const binding = bindingIdentity.bindingId
    ? document.bindings.find((entry) => entry.id === bindingIdentity.bindingId) ?? null
    : null;
  if (binding && typeof binding.selector === "string") {
    return binding.selector;
  }
  return binding && typeof binding.metadata.selector === "string"
    ? binding.metadata.selector
    : "";
}

function getRootNodes(page: CanvasDocument["pages"][number]): CanvasNode[] {
  if (page.rootNodeId) {
    const root = page.nodes.find((entry) => entry.id === page.rootNodeId);
    if (root) {
      return [root, ...page.nodes.filter((entry) => entry.parentId === null && entry.id !== root.id)];
    }
  }
  return page.nodes.filter((entry) => entry.parentId === null);
}

function ensureExpandedNodePath(page: CanvasDocument["pages"][number], nodeId: string | null): void {
  if (!page.rootNodeId) {
    return;
  }
  expandedLayerNodeIds.add(page.rootNodeId);
  let cursor = nodeId ? page.nodes.find((entry) => entry.id === nodeId) ?? null : null;
  while (cursor?.parentId) {
    expandedLayerNodeIds.add(cursor.parentId);
    cursor = page.nodes.find((entry) => entry.id === cursor?.parentId) ?? null;
  }
}

function getSiblingIds(page: CanvasDocument["pages"][number], parentId: string | null): string[] {
  if (parentId) {
    return [...(page.nodes.find((entry) => entry.id === parentId)?.childIds ?? [])];
  }
  return page.nodes.filter((entry) => entry.parentId === null).map((entry) => entry.id);
}

function assignSiblingIds(page: CanvasDocument["pages"][number], parentId: string | null, ids: string[]): void {
  if (parentId) {
    const parent = page.nodes.find((entry) => entry.id === parentId);
    if (parent) {
      parent.childIds = ids;
    }
    return;
  }
  for (const node of page.nodes) {
    if (ids.includes(node.id)) {
      node.parentId = null;
    }
  }
  page.rootNodeId = ids[0] ?? null;
}

function findSiblingInsertIndex(page: CanvasDocument["pages"][number], nodeId: string): number {
  const node = page.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return 0;
  }
  const siblings = getSiblingIds(page, node.parentId ?? null);
  const currentIndex = siblings.indexOf(node.id);
  return currentIndex >= 0 ? currentIndex : siblings.length;
}

function clampIndex(index: number, maxLength: number): number {
  return Math.max(0, Math.min(index, maxLength));
}

function findPageForNode(document: CanvasDocument, nodeId: string): CanvasDocument["pages"][number] | null {
  for (const page of document.pages) {
    if (page.nodes.some((entry) => entry.id === nodeId)) {
      return page;
    }
  }
  return null;
}

function collectNodeSubtreeIds(page: CanvasDocument["pages"][number], nodeId: string): string[] {
  const collected: string[] = [];
  const visit = (id: string) => {
    const node = page.nodes.find((entry) => entry.id === id);
    if (!node) {
      return;
    }
    collected.push(node.id);
    for (const childId of node.childIds) {
      visit(childId);
    }
  };
  visit(nodeId);
  return collected;
}

function buildDuplicateIdMap(page: CanvasDocument["pages"][number], nodeId: string): Record<string, string> {
  return Object.fromEntries(
    collectNodeSubtreeIds(page, nodeId).map((id) => [id, `node_${crypto.randomUUID().slice(0, 8)}`])
  );
}

function structuredCloneNode(node: CanvasNode): CanvasNode {
  return {
    ...node,
    rect: { ...node.rect },
    props: { ...node.props },
    style: { ...node.style },
    tokenRefs: { ...node.tokenRefs },
    bindingRefs: { ...node.bindingRefs },
    variantPatches: node.variantPatches.map((entry) => ({ ...entry })),
    metadata: { ...node.metadata }
  };
}

function marqueeClientRectToStageRect(marquee: NonNullable<typeof marqueeState>): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const stageRect = stageElement.getBoundingClientRect();
  const left = Math.min(marquee.originClientX, marquee.currentClientX) - stageRect.left;
  const top = Math.min(marquee.originClientY, marquee.currentClientY) - stageRect.top;
  const width = Math.abs(marquee.currentClientX - marquee.originClientX);
  const height = Math.abs(marquee.currentClientY - marquee.originClientY);
  return { left, top, width, height };
}

function marqueeClientRectToCanvasRect(marquee: NonNullable<typeof marqueeState>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const stageRect = marqueeClientRectToStageRect(marquee);
  const viewport = currentState?.viewport ?? DEFAULT_EDITOR_VIEWPORT;
  return {
    x: Math.round((stageRect.left - viewport.x) / viewport.zoom),
    y: Math.round((stageRect.top - viewport.y) / viewport.zoom),
    width: Math.round(stageRect.width / viewport.zoom),
    height: Math.round(stageRect.height / viewport.zoom)
  };
}

function rectsIntersect(left: CanvasNode["rect"], right: { x: number; y: number; width: number; height: number }): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function isNodeHidden(node: CanvasNode): boolean {
  return isRecord(node.metadata.visibility) && node.metadata.visibility.hidden === true;
}

function readTokenPath(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return normalizeTokenPath(value);
  }
  if (isRecord(value)) {
    if (typeof value.path === "string" && value.path.trim().length > 0) {
      return normalizeTokenPath(value.path);
    }
    if (typeof value.tokenPath === "string" && value.tokenPath.trim().length > 0) {
      return normalizeTokenPath(value.tokenPath);
    }
  }
  return null;
}

function normalizeTokenPath(path: string): string {
  return path.trim().replace(/^tokens\./, "");
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replaceAll("\"", "&quot;");
}

function readActiveTokenModeId(tokens: CanvasDocument["tokens"]): string | null {
  return typeof tokens.metadata.activeModeId === "string" && tokens.metadata.activeModeId.trim().length > 0
    ? tokens.metadata.activeModeId
    : null;
}

function readNestedTokenValue(values: Record<string, unknown>, tokenPath: string): unknown {
  const segments = normalizeTokenPath(tokenPath).split(".").filter(Boolean);
  let current: unknown = values;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return null;
    }
    current = current[segment];
  }
  return current;
}

function findTokenCollectionId(tokens: CanvasDocument["tokens"], tokenPath: string): string | null {
  const normalized = normalizeTokenPath(tokenPath);
  for (const collection of tokens.collections) {
    if (collection.items.some((item) => item.path === normalized)) {
      return collection.id;
    }
  }
  return null;
}

function findTokenItem(
  tokens: CanvasDocument["tokens"],
  tokenPath: string
): { collection: CanvasDocument["tokens"]["collections"][number]; item: CanvasDocument["tokens"]["collections"][number]["items"][number] } | null {
  const normalized = normalizeTokenPath(tokenPath);
  for (const collection of tokens.collections) {
    const item = collection.items.find((entry) => entry.path === normalized);
    if (item) {
      return { collection, item };
    }
  }
  return null;
}

function readTokenAliasTarget(
  tokens: CanvasDocument["tokens"],
  tokenPath: string,
  modeId: string | null
): string | null {
  const normalized = normalizeTokenPath(tokenPath);
  const exact = tokens.aliases.find((entry) => entry.path === normalized && (entry.modeId ?? null) === modeId);
  if (exact) {
    return exact.targetPath;
  }
  const shared = tokens.aliases.find((entry) => entry.path === normalized && (entry.modeId ?? null) === null);
  return shared?.targetPath ?? null;
}

function resolveTokenValue(
  tokens: CanvasDocument["tokens"],
  tokenPath: string,
  modeId: string | null,
  seen: Set<string> = new Set()
): unknown {
  const normalized = normalizeTokenPath(tokenPath);
  const visitKey = `${normalized}:${modeId ?? ""}`;
  if (seen.has(visitKey)) {
    return null;
  }
  seen.add(visitKey);
  const aliasTarget = readTokenAliasTarget(tokens, normalized, modeId);
  if (aliasTarget) {
    const aliasedValue = resolveTokenValue(tokens, aliasTarget, modeId, seen);
    if (aliasedValue !== null && aliasedValue !== undefined) {
      return aliasedValue;
    }
  }
  const location = findTokenItem(tokens, normalized);
  if (location) {
    if (modeId) {
      const mode = location.item.modes.find((entry) => entry.id === modeId);
      if (mode) {
        return mode.value;
      }
    }
    if (location.item.value !== undefined) {
      return location.item.value;
    }
  }
  return readNestedTokenValue(tokens.values, normalized);
}

function formatTokenEditorValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "";
}

function parseTokenEditorValue(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return value;
}

function collectLeafTokenPaths(value: unknown, prefix: string, target: Set<string>): void {
  if (!isRecord(value)) {
    if (prefix.length > 0) {
      target.add(prefix);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (isRecord(entry)) {
      collectLeafTokenPaths(entry, nextPath, target);
      continue;
    }
    if (!Array.isArray(entry)) {
      target.add(nextPath);
    }
  }
}

function listTokenModes(tokens: CanvasDocument["tokens"], collectionId: string): Array<{ id: string; name: string }> {
  const modeMap = new Map<string, string>([["__base__", "Base value"]]);
  if (collectionId !== "__values__") {
    const collection = tokens.collections.find((entry) => entry.id === collectionId);
    for (const item of collection?.items ?? []) {
      for (const mode of item.modes) {
        modeMap.set(mode.id, mode.name);
      }
    }
  }
  const activeModeId = readActiveTokenModeId(tokens);
  if (activeModeId && !modeMap.has(activeModeId)) {
    modeMap.set(activeModeId, activeModeId);
  }
  return [...modeMap.entries()].map(([id, name]) => ({ id, name }));
}

function collectTokenUsages(
  document: CanvasDocument,
  tokenPath: string
): Array<{ pageName: string; nodeId: string; nodeName: string; property: string; resolvedValue: unknown }> {
  const normalized = normalizeTokenPath(tokenPath);
  const modeId = readActiveTokenModeId(document.tokens);
  return document.pages.flatMap((page) => page.nodes.flatMap((node) => {
    const entries = Object.entries(node.tokenRefs)
      .flatMap(([property, value]) => {
        const refPath = readTokenPath(value);
        return refPath === normalized ? [{
          pageName: page.name,
          nodeId: node.id,
          nodeName: node.name,
          property,
          resolvedValue: resolveTokenValue(document.tokens, normalized, modeId)
        }] : [];
      });
    return entries;
  }));
}

function cloneTokenStore(tokens: CanvasDocument["tokens"]): CanvasDocument["tokens"] {
  return structuredClone(tokens);
}

function hasSelectedTokenBinding(node: CanvasNode, property: string): boolean {
  return typeof readTokenPath(node.tokenRefs[property]) === "string";
}

function syncTokenEditorSelection(): void {
  if (!currentState) {
    selectedTokenPath = "";
    selectedTokenCollectionId = "__values__";
    selectedTokenModeId = "__base__";
    return;
  }
  const node = getSelectedNode();
  const selectedEntry = node
    ? Object.entries(node.tokenRefs)
      .map(([property, value]) => ({ property, path: readTokenPath(value) }))
      .find((entry): entry is { property: string; path: string } => typeof entry.path === "string")
    : null;
  const knownPaths = new Set<string>();
  collectLeafTokenPaths(currentState.document.tokens.values, "", knownPaths);
  for (const collection of currentState.document.tokens.collections) {
    for (const item of collection.items) {
      knownPaths.add(item.path);
    }
  }
  if (selectedEntry && selectedTokenPath.length === 0) {
    selectedTokenPath = selectedEntry.path;
    tokenBindingPropertySelect.value = selectedEntry.property;
  } else if (selectedTokenPath.length === 0 || !knownPaths.has(selectedTokenPath)) {
    selectedTokenPath = [...knownPaths][0] ?? "";
  }
  const collectionStillExists = selectedTokenCollectionId === "__values__"
    || currentState.document.tokens.collections.some((entry) => entry.id === selectedTokenCollectionId);
  if (!collectionStillExists) {
    selectedTokenCollectionId = selectedTokenPath
      ? findTokenCollectionId(currentState.document.tokens, selectedTokenPath) ?? "__values__"
      : "__values__";
  }
  const activeModeId = readActiveTokenModeId(currentState.document.tokens);
  selectedTokenModeId = activeModeId ?? "__base__";
}

function updateActiveTokenMode(): void {
  if (!currentState || currentState.pendingMutation) {
    return;
  }
  const nextTokens = cloneTokenStore(currentState.document.tokens);
  if (selectedTokenModeId === "__base__") {
    delete nextTokens.metadata.activeModeId;
  } else {
    nextTokens.metadata.activeModeId = selectedTokenModeId;
  }
  applyOptimisticPatch([{ op: "tokens.replace", tokens: nextTokens }], currentState.selection);
}

function createTokenCollection(): void {
  if (!currentState || currentState.pendingMutation) {
    return;
  }
  const rawName = tokenCollectionNameInput.value.trim();
  if (rawName.length === 0) {
    tokenStatusElement.textContent = "Enter a collection name first.";
    return;
  }
  const collectionId = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `collection-${crypto.randomUUID().slice(0, 6)}`;
  const nextTokens = cloneTokenStore(currentState.document.tokens);
  if (!nextTokens.collections.some((entry) => entry.id === collectionId)) {
    nextTokens.collections.push({
      id: collectionId,
      name: rawName,
      items: [],
      metadata: {}
    });
  }
  selectedTokenCollectionId = collectionId;
  tokenCollectionNameInput.value = "";
  applyOptimisticPatch([{ op: "tokens.replace", tokens: nextTokens }], currentState.selection);
}

function createTokenMode(): void {
  if (!currentState || currentState.pendingMutation) {
    return;
  }
  const rawName = tokenModeNameInput.value.trim();
  const tokenPath = normalizeTokenPath(tokenPathInput.value);
  if (rawName.length === 0 || tokenPath.length === 0) {
    tokenStatusElement.textContent = "Choose a token path and enter a mode name first.";
    return;
  }
  const nextTokens = cloneTokenStore(currentState.document.tokens);
  const collectionId = selectedTokenCollectionId === "__values__"
    ? (findTokenCollectionId(nextTokens, tokenPath) ?? "__values__")
    : selectedTokenCollectionId;
  if (collectionId === "__values__") {
    tokenStatusElement.textContent = "Create or select a token collection before adding modes.";
    return;
  }
  const collection = nextTokens.collections.find((entry) => entry.id === collectionId);
  if (!collection) {
    return;
  }
  let item = collection.items.find((entry) => entry.path === tokenPath);
  if (!item) {
    item = {
      id: tokenPath.replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
      path: tokenPath,
      value: parseTokenEditorValue(tokenValueInput.value || formatTokenEditorValue(resolveTokenValue(nextTokens, tokenPath, null))),
      modes: [],
      metadata: {}
    };
    collection.items.push(item);
  }
  const modeId = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `mode-${crypto.randomUUID().slice(0, 6)}`;
  if (!item.modes.some((entry) => entry.id === modeId)) {
    item.modes.push({
      id: modeId,
      name: rawName,
      value: parseTokenEditorValue(tokenValueInput.value || formatTokenEditorValue(item.value)),
      metadata: {}
    });
  }
  nextTokens.metadata.activeModeId = modeId;
  selectedTokenModeId = modeId;
  tokenModeNameInput.value = "";
  applyOptimisticPatch([{ op: "tokens.replace", tokens: nextTokens }], currentState.selection);
}

function saveTokenEditor(): void {
  if (!currentState || currentState.pendingMutation) {
    return;
  }
  const tokenPath = normalizeTokenPath(tokenPathInput.value);
  if (tokenPath.length === 0) {
    tokenStatusElement.textContent = "Enter a token path first.";
    return;
  }
  const nextTokens = cloneTokenStore(currentState.document.tokens);
  const nextValue = parseTokenEditorValue(tokenValueInput.value);
  if (selectedTokenCollectionId === "__values__") {
    setNestedValue(nextTokens.values, tokenPath, nextValue);
  } else {
    const collection = nextTokens.collections.find((entry) => entry.id === selectedTokenCollectionId);
    if (!collection) {
      tokenStatusElement.textContent = "Choose a valid token collection.";
      return;
    }
    let item = collection.items.find((entry) => entry.path === tokenPath);
    if (!item) {
      item = {
        id: tokenPath.replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
        path: tokenPath,
        value: nextValue,
        modes: [],
        metadata: {}
      };
      collection.items.push(item);
    }
    if (selectedTokenModeId === "__base__") {
      item.value = nextValue;
    } else {
      const modeName = tokenModeSelect.selectedOptions[0]?.textContent?.trim() || selectedTokenModeId;
      const existingMode = item.modes.find((entry) => entry.id === selectedTokenModeId);
      if (existingMode) {
        existingMode.value = nextValue;
      } else {
        item.modes.push({
          id: selectedTokenModeId,
          name: modeName,
          value: nextValue,
          metadata: {}
        });
      }
      nextTokens.metadata.activeModeId = selectedTokenModeId;
    }
  }
  const aliasTarget = normalizeTokenPath(tokenAliasInput.value);
  nextTokens.aliases = nextTokens.aliases.filter((entry) =>
    !(entry.path === tokenPath && (entry.modeId ?? null) === (selectedTokenModeId === "__base__" ? null : selectedTokenModeId))
  );
  if (aliasTarget.length > 0) {
    nextTokens.aliases.push({
      path: tokenPath,
      targetPath: aliasTarget,
      modeId: selectedTokenModeId === "__base__" ? null : selectedTokenModeId,
      metadata: {}
    });
  }
  selectedTokenPath = tokenPath;
  applyOptimisticPatch([{ op: "tokens.replace", tokens: nextTokens }], currentState.selection);
}

function bindSelectedNodeToToken(): void {
  const node = getSelectedNode();
  if (!node || !currentState || currentState.pendingMutation) {
    return;
  }
  const tokenPath = normalizeTokenPath(tokenPathInput.value);
  const property = tokenBindingPropertySelect.value || "backgroundColor";
  if (tokenPath.length === 0) {
    tokenStatusElement.textContent = "Choose a token path first.";
    return;
  }
  const nextTokenRefs = { ...node.tokenRefs, [property]: tokenPath };
  const nextStyle = { ...node.style };
  const resolvedValue = resolveTokenValue(currentState.document.tokens, tokenPath, readActiveTokenModeId(currentState.document.tokens));
  if (typeof resolvedValue === "string" || typeof resolvedValue === "number") {
    nextStyle[property] = resolvedValue;
  }
  const nextTokens = cloneTokenStore(currentState.document.tokens);
  const bindingIdentity = readSelectedBindingIdentity(currentState.document, node.id);
  nextTokens.bindings = nextTokens.bindings.filter((entry) => !(entry.nodeId === node.id && entry.property === property));
  nextTokens.bindings.push({
    path: tokenPath,
    nodeId: node.id,
    bindingId: bindingIdentity.bindingId ?? null,
    property,
    metadata: {}
  });
  selectedTokenPath = tokenPath;
  applyOptimisticPatch([
    {
      op: "node.update",
      nodeId: node.id,
      changes: {
        tokenRefs: nextTokenRefs,
        style: nextStyle
      }
    },
    {
      op: "tokens.replace",
      tokens: nextTokens
    }
  ], currentState.selection);
}

function clearSelectedTokenBinding(): void {
  const node = getSelectedNode();
  if (!node || !currentState || currentState.pendingMutation) {
    return;
  }
  const property = tokenBindingPropertySelect.value || "backgroundColor";
  if (!hasSelectedTokenBinding(node, property)) {
    return;
  }
  const nextTokenRefs = { ...node.tokenRefs };
  delete nextTokenRefs[property];
  const nextTokens = cloneTokenStore(currentState.document.tokens);
  nextTokens.bindings = nextTokens.bindings.filter((entry) => !(entry.nodeId === node.id && entry.property === property));
  applyOptimisticPatch([
    {
      op: "node.update",
      nodeId: node.id,
      changes: {
        tokenRefs: nextTokenRefs
      }
    },
    {
      op: "tokens.replace",
      tokens: nextTokens
    }
  ], currentState.selection);
}

function resolveStageStyle(documentState: CanvasDocument, node: CanvasNode): Record<string, unknown> {
  const style = { ...node.style };
  const modeId = readActiveTokenModeId(documentState.tokens);
  for (const [property, value] of Object.entries(node.tokenRefs)) {
    const tokenPath = readTokenPath(value);
    if (!tokenPath) {
      continue;
    }
    const resolvedValue = resolveTokenValue(documentState.tokens, tokenPath, modeId);
    if (typeof resolvedValue === "string" || typeof resolvedValue === "number") {
      style[property] = resolvedValue;
    }
  }
  return style;
}

function getDraftId(draft: CanvasAnnotationDraft): string {
  return draft.kind === "region" ? draft.regionId : draft.nodeId;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
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
      ? value.componentInventory.flatMap((entry, index) => normalizeComponentInventoryItem(entry, index))
      : [],
    tokens: normalizeTokenStore(value.tokens),
    meta: normalizeDocumentMeta(value.meta)
  };
}

function normalizeComponentInventoryItem(value: unknown, index: number): CanvasDocument["componentInventory"] {
  if (!isRecord(value)) {
    return [];
  }
  const id = typeof value.id === "string" ? value.id : `inventory_${index + 1}`;
  const name = typeof value.name === "string"
    ? value.name
    : typeof value.componentName === "string"
      ? value.componentName
      : id;
  return [{
    id,
    name,
    componentName: typeof value.componentName === "string" ? value.componentName : undefined,
    sourceKind: typeof value.sourceKind === "string" ? value.sourceKind : undefined,
    sourceFamily: typeof value.sourceFamily === "string" ? value.sourceFamily : undefined,
    origin: typeof value.origin === "string" ? value.origin : undefined,
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
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  return {
    id: value.id,
    label: typeof value.label === "string" ? value.label : typeof value.name === "string" ? value.name : undefined,
    packageName: typeof value.packageName === "string" ? value.packageName : undefined,
    version: typeof value.version === "string" ? value.version : undefined,
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
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
    return [];
  }
  return [{
    pluginId: typeof value.pluginId === "string" ? value.pluginId : undefined,
    code: value.code,
    message: value.message,
    details: isRecord(value.details) ? value.details : {}
  }];
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
    tokenRefs: isRecord(value.tokenRefs) ? value.tokenRefs : {},
    bindingRefs: isRecord(value.bindingRefs) ? value.bindingRefs : {},
    variantPatches: Array.isArray(value.variantPatches) ? value.variantPatches.filter(isRecord) : [],
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
    selector: typeof value.selector === "string" ? value.selector : undefined,
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
  const page = getActivePage();
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
  const page = (activePageId ? state.document.pages.find((entry) => entry.id === activePageId) : null)
    ?? state.document.pages.find((entry) => entry.id === state.selection.pageId)
    ?? state.document.pages[0];
  const visibleNodes = page?.nodes.filter((node) => !isNodeHidden(node)) ?? [];
  if (!page || visibleNodes.length === 0) {
    return { ...DEFAULT_EDITOR_VIEWPORT };
  }
  return computeFittedViewport(visibleNodes, stageElement.clientWidth, stageElement.clientHeight);
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
