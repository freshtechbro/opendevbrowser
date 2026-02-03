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

type AnnotationErrorCode = "capture_failed" | "unknown";

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

interface Window {
  __odbAnnotate?: {
    active: boolean;
    toggle: () => void;
    start: (requestId: string | null, options?: Partial<AnnotationOptions>) => void;
    cancel: (requestId?: string) => void;
  };
}

const ROOT_ID = "odb-annotate-root";
const ATTR_UI = "data-odb-annotate";
const DEFAULT_OPTIONS: AnnotationOptions = {
  screenshotMode: "visible",
  includeScreenshots: false,
  debug: true
};

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
  const target = state.hoverEl;
  if (!target) return;
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
  const selection: SelectedItem = {
    id,
    element,
    note: "",
    noteEl,
    noteInput: noteEl.querySelector("textarea") as HTMLTextAreaElement,
    position: { x: window.innerWidth - 340, y: 140 + state.selections.size * 120 }
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
      <button class="odb-note-close" aria-label="Remove">x</button>
    </div>
    <textarea class="odb-note-input" rows="3" placeholder="Add annotation..."></textarea>
  `;

  const close = note.querySelector("button") as HTMLButtonElement;
  close.addEventListener("click", () => {
    note.remove();
    state.selections.delete(id);
    updateCount();
    scheduleConnectorUpdate();
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

const buildPayload = async () => {
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

  return {
    url,
    title,
    timestamp,
    context,
    screenshotMode: effectiveScreenshotMode,
    screenshots,
    annotations
  };
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

  return {
    id: selection.id,
    selector: getSelector(element),
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

const copyPayload = async () => {
  const payload = await buildPayload();
  const text = JSON.stringify(payload);
  await writeClipboard(text);
  setCopyFeedback("Copied");
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
  const original = button.dataset.originalLabel ?? button.textContent ?? "Copy";
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = original;
  }
  button.textContent = label;
  if (state.copyTimeout !== null) {
    window.clearTimeout(state.copyTimeout);
  }
  state.copyTimeout = window.setTimeout(() => {
    button.textContent = original;
  }, 1500);
};

const bootstrap = () => {
  if (window.__odbAnnotate) {
    return;
  }
  window.__odbAnnotate = {
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

  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message.type === "annotation:ping") {
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "annotation:toggle") {
      window.__odbAnnotate?.toggle();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "annotation:start") {
      window.__odbAnnotate?.start(message.requestId, message.options);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "annotation:cancel") {
      window.__odbAnnotate?.cancel(message.requestId);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
};

bootstrap();
