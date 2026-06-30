// This file is injected with chrome.scripting.executeScript, so keep runtime helpers local.

const logError = (context: string, error: unknown, options?: { code?: string; extra?: Record<string, unknown> }) => {
  const detail =
    error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : typeof error === "string"
        ? { message: error }
        : (() => {
          try {
            return { message: JSON.stringify(error) };
          } catch {
            return { message: "Unknown error" };
          }
        })();
  const payload = {
    context,
    code: options?.code ?? "unknown",
    ...detail,
    ...(options?.extra ?? {})
  };
  console.error("[opendevbrowser]", payload);
};

type AnnotationScreenshotMode = "visible" | "full" | "none";

type AnnotationOptions = {
  screenshotMode: AnnotationScreenshotMode;
  includeScreenshots: boolean;
  debug: boolean;
  context?: string;
};

type AnnotationErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "timeout"
  | "direct_unavailable"
  | "direct_failed"
  | "relay_unavailable"
  | "restricted_url"
  | "injection_failed"
  | "capture_failed"
  | "payload_unavailable"
  | "cancelled"
  | "unknown";
type AnnotationDispatchSource = "annotate_item" | "annotate_all" | "popup_item" | "popup_all" | "canvas_item" | "canvas_all";
type AnnotationRect = { x: number; y: number; width: number; height: number };
type AnnotationSelectorFamily = "backendNodeId" | "frameId" | "testId" | "aria" | "css" | "shadowChain" | "xpath" | "text";
type AnnotationSelectorCandidate = {
  family: AnnotationSelectorFamily;
  rank: number;
  confidence: "high" | "medium" | "low";
  scope: "same-session" | "frame" | "document" | "shadow" | "text";
  transport: "extension";
  availability: "available" | "unavailable";
  value?: string;
  unavailableReason?: string;
  recoveryHint?: string;
};
type AnnotationSelectorBundle = {
  primary: string;
  transport: "extension";
  candidates: AnnotationSelectorCandidate[];
  recoveryHints: string[];
};
type AnnotationTargetIdentity = {
  source: "explicitData" | "customElement" | "accessibility" | "selector";
  priority: number;
  stableId: string;
  label?: string;
  customElement?: { tag: string };
};
type AnnotationStyle = {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;
  display?: string;
  position?: string;
};
type AnnotationPayload = {
  schemaVersion?: 2;
  url: string;
  title?: string;
  timestamp: string;
  context?: string;
  screenshotMode: AnnotationScreenshotMode;
  screenshots?: Array<{ id: string; label: string; base64: string; mime: "image/png"; width?: number; height?: number }>;
  annotations: Array<{
    id: string;
    selector: string;
    tag: string;
    idAttr?: string;
    classes?: string[];
    text?: string;
    rect: AnnotationRect;
    attributes?: Record<string, string>;
    a11y?: Record<string, unknown>;
    styles?: AnnotationStyle;
    note?: string;
    screenshotId?: string;
    debug?: Record<string, unknown>;
    identity?: AnnotationTargetIdentity;
    selectorBundle?: AnnotationSelectorBundle;
  }>;
  compact?: AnnotationCompactPayload;
};

type AnnotationCompactPayload = {
  schemaVersion: 2;
  url: string;
  title?: string;
  timestamp: string;
  context?: string;
  screenshotMode: "none";
  byteBudget: number;
  redaction: AnnotationCompactRedaction;
  items: AnnotationCompactItem[];
};

type AnnotationCompactItem = {
  id: string;
  label: string;
  note?: string;
  target: {
    tag: string;
    selector: string;
    rect: AnnotationRect;
    text?: string;
    a11y?: Record<string, unknown>;
  };
  identity: AnnotationTargetIdentity;
  selectorBundle: AnnotationSelectorBundle;
  redaction: AnnotationCompactRedaction;
};

type AnnotationCompactRedaction = {
  removedFields: string[];
  truncatedFields: string[];
  screenshotBytesRemoved: boolean;
  originalByteLength: number;
  compactByteLength: number;
};

type AnnotationSendReceipt = {
  receiptId: string;
  deliveryState: "queued" | "delivered" | "stored_only" | "consumed";
  storedFallback: boolean;
  reason?: string;
  chatScopeKey?: string | null;
  createdAt: string;
  itemCount: number;
  byteLength: number;
  source: AnnotationDispatchSource;
  label: string;
};

type PopupAnnotationSendPayloadResponse = {
  type: "annotation:sendPayloadResult";
  ok: boolean;
  meta: unknown | null;
  receipt: AnnotationSendReceipt | null;
  error?: { code: AnnotationErrorCode; message: string };
};

type PopupAnnotationSanitizePayloadResponse = {
  type: "annotation:sanitizePayloadResult";
  ok: boolean;
  payload: AnnotationPayload | null;
  error?: { code: AnnotationErrorCode; message: string };
};

type AnnotationSession = {
  requestId: string | null;
  options: AnnotationOptions;
  active: boolean;
  completed: boolean;
};

type SelectedItem = {
  id: string;
  element: Element;
  note: string;
  noteEl: HTMLDivElement;
  noteInput: HTMLTextAreaElement;
  position: { x: number; y: number };
  screenshotId?: string;
};

type ContentMessage =
  | { type: "annotation:start"; requestId: string; options?: Partial<AnnotationOptions> }
  | { type: "annotation:cancel"; requestId: string }
  | { type: "annotation:toggle" }
  | { type: "annotation:ping" };

type AnnotationBridge = {
  active: boolean;
  toggle: () => void;
  start: (requestId: string | null, options?: Partial<AnnotationOptions>) => void;
  cancel: (requestId?: string) => void;
};

type AnnotationMessageListener = (
  message: ContentMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean;

type AnnotationWindow = Window & {
  __odbAnnotate?: AnnotationBridge;
  __odbAnnotateMessageListener?: AnnotationMessageListener;
};

const ROOT_ID = "odb-annotate-root";
const ATTR_UI = "data-odb-annotate";
const ANNOTATION_SCHEMA_VERSION = 2;
const COMPACT_BYTE_BUDGET = 24 * 1024;
const COMPACT_TEXT_LIMIT = 240;
const COMPACT_NOTE_LIMIT = 600;
const NOTE_PLACEMENT_MARGIN = 8;
const NOTE_PLACEMENT_GAP = 12;
const MOBILE_NOTE_PLACEMENT_MAX_WIDTH = 480;
  const COLLISION_PENALTY = 10_000;
  const CLAMP_PENALTY = 500;
  const SIDE_ORDER_PENALTY = 1_000;
  const NOTE_PLACEMENT_GRID_STEP = 72;
  const EXISTING_SIDE_BLOCK_RATIO = 0.25;
const DEFAULT_OPTIONS: AnnotationOptions = {
  screenshotMode: "visible",
  includeScreenshots: false,
  debug: true
};
const BOOT_ID = crypto.randomUUID();

const annotationWindow = window as AnnotationWindow;

const state: {
  session: AnnotationSession;
  selections: Map<string, SelectedItem>;
  hoverEl: Element | null;
  hoverChain: Element[];
  hoverIndex: number;
  root: HTMLDivElement | null;
  highlight: HTMLDivElement | null;
  tooltip: HTMLDivElement | null;
  panel: HTMLDivElement | null;
  connectorLayer: SVGSVGElement | null;
  globalNote: HTMLTextAreaElement | null;
  debugToggle: HTMLInputElement | null;
  screenshotsToggle: HTMLInputElement | null;
  countLabel: HTMLSpanElement | null;
  copyButton: HTMLButtonElement | null;
  copyTimeout: number | null;
  panelPosition: { x: number; y: number } | null;
} = {
  session: { requestId: null, options: DEFAULT_OPTIONS, active: false, completed: false },
  selections: new Map(),
  hoverEl: null,
  hoverChain: [],
  hoverIndex: 0,
  root: null,
  highlight: null,
  tooltip: null,
  panel: null,
  connectorLayer: null,
  globalNote: null,
  debugToggle: null,
  screenshotsToggle: null,
  countLabel: null,
  copyButton: null,
  copyTimeout: null,
  panelPosition: null
};

const ensureRoot = () => {
  if (state.root) return;
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute(ATTR_UI, "true");

  const highlight = document.createElement("div");
  highlight.className = "odb-highlight";
  highlight.setAttribute(ATTR_UI, "true");

  const tooltip = document.createElement("div");
  tooltip.className = "odb-tooltip";
  tooltip.setAttribute(ATTR_UI, "true");

  const connectors = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  connectors.classList.add("odb-connectors");
  connectors.setAttribute(ATTR_UI, "true");

  const panel = document.createElement("div");
  panel.className = "odb-panel";
  panel.setAttribute(ATTR_UI, "true");

  panel.innerHTML = `
    <div class="odb-panel-header">
      <div class="odb-title">Annotate</div>
      <div class="odb-actions">
        <button class="odb-btn odb-btn-ghost" data-action="copy">Copy</button>
        <button class="odb-btn odb-btn-ghost" data-action="send">Send</button>
        <button class="odb-btn odb-btn-ghost" data-action="cancel">Cancel</button>
        <button class="odb-btn odb-btn-primary" data-action="submit">Submit</button>
        <button class="odb-btn odb-btn-icon" data-action="close" aria-label="Close">×</button>
      </div>
    </div>
    <div class="odb-panel-body">
      <div class="odb-row">
        <span class="odb-label">Selected</span>
        <span class="odb-count" data-role="count">0</span>
      </div>
      <div class="odb-row">
        <span class="odb-label">Debug mode</span>
        <label class="odb-switch">
          <input type="checkbox" data-role="debug" />
          <span></span>
        </label>
      </div>
      <div class="odb-row">
        <span class="odb-label">Screenshots (Base64)</span>
        <label class="odb-switch">
          <input type="checkbox" data-role="screenshots" />
          <span></span>
        </label>
      </div>
      <label class="odb-label" style="margin-top:10px;">Context</label>
      <textarea class="odb-textarea" data-role="context" rows="2" placeholder="Add overall context..."></textarea>
    </div>
  `;

  root.appendChild(connectors);
  root.appendChild(highlight);
  root.appendChild(tooltip);
  root.appendChild(panel);
  document.documentElement.appendChild(root);

  state.root = root;
  state.highlight = highlight;
  state.tooltip = tooltip;
  state.panel = panel;
  state.connectorLayer = connectors;
  state.globalNote = panel.querySelector("textarea[data-role='context']") as HTMLTextAreaElement;
  state.debugToggle = panel.querySelector("input[data-role='debug']") as HTMLInputElement;
  state.screenshotsToggle = panel.querySelector("input[data-role='screenshots']") as HTMLInputElement;
  state.countLabel = panel.querySelector("[data-role='count']") as HTMLSpanElement;
  state.copyButton = panel.querySelector("button[data-action='copy']") as HTMLButtonElement;

  const panelRect = panel.getBoundingClientRect();
  const panelPosition = {
    x: panelRect.left,
    y: panelRect.top
  };
  state.panelPosition = panelPosition;
  positionPanel(panel, panelPosition);

  const header = panel.querySelector(".odb-panel-header") as HTMLDivElement | null;
  header?.addEventListener("mousedown", (event) => startPanelDrag(event));

  panel.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "copy") {
      copyPayload().catch((error) => {
        logError("annotation.copy_payload", error, { code: "annotation_copy_failed" });
        setCopyFeedback("Copy failed");
      });
    }
    if (action === "send") {
      sendPayload(undefined, "annotate_all", "Annotation payload").catch((error) => {
        logError("annotation.send_payload", error, { code: "annotation_send_failed" });
        setCopyFeedback("Send failed");
      });
    }
    if (action === "cancel") {
      cancelSession();
    }
    if (action === "close") {
      cancelSession();
    }
    if (action === "submit") {
      submitSession().catch((error) => {
        logError("annotation.submit", error, { code: "annotation_submit_failed" });
      });
    }
  });

  state.debugToggle?.addEventListener("change", () => {
    state.session.options.debug = Boolean(state.debugToggle?.checked);
  });

  state.screenshotsToggle?.addEventListener("change", () => {
    state.session.options.includeScreenshots = Boolean(state.screenshotsToggle?.checked);
  });
};

const teardown = () => {
  removeListeners();
  state.selections.clear();
  state.hoverEl = null;
  state.hoverChain = [];
  state.hoverIndex = 0;
  state.session.active = false;
  state.session.completed = false;
  syncBridgeActive();
  if (state.root) {
    state.root.remove();
  }
  state.root = null;
  state.highlight = null;
  state.tooltip = null;
  state.panel = null;
  state.connectorLayer = null;
  state.globalNote = null;
  state.debugToggle = null;
  state.screenshotsToggle = null;
  state.countLabel = null;
  state.copyButton = null;
  if (state.copyTimeout !== null) {
    window.clearTimeout(state.copyTimeout);
  }
  state.copyTimeout = null;
  state.panelPosition = null;
};

const addListeners = () => {
  document.addEventListener("mousemove", handleHover, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  window.addEventListener("scroll", scheduleConnectorUpdate, true);
  window.addEventListener("resize", scheduleConnectorUpdate, true);
};

const removeListeners = () => {
  document.removeEventListener("mousemove", handleHover, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("keydown", handleKeyDown, true);
  document.removeEventListener("wheel", handleWheel, true);
  window.removeEventListener("scroll", scheduleConnectorUpdate, true);
  window.removeEventListener("resize", scheduleConnectorUpdate, true);
};

const syncBridgeActive = () => {
  if (annotationWindow.__odbAnnotate) {
    annotationWindow.__odbAnnotate.active = state.session.active;
  }
};

const buildBridgeStatus = () => ({
  ok: true,
  bootId: BOOT_ID,
  active: state.session.active
});

const isUiElement = (element: Element | null): boolean => {
  if (!element) return false;
  return Boolean(element.closest(`[${ATTR_UI}]`));
};

const startSession = (requestId: string | null, options?: Partial<AnnotationOptions>) => {
  ensureRoot();
  state.session.requestId = requestId;
  state.session.options = mergeOptions(options);
  state.session.completed = false;
  if (state.debugToggle) {
    state.debugToggle.checked = state.session.options.debug;
  }
  if (state.screenshotsToggle) {
    state.screenshotsToggle.checked = state.session.options.includeScreenshots;
  }
  if (state.globalNote && state.session.options.context) {
    state.globalNote.value = state.session.options.context;
  }
  state.session.active = true;
  syncBridgeActive();
  addListeners();
  scheduleConnectorUpdate();
};

const cancelSession = () => {
  const requestId = state.session.requestId;
  if (requestId && !state.session.completed) {
    chrome.runtime.sendMessage({ type: "annotation:cancelled", requestId });
  }
  teardown();
};

const submitSession = async () => {
  if (!state.session.active || state.session.completed) return;
  if (!state.session.requestId) {
    finalizeSubmission();
    return;
  }
  const requestId = state.session.requestId;
  try {
    const payload = await buildPayload();
    chrome.runtime.sendMessage({ type: "annotation:complete", requestId, payload });
    finalizeSubmission();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Annotation failed.";
    const code: AnnotationErrorCode = shouldReportCaptureFailure(message) ? "capture_failed" : "unknown";
    chrome.runtime.sendMessage({ type: "annotation:error", requestId, error: { code, message } });
  }
};

const finalizeSubmission = () => {
  state.session.completed = true;
  state.session.active = false;
  syncBridgeActive();
  removeListeners();
  if (state.highlight) {
    state.highlight.style.opacity = "0";
  }
  if (state.tooltip) {
    state.tooltip.style.opacity = "0";
  }
};

const handleHover = (event: MouseEvent) => {
  if (!state.session.active) return;
  const elements = document.elementsFromPoint(event.clientX, event.clientY);
  const target = elements.find((el) => !isUiElement(el)) ?? null;
  if (!target || target === document.documentElement || target === document.body) return;
  if (state.hoverEl === target) return;
  state.hoverEl = target;
  state.hoverChain = buildAncestorChain(target);
  state.hoverIndex = 0;
  updateHighlight(target, event.clientX, event.clientY);
};

const handleClick = (event: MouseEvent) => {
  if (!state.session.active) return;
  if (isUiElement(event.target as Element)) return;
  event.preventDefault();
  event.stopPropagation();
  const clickedTarget = event.target instanceof Element && !isUiElement(event.target)
    ? event.target
    : null;
  const target = clickedTarget ?? state.hoverEl;
  if (!target) return;
  state.hoverEl = target;
  state.hoverChain = buildAncestorChain(target);
  state.hoverIndex = 0;
  if (event.shiftKey) {
    toggleSelection(target);
  } else {
    clearSelections();
    addSelection(target);
  }
  updateCount();
  scheduleConnectorUpdate();
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (!state.session.active) return;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelSession();
  }
};

const handleWheel = (event: WheelEvent) => {
  if (!state.session.active || !state.hoverEl) return;
  if (isUiElement(event.target as Element)) return;
  if (!state.hoverChain.length) return;
  event.preventDefault();
  const direction = event.deltaY > 0 ? 1 : -1;
  const nextIndex = clamp(state.hoverIndex + direction, 0, state.hoverChain.length - 1);
  if (nextIndex === state.hoverIndex) return;
  state.hoverIndex = nextIndex;
  const next = state.hoverChain[nextIndex];
  if (!next) return;
  state.hoverEl = next;
  updateHighlight(next, event.clientX, event.clientY);
};

const updateHighlight = (element: Element, x: number, y: number) => {
  if (!state.highlight || !state.tooltip) return;
  const rect = element.getBoundingClientRect();
  state.highlight.style.opacity = "1";
  state.highlight.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  state.highlight.style.width = `${rect.width}px`;
  state.highlight.style.height = `${rect.height}px`;

  const label = describeElement(element);
  state.tooltip.textContent = label;
  state.tooltip.style.opacity = "1";
  const tooltipX = clamp(x + 12, 8, window.innerWidth - 240);
  const tooltipY = clamp(y + 12, 8, window.innerHeight - 40);
  state.tooltip.style.transform = `translate(${tooltipX}px, ${tooltipY}px)`;
};

const addSelection = (element: Element) => {
  const id = generateId();
  const noteEl = createNote(element, id);
  const noteSize = {
    width: Math.max(noteEl.offsetWidth, 300),
    height: Math.max(noteEl.offsetHeight, 120)
  };
  const panels = state.panel ? [rectFromDomRect(state.panel.getBoundingClientRect())] : [];
  const existing = Array.from(state.selections.values()).map((selection) => ({
    x: selection.position.x,
    y: selection.position.y,
    width: Math.max(selection.noteEl.offsetWidth, 300),
    height: Math.max(selection.noteEl.offsetHeight, 120)
  }));
  const placement = computeAnnotationPlacement({
    anchorRect: rectFromDomRect(element.getBoundingClientRect()),
    floatingSize: noteSize,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panels,
    existing,
    desiredSide: "right"
  });
  const selection: SelectedItem = {
    id,
    element,
    note: "",
    noteEl,
    noteInput: noteEl.querySelector("textarea") as HTMLTextAreaElement,
    position: { x: placement.x, y: placement.y }
  };
  state.selections.set(id, selection);
  positionNote(selection);
};

const toggleSelection = (element: Element) => {
  const existing = findSelectionByElement(element);
  if (existing) {
    existing.noteEl.remove();
    state.selections.delete(existing.id);
    return;
  }
  addSelection(element);
};

const clearSelections = () => {
  for (const selection of state.selections.values()) {
    selection.noteEl.remove();
  }
  state.selections.clear();
};

const updateCount = () => {
  if (state.countLabel) {
    state.countLabel.textContent = String(state.selections.size);
  }
};

const createNote = (element: Element, id: string): HTMLDivElement => {
  const note = document.createElement("div");
  note.className = "odb-note";
  note.setAttribute(ATTR_UI, "true");
  note.dataset.noteId = id;
  note.innerHTML = `
    <div class="odb-note-header">
      <span>${describeElement(element)}</span>
      <div class="odb-actions">
        <button class="odb-btn odb-btn-ghost" data-role="copy-item" type="button">Copy</button>
        <button class="odb-btn odb-btn-ghost" data-role="send-item" type="button">Send</button>
        <button class="odb-note-close" data-role="remove-item" aria-label="Remove" type="button">x</button>
      </div>
    </div>
    <textarea class="odb-note-input" rows="3" placeholder="Add annotation..."></textarea>
  `;

  const close = note.querySelector("button[data-role='remove-item']") as HTMLButtonElement;
  close.addEventListener("click", () => {
    note.remove();
    state.selections.delete(id);
    updateCount();
    scheduleConnectorUpdate();
  });

  const copyButton = note.querySelector("button[data-role='copy-item']") as HTMLButtonElement;
  copyButton.addEventListener("click", () => {
    void copyPayload([id], copyButton).catch((error) => {
      logError("annotation.copy_item_payload", error, { code: "annotation_copy_item_failed", extra: { id } });
      setButtonFeedback(copyButton, "Copy failed");
    });
  });

  const sendButton = note.querySelector("button[data-role='send-item']") as HTMLButtonElement;
  sendButton.addEventListener("click", () => {
    const selection = state.selections.get(id);
    void sendPayload(
      [id],
      "annotate_item",
      selection ? describeAnnotationItem(buildAnnotationItem(selection)) : "Annotation item",
      sendButton
    ).catch((error) => {
      logError("annotation.send_item_payload", error, { code: "annotation_send_item_failed", extra: { id } });
      setButtonFeedback(sendButton, "Send failed");
    });
  });

  const textarea = note.querySelector("textarea") as HTMLTextAreaElement;
  textarea.addEventListener("input", () => {
    const selection = state.selections.get(id);
    if (!selection) return;
    selection.note = textarea.value;
  });

  const header = note.querySelector(".odb-note-header") as HTMLDivElement;
  header.addEventListener("mousedown", (event) => startDrag(event, id));

  document.documentElement.appendChild(note);
  bringToFront(note);
  return note;
};

const startDrag = (event: MouseEvent, id: string) => {
  event.preventDefault();
  const selection = state.selections.get(id);
  if (!selection) return;
  bringToFront(selection.noteEl);
  const start = { x: event.clientX, y: event.clientY };
  const origin = { ...selection.position };

  const onMove = (moveEvent: MouseEvent) => {
    const next = {
      x: origin.x + (moveEvent.clientX - start.x),
      y: origin.y + (moveEvent.clientY - start.y)
    };
    selection.position = clampToViewport(next, selection.noteEl);
    positionNote(selection);
    scheduleConnectorUpdate();
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
};

const positionNote = (selection: SelectedItem) => {
  selection.noteEl.style.transform = `translate(${selection.position.x}px, ${selection.position.y}px)`;
};

let zIndexCounter = 10;
const bringToFront = (element: HTMLElement) => {
  zIndexCounter += 1;
  element.style.zIndex = String(zIndexCounter);
};

const clampToViewport = (position: { x: number; y: number }, element: HTMLElement) => {
  const maxX = Math.max(0, window.innerWidth - element.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - element.offsetHeight);
  return {
    x: clamp(position.x, 0, maxX),
    y: clamp(position.y, 0, maxY)
  };
};

const rectFromDomRect = (rect: DOMRect): AnnotationRect => ({
  x: rect.left,
  y: rect.top,
  width: rect.width,
  height: rect.height
});

type AnnotationPlacementSide = "right" | "left" | "top" | "bottom";
type AnnotationPlacementInput = {
  anchorRect: AnnotationRect;
  floatingSize: { width: number; height: number };
  viewport: { width: number; height: number };
  panels?: AnnotationRect[];
  existing?: AnnotationRect[];
  desiredSide?: AnnotationPlacementSide;
};

type NotePlacementCandidate = {
  side: AnnotationPlacementSide;
  rect: AnnotationRect;
  clamped: boolean;
  overlapsPanel: boolean;
  overlapsExisting: boolean;
  score: number;
};

const noteCandidateSides = (desired: AnnotationPlacementSide): AnnotationPlacementSide[] => {
  const ordered: AnnotationPlacementSide[] = [desired, "right", "left", "bottom", "top"];
  return ordered.filter((side, index) => ordered.indexOf(side) === index);
};

const noteRectForSide = (
  anchor: AnnotationRect,
  size: { width: number; height: number },
  side: AnnotationPlacementSide
): AnnotationRect => {
  if (side === "right") {
    return { x: anchor.x + anchor.width + NOTE_PLACEMENT_GAP, y: anchor.y + anchor.height / 2 - size.height / 2, width: size.width, height: size.height };
  }
  if (side === "left") {
    return { x: anchor.x - size.width - NOTE_PLACEMENT_GAP, y: anchor.y + anchor.height / 2 - size.height / 2, width: size.width, height: size.height };
  }
  if (side === "top") {
    return { x: anchor.x + anchor.width / 2 - size.width / 2, y: anchor.y - size.height - NOTE_PLACEMENT_GAP, width: size.width, height: size.height };
  }
  return { x: anchor.x + anchor.width / 2 - size.width / 2, y: anchor.y + anchor.height + NOTE_PLACEMENT_GAP, width: size.width, height: size.height };
};

const clampNoteRect = (rect: AnnotationRect, viewport: { width: number; height: number }): { rect: AnnotationRect; clamped: boolean } => {
  const maxX = Math.max(NOTE_PLACEMENT_MARGIN, viewport.width - rect.width - NOTE_PLACEMENT_MARGIN);
  const maxY = Math.max(NOTE_PLACEMENT_MARGIN, viewport.height - rect.height - NOTE_PLACEMENT_MARGIN);
  const x = clamp(rect.x, NOTE_PLACEMENT_MARGIN, maxX);
  const y = clamp(rect.y, NOTE_PLACEMENT_MARGIN, maxY);
  return { rect: { ...rect, x, y }, clamped: x !== rect.x || y !== rect.y };
};

const rectsOverlap = (left: AnnotationRect, right: AnnotationRect): boolean => {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
};

const rectIntersectionArea = (left: AnnotationRect, right: AnnotationRect): number => {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
};

const hasDominantExistingOverlap = (rect: AnnotationRect, existing: AnnotationRect[] | undefined): boolean => {
  const area = rect.width * rect.height;
  return area > 0 && (existing ?? []).some((entry) => rectIntersectionArea(rect, entry) / area >= EXISTING_SIDE_BLOCK_RATIO);
};

const rectCenter = (rect: AnnotationRect): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2
});

const rectDistance = (left: AnnotationRect, right: AnnotationRect): number => {
  const a = rectCenter(left);
  const b = rectCenter(right);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
};

const inferNotePlacementSide = (anchor: AnnotationRect, rect: AnnotationRect): AnnotationPlacementSide => {
  const anchorCenter = rectCenter(anchor);
  const noteCenter = rectCenter(rect);
  const deltaX = noteCenter.x - anchorCenter.x;
  const deltaY = noteCenter.y - anchorCenter.y;
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX >= 0 ? "right" : "left";
  }
  return deltaY >= 0 ? "bottom" : "top";
};

const buildNotePlacementDecision = (
  input: AnnotationPlacementInput,
  rect: AnnotationRect,
  side: AnnotationPlacementSide,
  index: number
): NotePlacementCandidate => {
  const clamped = clampNoteRect(rect, input.viewport);
  const overlapsPanel = (input.panels ?? []).some((panel) => rectsOverlap(clamped.rect, panel));
  const overlapsExisting = (input.existing ?? []).some((entry) => rectsOverlap(clamped.rect, entry));
  const score = rectDistance(input.anchorRect, clamped.rect)
    + (overlapsPanel ? COLLISION_PENALTY : 0)
    + (overlapsExisting ? COLLISION_PENALTY : 0)
    + (clamped.clamped ? CLAMP_PENALTY : 0)
    + index * SIDE_ORDER_PENALTY;
  return { side, rect: clamped.rect, clamped: clamped.clamped, overlapsPanel, overlapsExisting, score };
};

const buildGridNotePlacement = (
  input: AnnotationPlacementInput,
  desired: AnnotationPlacementSide,
  existingBlockedSides: Set<AnnotationPlacementSide>
): NotePlacementCandidate | null => {
  const { width, height } = input.floatingSize;
  const maxX = Math.max(NOTE_PLACEMENT_MARGIN, input.viewport.width - width - NOTE_PLACEMENT_MARGIN);
  const maxY = Math.max(NOTE_PLACEMENT_MARGIN, input.viewport.height - height - NOTE_PLACEMENT_MARGIN);
  const sides = noteCandidateSides(desired);
  const candidates: NotePlacementCandidate[] = [];
  for (let y = NOTE_PLACEMENT_MARGIN; y <= maxY; y += NOTE_PLACEMENT_GRID_STEP) {
    for (let x = NOTE_PLACEMENT_MARGIN; x <= maxX; x += NOTE_PLACEMENT_GRID_STEP) {
      const rect = { x, y, width, height };
      const side = inferNotePlacementSide(input.anchorRect, rect);
      const sideIndex = side === desired ? sides.length : Math.max(sides.indexOf(side), 0);
      const decision = buildNotePlacementDecision(input, rect, side, sideIndex);
      const sidePenalty = existingBlockedSides.has(side) ? COLLISION_PENALTY : 0;
      if (!decision.overlapsPanel && !decision.overlapsExisting) {
        candidates.push({ ...decision, clamped: true, score: decision.score + sidePenalty });
      }
    }
  }
  return candidates.sort((left, right) => left.score - right.score)[0] ?? null;
};

const computeAnnotationPlacement = (input: AnnotationPlacementInput): { x: number; y: number; side: AnnotationPlacementSide } => {
  if (input.viewport.width <= MOBILE_NOTE_PLACEMENT_MAX_WIDTH) {
    const yMax = Math.max(NOTE_PLACEMENT_MARGIN, input.viewport.height - input.floatingSize.height - NOTE_PLACEMENT_MARGIN);
    const y = clamp(input.anchorRect.y + input.anchorRect.height + NOTE_PLACEMENT_GAP, NOTE_PLACEMENT_MARGIN, yMax);
    return { x: NOTE_PLACEMENT_MARGIN, y, side: "bottom" };
  }
  const desired = input.desiredSide ?? "right";
  const anchored = noteCandidateSides(desired).map((side, index) => buildNotePlacementDecision(
    input,
    noteRectForSide(input.anchorRect, input.floatingSize, side),
    side,
    index
  )).sort((left, right) => left.score - right.score);
  const existingBlockedSides = new Set(anchored
    .filter((entry) => hasDominantExistingOverlap(entry.rect, input.existing))
    .map((entry) => entry.side));
  const best = anchored.find((entry) => !entry.overlapsPanel && !entry.overlapsExisting)
    ?? buildGridNotePlacement(input, desired, existingBlockedSides)
    ?? anchored[0]
    ?? { side: "right" as const, rect: { x: NOTE_PLACEMENT_MARGIN, y: NOTE_PLACEMENT_MARGIN, width: input.floatingSize.width, height: input.floatingSize.height } };
  return { x: best.rect.x, y: best.rect.y, side: best.side };
};

const positionPanel = (panel: HTMLDivElement, position: { x: number; y: number }) => {
  panel.style.left = `${position.x}px`;
  panel.style.top = `${position.y}px`;
  panel.style.right = "auto";
};

const startPanelDrag = (event: MouseEvent) => {
  if (!state.panel) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest(".odb-actions")) return;
  event.preventDefault();
  bringToFront(state.panel);
  const panel = state.panel;
  const rect = panel.getBoundingClientRect();
  const start = { x: event.clientX, y: event.clientY };
  const origin = { x: rect.left, y: rect.top };

  const onMove = (moveEvent: MouseEvent) => {
    const next = {
      x: origin.x + (moveEvent.clientX - start.x),
      y: origin.y + (moveEvent.clientY - start.y)
    };
    const clamped = clampToViewport(next, panel);
    state.panelPosition = clamped;
    positionPanel(panel, clamped);
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
};

let connectorFrame = 0;
const scheduleConnectorUpdate = () => {
  if (connectorFrame) return;
  connectorFrame = requestAnimationFrame(() => {
    connectorFrame = 0;
    updateConnectors();
  });
};

const updateConnectors = () => {
  if (!state.connectorLayer) return;
  state.connectorLayer.innerHTML = "";
  for (const selection of state.selections.values()) {
    const rect = selection.element.getBoundingClientRect();
    const noteRect = selection.noteEl.getBoundingClientRect();
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(rect.left + rect.width / 2));
    line.setAttribute("y1", String(rect.top + rect.height / 2));
    line.setAttribute("x2", String(noteRect.left + noteRect.width / 2));
    line.setAttribute("y2", String(noteRect.top + 18));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.5");
    state.connectorLayer.appendChild(line);
  }
};

const buildCompletePayload = async (): Promise<AnnotationPayload> => {
  const url = window.location.href;
  const title = document.title;
  const timestamp = new Date().toISOString();
  const context = state.globalNote?.value?.trim() || state.session.options.context;
  const screenshotMode = state.session.options.screenshotMode;
  const includeScreenshots = state.session.options.includeScreenshots;
  const effectiveScreenshotMode = includeScreenshots ? screenshotMode : "none";

  const annotations: Array<ReturnType<typeof buildAnnotationItem>> = [];
  for (const selection of state.selections.values()) {
    annotations.push(buildAnnotationItem(selection));
  }

  const screenshots = await captureScreenshots(effectiveScreenshotMode, annotations);

  const payload: AnnotationPayload = {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    url,
    title,
    timestamp,
    context,
    screenshotMode: effectiveScreenshotMode,
    screenshots,
    annotations
  };
  payload.compact = buildCompactAnnotationPayload(payload);
  return payload;
};

const buildPayload = async (annotationIds?: string[]): Promise<AnnotationPayload> => {
  const payload = await buildCompletePayload();
  if (!annotationIds || annotationIds.length === 0) {
    return payload;
  }
  return filterAnnotationPayload(payload, annotationIds, {
    includeScreenshots: Boolean(payload.screenshots?.length)
  });
};

const extractBase64 = (dataUrl: string): string => {
  if (!dataUrl.includes(",")) return dataUrl;
  return dataUrl.split(",")[1] ?? "";
};

const captureScreenshots = async (
  mode: AnnotationOptions["screenshotMode"],
  annotations: Array<ReturnType<typeof buildAnnotationItem>>
) => {
  if (mode === "none") return [];
  const screenshots: { id: string; label: string; base64: string; mime: "image/png"; width?: number; height?: number }[] = [];

  await setUiVisibility(false);
  try {
    if (mode === "visible") {
      const dataUrl = await requestCapture("visible");
      const image = await loadImage(dataUrl);
      const scaleX = image.naturalWidth / window.innerWidth;
      const scaleY = image.naturalHeight / window.innerHeight;
      for (const annotation of annotations) {
        const rect = annotation.rect;
        const padded = padRect(rect, 12, window.innerWidth, window.innerHeight);
        const crop = cropImage(image, padded, scaleX, scaleY);
        const id = generateId();
        screenshots.push({ id, label: "element", base64: crop, mime: "image/png", width: rect.width, height: rect.height });
        annotation.screenshotId = id;
      }
    }

    if (mode === "full") {
      const dataUrl = await captureFullPage();
      const image = await loadImage(dataUrl);
      const id = generateId();
      screenshots.push({
        id,
        label: "full-page",
        base64: extractBase64(dataUrl),
        mime: "image/png",
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      annotations.forEach((annotation) => {
        annotation.screenshotId = id;
      });
    }
  } finally {
    await setUiVisibility(true);
  }
  return screenshots;
};

const requestCapture = async (mode: AnnotationScreenshotMode): Promise<string> => {
  return await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "annotation:capture", requestId: state.session.requestId ?? "local", mode }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response || response.ok !== true || !response.dataUrl) {
        reject(new Error(response?.error ?? "Capture failed"));
        return;
      }
      resolve(response.dataUrl as string);
    });
  });
};

const captureFullPage = async (): Promise<string> => {
  const original = { x: window.scrollX, y: window.scrollY };
  const viewportHeight = window.innerHeight;
  const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  const totalWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth, window.innerWidth);
  const slices: HTMLImageElement[] = [];

  const maxSlices = Math.ceil(totalHeight / viewportHeight);
  if (maxSlices > 12) {
    throw new Error("Page too tall for full-page capture.");
  }

  try {
    for (let index = 0; index < maxSlices; index += 1) {
      const y = index * viewportHeight;
      window.scrollTo({ top: y, behavior: "auto" });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const dataUrl = await requestCapture("visible");
      slices.push(await loadImage(dataUrl));
    }
  } finally {
    window.scrollTo({ top: original.y, left: original.x, behavior: "auto" });
  }

  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas unavailable");
  }

  slices.forEach((slice, index) => {
    ctx.drawImage(slice, 0, index * viewportHeight, slice.naturalWidth, slice.naturalHeight);
  });

  return canvas.toDataURL("image/png");
};

const loadImage = (dataUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
};

const cropImage = (image: HTMLImageElement, rect: { x: number; y: number; width: number; height: number }, scaleX: number, scaleY: number): string => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scaleX));
  canvas.height = Math.max(1, Math.round(rect.height * scaleY));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  ctx.drawImage(
    image,
    rect.x * scaleX,
    rect.y * scaleY,
    rect.width * scaleX,
    rect.height * scaleY,
    0,
    0,
    rect.width * scaleX,
    rect.height * scaleY
  );
  return extractBase64(canvas.toDataURL("image/png"));
};

const padRect = (rect: { x: number; y: number; width: number; height: number }, padding: number, maxWidth: number, maxHeight: number) => {
  const x = clamp(rect.x - padding, 0, maxWidth);
  const y = clamp(rect.y - padding, 0, maxHeight);
  const width = clamp(rect.width + padding * 2, 1, maxWidth - x);
  const height = clamp(rect.height + padding * 2, 1, maxHeight - y);
  return { x, y, width, height };
};

const setUiVisibility = async (visible: boolean): Promise<void> => {
  if (!state.root) return;
  state.root.style.opacity = visible ? "1" : "0";
  state.root.style.pointerEvents = visible ? "auto" : "none";
  await new Promise((resolve) => setTimeout(resolve, 50));
};

const buildAnnotationItem = (selection: SelectedItem) => {
  const element = selection.element;
  const rect = element.getBoundingClientRect();
  const computed = window.getComputedStyle(element);
  const a11y = {
    role: element.getAttribute("role") ?? undefined,
    label: element.getAttribute("aria-label") ?? undefined,
    labelledBy: element.getAttribute("aria-labelledby") ?? undefined,
    describedBy: element.getAttribute("aria-describedby") ?? undefined,
    hidden: element.getAttribute("aria-hidden") === "true"
  };

  const attributes = captureAttributes(element);
  const styles = {
    color: computed.color,
    backgroundColor: computed.backgroundColor,
    fontSize: computed.fontSize,
    fontFamily: computed.fontFamily,
    fontWeight: computed.fontWeight,
    lineHeight: computed.lineHeight,
    display: computed.display,
    position: computed.position
  };

  const debug = state.session.options.debug
    ? {
      computedStyles: captureComputedStyles(computed),
      cssVariables: captureCssVariables(computed),
      parentChain: buildParentChain(element)
    }
    : undefined;

  const selector = getSelector(element);
  const item = {
    id: selection.id,
    selector,
    tag: element.tagName.toLowerCase(),
    idAttr: element.id || undefined,
    classes: Array.from(element.classList ?? []),
    text: getTextContent(element),
    rect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    },
    attributes,
    a11y,
    styles,
    note: selection.note.trim() || undefined,
    screenshotId: selection.screenshotId,
    debug
  };
  return {
    ...item,
    identity: buildTargetIdentity(item),
    selectorBundle: buildSelectorBundle(item)
  };
};

const captureAttributes = (element: Element): Record<string, string> => {
  const allowed = new Set(["href", "src", "alt", "title", "role", "aria-label", "aria-labelledby", "aria-describedby", "type", "name"]);
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === "value") continue;
    if (!allowed.has(name) && !name.startsWith("data-")) {
      continue;
    }
    if (looksSensitive(attr.value)) {
      continue;
    }
    attrs[attr.name] = attr.value;
  }
  return attrs;
};

const captureComputedStyles = (computed: CSSStyleDeclaration): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const prop of ["display", "position", "margin", "padding", "color", "background-color", "font-size", "font-family", "font-weight", "line-height"]) {
    values[prop] = computed.getPropertyValue(prop);
  }
  return values;
};

const captureCssVariables = (computed: CSSStyleDeclaration): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (let i = 0; i < computed.length; i += 1) {
    const name = computed.item(i);
    if (name.startsWith("--")) {
      const value = computed.getPropertyValue(name).trim();
      if (value) {
        vars[name] = value;
      }
    }
  }
  return vars;
};

const buildParentChain = (element: Element): Array<{ tag: string; id?: string; classes?: string[]; role?: string }> => {
  const chain: Array<{ tag: string; id?: string; classes?: string[]; role?: string }> = [];
  let current: Element | null = element.parentElement;
  let depth = 0;
  while (current && depth < 3) {
    chain.push({
      tag: current.tagName.toLowerCase(),
      id: current.id || undefined,
      classes: Array.from(current.classList ?? []),
      role: current.getAttribute("role") ?? undefined
    });
    current = current.parentElement;
    depth += 1;
  }
  return chain;
};

const buildAncestorChain = (element: Element): Element[] => {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    chain.push(current);
    current = current.parentElement;
  }
  return chain;
};

const getSelector = (element: Element): string => {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const classes = Array.from(current.classList).filter(Boolean).slice(0, 2);
    if (classes.length) {
      part += "." + classes.map((cls) => cssEscape(cls)).join(".");
    }
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter((el) => el.tagName === current?.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(" > ");
};

const cssEscape = (value: string): string => {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-z0-9_-]/gi, (match) => `\\${match}`);
};

const getTextContent = (element: Element): string | undefined => {
  const text = element.textContent?.trim() ?? "";
  if (!text) return undefined;
  return looksSensitive(text) ? "[redacted]" : text.slice(0, 240);
};

const describeElement = (element: Element): string => {
  const id = element.id ? `#${element.id}` : "";
  const classes = element.classList.length ? `.${Array.from(element.classList).slice(0, 2).join(".")}` : "";
  const rect = element.getBoundingClientRect();
  return `${element.tagName.toLowerCase()}${id}${classes} (${Math.round(rect.width)}x${Math.round(rect.height)})`;
};

const findSelectionByElement = (element: Element): SelectedItem | null => {
  for (const selection of state.selections.values()) {
    if (selection.element === element) {
      return selection;
    }
  }
  return null;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const generateId = (): string => {
  return Math.random().toString(36).slice(2, 10);
};

const looksSensitive = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length < 12) return false;
  if (/token|secret|password|apikey/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9+/_-]{24,}={0,2}$/.test(trimmed)) return true;
  return false;
};

const shouldReportCaptureFailure = (message: string): boolean => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("capture")
    || lowered.includes("image")
    || lowered.includes("canvas")
    || lowered.includes("page too tall")
  );
};

const mergeOptions = (options?: Partial<AnnotationOptions>): AnnotationOptions => {
  return {
    screenshotMode: options?.screenshotMode ?? DEFAULT_OPTIONS.screenshotMode,
    includeScreenshots: options?.includeScreenshots ?? DEFAULT_OPTIONS.includeScreenshots,
    debug: options?.debug ?? DEFAULT_OPTIONS.debug,
    context: options?.context ?? DEFAULT_OPTIONS.context
  };
};

const compactByteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const escapeSelectorAttribute = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");

const readAttributeSelector = (attributes: Record<string, string>): string | null => {
  for (const key of ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy"]) {
    const value = attributes[key]?.trim();
    if (value) {
      return `[${key}="${escapeSelectorAttribute(value)}"]`;
    }
  }
  return null;
};

const buildUnavailableSelectorCandidate = (
  family: AnnotationSelectorFamily,
  rank: number,
  unavailableReason: string,
  recoveryHint: string
): AnnotationSelectorCandidate => ({
  family,
  rank,
  confidence: "low",
  scope: family === "shadowChain" ? "shadow" : family === "text" ? "text" : "document",
  transport: "extension",
  availability: "unavailable",
  unavailableReason,
  recoveryHint
});

const buildAriaSelector = (a11y: Record<string, unknown> | undefined): string | null => {
  const role = typeof a11y?.role === "string" && a11y.role.trim() ? a11y.role.trim() : null;
  const label = typeof a11y?.label === "string" && a11y.label.trim() ? a11y.label.trim() : null;
  return role && label ? `role=${role}[name="${escapeSelectorAttribute(label)}"]` : null;
};

const buildXpathSelector = (item: AnnotationPayload["annotations"][number]): string | null => {
  if (item.idAttr) {
    return `//*[@id="${escapeSelectorAttribute(item.idAttr)}"]`;
  }
  if (item.text) {
    return `//${item.tag}[normalize-space()="${escapeSelectorAttribute(item.text.slice(0, 80))}"]`;
  }
  return null;
};

const buildSelectorBundle = (item: AnnotationPayload["annotations"][number]): AnnotationSelectorBundle => {
  const testId = readAttributeSelector(item.attributes ?? {});
  const aria = buildAriaSelector(item.a11y);
  const shadow = item.attributes?.["data-shadow-chain"];
  const xpath = buildXpathSelector(item);
  const text = item.text?.trim();
  const candidates: AnnotationSelectorCandidate[] = [
    buildUnavailableSelectorCandidate("backendNodeId", 10, "requires_cdp_capture", "Use CDP capture for same-session backend node recovery."),
    buildUnavailableSelectorCandidate("frameId", 20, "requires_cdp_capture", "Use CDP capture for frame-scoped recovery."),
    testId
      ? { family: "testId", rank: 30, confidence: "high", scope: "document", transport: "extension", availability: "available", value: testId }
      : buildUnavailableSelectorCandidate("testId", 30, "missing_test_id", "Add a stable data-testid or data-test-id."),
    aria
      ? { family: "aria", rank: 40, confidence: "high", scope: "document", transport: "extension", availability: "available", value: aria }
      : buildUnavailableSelectorCandidate("aria", 40, "missing_aria_role_or_name", "Expose a stable role and accessible name."),
    { family: "css", rank: 50, confidence: "medium", scope: "document", transport: "extension", availability: "available", value: item.selector },
    shadow
      ? { family: "shadowChain", rank: 60, confidence: "medium", scope: "shadow", transport: "extension", availability: "available", value: shadow }
      : buildUnavailableSelectorCandidate("shadowChain", 60, "not_in_shadow_tree", "Capture a shadow host chain when the target is inside shadow DOM."),
    xpath
      ? { family: "xpath", rank: 70, confidence: "low", scope: "document", transport: "extension", availability: "available", value: xpath }
      : buildUnavailableSelectorCandidate("xpath", 70, "insufficient_xpath_facts", "Provide id or bounded text for XPath fallback."),
    text
      ? { family: "text", rank: 80, confidence: "low", scope: "text", transport: "extension", availability: "available", value: `text=${text.slice(0, 80)}` }
      : buildUnavailableSelectorCandidate("text", 80, "missing_text", "Use text only as the last fallback.")
  ];
  return {
    primary: item.selector,
    transport: "extension",
    candidates,
    recoveryHints: candidates.flatMap((entry) => entry.availability === "unavailable" && entry.recoveryHint ? [entry.recoveryHint] : [])
  };
};

const buildTargetIdentity = (item: AnnotationPayload["annotations"][number]): AnnotationTargetIdentity => {
  if (item.identity) {
    return item.identity;
  }
  const explicit = readAttributeSelector(item.attributes ?? {}) ?? item.idAttr;
  if (explicit) {
    return { source: "explicitData", priority: 10, stableId: explicit, label: item.text ?? item.selector };
  }
  if (item.tag.includes("-")) {
    return { source: "customElement", priority: 30, stableId: item.selector, label: item.text, customElement: { tag: item.tag } };
  }
  const aria = buildAriaSelector(item.a11y);
  if (aria) {
    return { source: "accessibility", priority: 40, stableId: aria, label: typeof item.a11y?.label === "string" ? item.a11y.label : item.text };
  }
  return { source: "selector", priority: 50, stableId: item.selector, label: item.text };
};

const truncateCompactValue = (value: string | undefined, limit: number): { value?: string; truncated: boolean } => {
  if (!value) {
    return { truncated: false };
  }
  if (value.length <= limit) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, limit), truncated: true };
};

const buildCompactAnnotationItem = (item: AnnotationPayload["annotations"][number]): AnnotationCompactItem => {
  const text = truncateCompactValue(item.text, COMPACT_TEXT_LIMIT);
  const note = truncateCompactValue(item.note, COMPACT_NOTE_LIMIT);
  const selectorBundle = item.selectorBundle ?? buildSelectorBundle(item);
  const compact: AnnotationCompactItem = {
    id: item.id,
    label: item.note?.trim() || item.text?.trim() || item.selector,
    note: note.value,
    target: {
      tag: item.tag,
      selector: selectorBundle.primary,
      rect: item.rect,
      text: text.value,
      a11y: item.a11y
    },
    identity: buildTargetIdentity(item),
    selectorBundle,
    redaction: {
      removedFields: [
        ...(item.screenshotId ? ["screenshotId"] : []),
        ...(item.debug ? ["debug"] : []),
        ...(item.styles && Object.keys(item.styles).length ? ["styles"] : []),
        ...(item.attributes && Object.keys(item.attributes).length ? ["attributes"] : [])
      ],
      truncatedFields: [
        ...(text.truncated ? ["text"] : []),
        ...(note.truncated ? ["note"] : [])
      ],
      screenshotBytesRemoved: Boolean(item.screenshotId),
      originalByteLength: compactByteLength(item),
      compactByteLength: 0
    }
  };
  compact.redaction.compactByteLength = compactByteLength(compact);
  return compact;
};

const buildCompactAnnotationPayload = (payload: AnnotationPayload): AnnotationCompactPayload => {
  const items = payload.annotations.map(buildCompactAnnotationItem);
  const compact: AnnotationCompactPayload = {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    url: payload.url,
    title: payload.title,
    timestamp: payload.timestamp,
    context: payload.context,
    screenshotMode: "none",
    byteBudget: COMPACT_BYTE_BUDGET,
    redaction: {
      removedFields: [
        ...(payload.screenshots?.length ? ["screenshots"] : []),
        ...items.flatMap((item) => item.redaction.removedFields.map((field) => `annotations.${field}`))
      ],
      truncatedFields: items.flatMap((item) => item.redaction.truncatedFields.map((field) => `annotations.${field}`)),
      screenshotBytesRemoved: Boolean(payload.screenshots?.length) || items.some((item) => item.redaction.screenshotBytesRemoved),
      originalByteLength: compactByteLength(payload),
      compactByteLength: 0
    },
    items
  };
  compact.redaction.compactByteLength = compactByteLength(compact);
  return compact;
};

const annotationFromCompactItem = (item: AnnotationCompactItem): AnnotationPayload["annotations"][number] => ({
  id: item.id,
  selector: item.target.selector,
  tag: item.target.tag,
  text: item.target.text,
  rect: item.target.rect,
  attributes: {},
  a11y: item.target.a11y ?? {},
  styles: {},
  note: item.note,
  identity: item.identity,
  selectorBundle: item.selectorBundle
});

const sanitizeAnnotationPayloadForAgent = (payload: AnnotationPayload): AnnotationPayload => {
  const compact = buildCompactAnnotationPayload(payload);
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    url: payload.url,
    title: payload.title,
    timestamp: payload.timestamp,
    context: payload.context,
    screenshotMode: "none",
    annotations: compact.items.map(annotationFromCompactItem),
    compact
  };
};

const filterAnnotationPayload = (
  payload: AnnotationPayload,
  annotationIds: string[],
  options: { includeScreenshots?: boolean } = {}
): AnnotationPayload => {
  const includeScreenshots = options.includeScreenshots ?? true;
  const wanted = new Set(annotationIds);
  const annotations = payload.annotations.filter((annotation) => wanted.has(annotation.id));
  const screenshotIds = new Set(
    annotations
      .map((annotation) => annotation.screenshotId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const filtered: AnnotationPayload = {
    ...payload,
    screenshotMode: includeScreenshots ? payload.screenshotMode : "none",
    annotations: annotations.map((annotation) => {
      if (includeScreenshots) {
        return annotation;
      }
      const { screenshotId, ...next } = annotation;
      void screenshotId;
      return next;
    })
  };
  if (!includeScreenshots) {
    return sanitizeAnnotationPayloadForAgent(filtered);
  }
  filtered.screenshots = payload.screenshots?.filter((screenshot) => screenshotIds.has(screenshot.id));
  filtered.compact = buildCompactAnnotationPayload(filtered);
  return filtered;
};

const describeAnnotationItem = (item: AnnotationPayload["annotations"][number]): string => {
  const selector = item.selector?.trim().length ? item.selector : item.tag;
  const label = item.note?.trim().length ? item.note.trim() : item.text?.trim();
  return label ? `${selector} — ${label}` : selector;
};

const formatAnnotationDispatchReceipt = (receipt: PopupAnnotationSendPayloadResponse["receipt"]): string => {
  if (!receipt) {
    return "Stored only; fetch with annotate --stored";
  }
  if (receipt.deliveryState === "delivered" || receipt.deliveryState === "consumed") {
    return "Delivered to agent";
  }
  return "Stored only; fetch with annotate --stored";
};

const requestSharedSanitizedPayload = async (payload: AnnotationPayload): Promise<AnnotationPayload> => {
  return await new Promise<AnnotationPayload>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "annotation:sanitizePayload",
        payload
      },
      (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        const typed = response as PopupAnnotationSanitizePayloadResponse | undefined;
        if (!typed || typed.ok !== true || !typed.payload) {
          reject(new Error(typed?.error?.message ?? "Sanitize failed"));
          return;
        }
        resolve(typed.payload);
      }
    );
  });
};

const copyPayload = async (annotationIds?: string[], button?: HTMLButtonElement) => {
  const payload = await buildPayload(annotationIds);
  const text = JSON.stringify(await requestSharedSanitizedPayload(payload));
  await writeClipboard(text);
  if (button) {
    setButtonFeedback(button, "Copied");
    return;
  }
  setCopyFeedback("Copied");
};

const sendPayload = async (
  annotationIds: string[] | undefined,
  source: AnnotationDispatchSource,
  label: string,
  button?: HTMLButtonElement
) => {
  const payload = await buildPayload(annotationIds);
  const response = await new Promise<PopupAnnotationSendPayloadResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "annotation:sendPayload",
        payload,
        source,
        label
      },
      (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        const typed = response as PopupAnnotationSendPayloadResponse | undefined;
        if (!typed || typed.ok !== true) {
          reject(new Error(typed?.error?.message ?? "Send failed"));
          return;
        }
        resolve(typed);
      }
    );
  });
  if (button) {
    setButtonFeedback(button, formatAnnotationDispatchReceipt(response.receipt));
    return;
  }
  setCopyFeedback(formatAnnotationDispatchReceipt(response.receipt));
};

const writeClipboard = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to execCommand below.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) {
    throw new Error("Copy failed");
  }
};

const setCopyFeedback = (label: string) => {
  const button = state.copyButton;
  if (!button) return;
  setButtonFeedback(button, label, true);
};

const setButtonFeedback = (button: HTMLButtonElement, label: string, useSharedTimer = false) => {
  const original = button.dataset.originalLabel ?? button.textContent ?? button.getAttribute("aria-label") ?? "Action";
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = original;
  }
  button.textContent = label;
  if (useSharedTimer && state.copyTimeout !== null) {
    window.clearTimeout(state.copyTimeout);
  }
  const restore = window.setTimeout(() => {
    button.textContent = original;
  }, 1500);
  if (useSharedTimer) {
    state.copyTimeout = restore;
  }
};

const handleRuntimeMessage: AnnotationMessageListener = (message, _sender, sendResponse) => {
  if (message.type === "annotation:ping") {
    sendResponse(buildBridgeStatus());
    return true;
  }
  if (message.type === "annotation:toggle") {
    annotationWindow.__odbAnnotate?.toggle();
    sendResponse(buildBridgeStatus());
    return true;
  }
  if (message.type === "annotation:start") {
    annotationWindow.__odbAnnotate?.start(message.requestId, message.options);
    sendResponse(buildBridgeStatus());
    return true;
  }
  if (message.type === "annotation:cancel") {
    annotationWindow.__odbAnnotate?.cancel(message.requestId);
    sendResponse(buildBridgeStatus());
    return true;
  }
  return false;
};

const bootstrap = () => {
  annotationWindow.__odbAnnotate = {
    active: false,
    toggle: () => {
      if (state.session.active) {
        cancelSession();
      } else {
        startSession(null);
      }
    },
    start: (requestId: string | null, options?: Partial<AnnotationOptions>) => {
      if (state.session.active) {
        cancelSession();
      }
      startSession(requestId, options);
    },
    cancel: () => cancelSession()
  };
  syncBridgeActive();

  const previousListener = annotationWindow.__odbAnnotateMessageListener;
  if (previousListener) {
    chrome.runtime.onMessage.removeListener?.(previousListener);
  }
  annotationWindow.__odbAnnotateMessageListener = handleRuntimeMessage;
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
};

bootstrap();
