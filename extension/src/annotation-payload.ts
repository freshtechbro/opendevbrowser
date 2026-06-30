import type {
  AgentInboxReceipt,
  AnnotationA11y,
  AnnotationCompactItem,
  AnnotationCompactPayload,
  AnnotationCompactRedaction,
  AnnotationDispatchSource,
  AnnotationItem,
  AnnotationPayload,
  AnnotationRect,
  AnnotationSelectorBundle,
  AnnotationSelectorCandidate,
  AnnotationStyle,
  AnnotationTargetIdentity,
  AnnotationTransportProvenance
} from "./types.js";
import type { CanvasBinding, CanvasDocument, CanvasNode, CanvasPage, CanvasRect } from "./canvas/model.js";

export type CanvasAnnotationDraft =
  | {
    kind?: "node";
    nodeId: string;
    note?: string;
  }
  | {
    kind: "region";
    regionId: string;
    rect: CanvasRect;
    pageId?: string | null;
    label?: string;
    note?: string;
  };

export type AnnotationPlacementSide = "right" | "left" | "top" | "bottom";

export type AnnotationPlacementInput = {
  anchorRect: AnnotationRect;
  floatingSize: { width: number; height: number };
  viewport: { width: number; height: number };
  panels?: AnnotationRect[];
  existing?: AnnotationRect[];
  desiredSide?: AnnotationPlacementSide;
};

export type AnnotationPlacementDecision = {
  x: number;
  y: number;
  width: number;
  height: number;
  side: AnnotationPlacementSide;
  strategy: "anchored" | "mobile-side-panel";
  clamped: boolean;
  overlapsPanel: boolean;
  overlapsExisting: boolean;
  connector: {
    visible: boolean;
    from: { x: number; y: number };
    to: { x: number; y: number };
  };
};

type SelectorInput = {
  selector: string;
  tag: string;
  idAttr?: string;
  text?: string;
  attributes: Record<string, string>;
  a11y: AnnotationA11y;
  transport: AnnotationTransportProvenance;
};

type CanvasBindingIdentity = {
  binding: CanvasBinding | null;
  selector: string | null;
  sourceKind: string | null;
  framework: string | null;
  adapter: string | null;
  plugin: string | null;
};

const ANNOTATION_COMPACT_SCHEMA_VERSION = 2;
const COMPACT_BYTE_BUDGET = 24 * 1024;
const TEXT_LIMIT = 240;
const NOTE_LIMIT = 600;
const PLACEMENT_MARGIN = 8;
const PLACEMENT_GAP = 12;
const MOBILE_PLACEMENT_MAX_WIDTH = 480;
const COLLISION_PENALTY = 10_000;
const CLAMP_PENALTY = 500;
const SIDE_ORDER_PENALTY = 1_000;
const PLACEMENT_GRID_STEP = 72;
const EXISTING_SIDE_BLOCK_RATIO = 0.25;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const truncateText = (value: string | undefined, limit: number): { value?: string; truncated: boolean } => {
  if (!value) {
    return { truncated: false };
  }
  if (value.length <= limit) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, limit), truncated: true };
};

const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const escapeSelectorValue = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");

const formatCanvasUrl = (documentId: string, page: CanvasPage): string => {
  const safePath = page.path && page.path.trim().length > 0 ? page.path : page.id;
  return `canvas://${documentId}${safePath.startsWith("/") ? safePath : `/${safePath}`}`;
};

const readCanvasNodeText = (node: CanvasNode): string | undefined => {
  const raw = node.props.text ?? node.metadata.text ?? node.name;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const text = typeof raw === "string" ? raw.trim() : String(raw).trim();
  return text.length > 0 ? text.slice(0, TEXT_LIMIT) : undefined;
};

const formatCanvasStyleValue = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}px`;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return undefined;
};

const buildCanvasStyles = (node: CanvasNode): AnnotationStyle => {
  const style = isRecord(node.style) ? node.style : {};
  return {
    color: formatCanvasStyleValue(style.color),
    backgroundColor: formatCanvasStyleValue(style.backgroundColor),
    fontSize: formatCanvasStyleValue(style.fontSize),
    fontFamily: formatCanvasStyleValue(style.fontFamily),
    fontWeight: formatCanvasStyleValue(style.fontWeight),
    lineHeight: formatCanvasStyleValue(style.lineHeight),
    display: formatCanvasStyleValue(style.display),
    position: formatCanvasStyleValue(style.position ?? "absolute")
  };
};

const buildCanvasAttributes = (node: CanvasNode, identity: CanvasBindingIdentity | null): Record<string, string> => {
  const propsAttributes = isRecord(node.props.attributes) ? node.props.attributes : {};
  const result: Record<string, string> = {
    "data-node-id": node.id,
    "data-canvas-kind": node.kind
  };
  if (identity?.binding) {
    result["data-canvas-binding-id"] = identity.binding.id;
  }
  if (identity?.binding?.componentName) {
    result["data-component-name"] = identity.binding.componentName;
  }
  for (const [key, value] of Object.entries(propsAttributes)) {
    const next = readString(value);
    if (next) {
      result[key] = next;
    }
  }
  const tagName = readString(node.props.tagName);
  if (tagName) {
    result["data-tag-name"] = tagName;
  }
  return result;
};

const resolveCanvasTag = (node: CanvasNode): string => {
  return readString(node.props.tagName)?.toLowerCase()
    ?? readString(isRecord(node.metadata.codeSync) ? node.metadata.codeSync.tagName : null)?.toLowerCase()
    ?? node.kind;
};

const resolveCanvasBindingIdentity = (document: CanvasDocument, node: CanvasNode): CanvasBindingIdentity | null => {
  const bindingId = readString(node.bindingRefs.primary);
  const binding = bindingId ? document.bindings.find((entry) => entry.id === bindingId) ?? null : null;
  if (!binding) {
    return null;
  }
  const metadata = isRecord(binding.metadata) ? binding.metadata : {};
  return {
    binding,
    selector: readString(binding.selector) ?? readString(metadata.selector),
    sourceKind: readString(metadata.sourceKind),
    framework: readString(metadata.framework),
    adapter: readString(metadata.adapter),
    plugin: readString(metadata.plugin)
  };
};

const candidate = (input: AnnotationSelectorCandidate): AnnotationSelectorCandidate => input;

const unavailableCandidate = (
  family: AnnotationSelectorCandidate["family"],
  rank: number,
  reason: string,
  transport: AnnotationTransportProvenance,
  recoveryHint: string
): AnnotationSelectorCandidate => candidate({
  family,
  rank,
  confidence: "low",
  scope: family === "text" ? "text" : family === "shadowChain" ? "shadow" : "document",
  transport,
  availability: "unavailable",
  unavailableReason: reason,
  recoveryHint
});

const testIdSelector = (attributes: Record<string, string>): string | null => {
  for (const key of ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy"]) {
    const value = readString(attributes[key]);
    if (value) {
      return `[${key}="${escapeSelectorValue(value)}"]`;
    }
  }
  return null;
};

const ariaSelector = (a11y: AnnotationA11y): string | null => {
  const role = readString(a11y.role);
  const name = readString(a11y.label ?? a11y.labelledBy ?? a11y.describedBy);
  if (!role || !name) {
    return null;
  }
  return `role=${role}[name="${escapeSelectorValue(name)}"]`;
};

const xpathSelector = (input: Pick<SelectorInput, "idAttr" | "tag" | "text">): string | null => {
  const id = readString(input.idAttr);
  if (id) {
    return `//*[@id="${escapeSelectorValue(id)}"]`;
  }
  const text = readString(input.text);
  if (text) {
    return `//${input.tag}[normalize-space()="${escapeSelectorValue(text.slice(0, 80))}"]`;
  }
  return null;
};

const buildSelectorBundle = (input: SelectorInput): AnnotationSelectorBundle => {
  const testSelector = testIdSelector(input.attributes);
  const aria = ariaSelector(input.a11y);
  const shadow = readString(input.attributes["data-shadow-chain"]);
  const xpath = xpathSelector(input);
  const text = readString(input.text);
  const candidates: AnnotationSelectorCandidate[] = [
    unavailableCandidate("backendNodeId", 10, "requires_cdp_capture", input.transport, "Use CDP capture for same-session backend node recovery."),
    unavailableCandidate("frameId", 20, "requires_cdp_capture", input.transport, "Use CDP capture for frame-scoped recovery."),
    testSelector
      ? candidate({ family: "testId", rank: 30, confidence: "high", scope: "document", transport: input.transport, availability: "available", value: testSelector })
      : unavailableCandidate("testId", 30, "missing_test_id", input.transport, "Add a stable data-testid or data-test-id."),
    aria
      ? candidate({ family: "aria", rank: 40, confidence: "high", scope: "document", transport: input.transport, availability: "available", value: aria })
      : unavailableCandidate("aria", 40, "missing_aria_role_or_name", input.transport, "Expose a stable role and accessible name."),
    candidate({ family: "css", rank: 50, confidence: "medium", scope: "document", transport: input.transport, availability: "available", value: input.selector }),
    shadow
      ? candidate({ family: "shadowChain", rank: 60, confidence: "medium", scope: "shadow", transport: input.transport, availability: "available", value: shadow })
      : unavailableCandidate("shadowChain", 60, "not_in_shadow_tree", input.transport, "Capture a shadow host chain when the target is inside shadow DOM."),
    xpath
      ? candidate({ family: "xpath", rank: 70, confidence: "low", scope: "document", transport: input.transport, availability: "available", value: xpath })
      : unavailableCandidate("xpath", 70, "insufficient_xpath_facts", input.transport, "Provide id or bounded text for XPath fallback."),
    text
      ? candidate({ family: "text", rank: 80, confidence: "low", scope: "text", transport: input.transport, availability: "available", value: `text=${text.slice(0, 80)}` })
      : unavailableCandidate("text", 80, "missing_text", input.transport, "Use text only as the last fallback.")
  ];
  return {
    primary: input.selector,
    transport: input.transport,
    candidates,
    recoveryHints: candidates.filter((entry) => entry.availability === "unavailable").flatMap((entry) => entry.recoveryHint ? [entry.recoveryHint] : [])
  };
};

const identityFromItem = (item: AnnotationItem): AnnotationTargetIdentity => {
  if (item.identity) {
    return item.identity;
  }
  const explicit = testIdSelector(item.attributes) ?? readString(item.idAttr);
  if (explicit) {
    return { source: "explicitData", priority: 10, stableId: explicit, label: item.text ?? item.selector };
  }
  if (item.tag.includes("-")) {
    return { source: "customElement", priority: 30, stableId: item.selector, label: item.text, customElement: { tag: item.tag } };
  }
  const aria = ariaSelector(item.a11y);
  if (aria) {
    return { source: "accessibility", priority: 40, stableId: aria, label: item.a11y.label ?? item.text };
  }
  return { source: "selector", priority: 50, stableId: item.selector, label: item.text };
};

const compactItemFromAnnotation = (item: AnnotationItem): AnnotationCompactItem => {
  const text = truncateText(item.text, TEXT_LIMIT);
  const note = truncateText(item.note, NOTE_LIMIT);
  const selectorBundle = item.selectorBundle ?? buildSelectorBundle({
    selector: item.selector,
    tag: item.tag,
    idAttr: item.idAttr,
    text: text.value,
    attributes: item.attributes,
    a11y: item.a11y,
    transport: "extension"
  });
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
    identity: identityFromItem(item),
    selectorBundle,
    redaction: {
      removedFields: [
        ...(item.screenshotId ? ["screenshot_reference"] : []),
        ...(item.debug ? ["debug"] : []),
        ...(Object.keys(item.styles ?? {}).length > 0 ? ["styles"] : []),
        ...(Object.keys(item.attributes ?? {}).length > 0 ? ["attributes"] : [])
      ],
      truncatedFields: [
        ...(text.truncated ? ["text"] : []),
        ...(note.truncated ? ["note"] : [])
      ],
      screenshotBytesRemoved: Boolean(item.screenshotId),
      originalByteLength: byteLength(item),
      compactByteLength: 0
    }
  };
  compact.redaction.compactByteLength = byteLength(compact);
  return compact;
};

export function buildCompactAnnotationPayload(payload: AnnotationPayload): AnnotationCompactPayload {
  const items = payload.annotations.map(compactItemFromAnnotation);
  const compact: AnnotationCompactPayload = {
    schemaVersion: ANNOTATION_COMPACT_SCHEMA_VERSION,
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
      originalByteLength: byteLength(payload),
      compactByteLength: 0
    },
    items
  };
  compact.redaction.compactByteLength = byteLength(compact);
  return compact;
}

const annotationFromCompactItem = (item: AnnotationCompactItem): AnnotationItem => ({
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

export function sanitizeAnnotationPayloadForAgent(payload: AnnotationPayload): AnnotationPayload {
  const compact = buildCompactAnnotationPayload(payload);
  return {
    schemaVersion: ANNOTATION_COMPACT_SCHEMA_VERSION,
    url: payload.url,
    title: payload.title,
    timestamp: payload.timestamp,
    context: payload.context,
    screenshotMode: "none",
    annotations: compact.items.map(annotationFromCompactItem),
    compact
  };
}

export function stripAnnotationPayloadScreenshots(payload: AnnotationPayload): AnnotationPayload {
  return sanitizeAnnotationPayloadForAgent(payload);
}

export function filterAnnotationPayload(
  payload: AnnotationPayload,
  annotationIds: string[],
  options: { includeScreenshots?: boolean } = {}
): AnnotationPayload {
  const includeScreenshots = options.includeScreenshots ?? true;
  const wanted = new Set(annotationIds);
  const annotations = payload.annotations.filter((annotation) => wanted.has(annotation.id));
  const filtered: AnnotationPayload = {
    ...payload,
    annotations
  };
  if (!includeScreenshots) {
    return sanitizeAnnotationPayloadForAgent(filtered);
  }
  const screenshotIds = new Set(
    annotations
      .map((annotation) => annotation.screenshotId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  filtered.screenshots = payload.screenshots?.filter((screenshot) => screenshotIds.has(screenshot.id));
  filtered.compact = buildCompactAnnotationPayload(filtered);
  return filtered;
}

export function describeAnnotationItem(item: AnnotationItem): string {
  const selector = item.selector?.trim().length ? item.selector : item.tag;
  const label = item.note?.trim().length ? item.note.trim() : item.text?.trim();
  return label ? `${selector} - ${label}` : selector;
}

export function formatDispatchSourceLabel(source: AnnotationDispatchSource): string {
  switch (source) {
    case "annotate_item":
      return "annotation item";
    case "annotate_all":
      return "annotation payload";
    case "popup_item":
      return "popup annotation item";
    case "popup_all":
      return "popup annotation payload";
    case "canvas_item":
      return "canvas annotation item";
    case "canvas_all":
      return "canvas annotation payload";
    default:
      return "annotation payload";
  }
}

export function formatAnnotationDispatchReceipt(receipt: AgentInboxReceipt | null | undefined): string {
  if (!receipt) {
    return "Stored only; fetch with annotate --stored";
  }
  if (receipt.deliveryState === "delivered" || receipt.deliveryState === "consumed") {
    return "Delivered to agent";
  }
  return "Stored only; fetch with annotate --stored";
}

const buildCanvasIdentity = (
  document: CanvasDocument,
  page: CanvasPage,
  node: CanvasNode,
  bindingIdentity: CanvasBindingIdentity | null,
  selector: string
): AnnotationTargetIdentity => {
  if (bindingIdentity?.binding) {
    return {
      source: "canvasBinding",
      priority: 20,
      stableId: bindingIdentity.binding.id,
      label: bindingIdentity.binding.componentName ?? node.name,
      canvas: {
        documentId: document.documentId,
        pageId: page.id,
        nodeId: node.id,
        bindingId: bindingIdentity.binding.id,
        componentName: bindingIdentity.binding.componentName,
        sourceKind: bindingIdentity.sourceKind ?? undefined,
        framework: bindingIdentity.framework ?? undefined,
        adapter: bindingIdentity.adapter ?? undefined,
        plugin: bindingIdentity.plugin ?? undefined
      }
    };
  }
  return {
    source: "explicitData",
    priority: 10,
    stableId: node.id,
    label: node.name,
    canvas: {
      documentId: document.documentId,
      pageId: page.id,
      nodeId: node.id
    }
  };
};

const buildCanvasRegionIdentity = (document: CanvasDocument, page: CanvasPage, draft: Extract<CanvasAnnotationDraft, { kind: "region" }>): AnnotationTargetIdentity => ({
  source: "explicitData",
  priority: 10,
  stableId: draft.regionId,
  label: draft.label,
  canvas: {
    documentId: document.documentId,
    pageId: page.id,
    regionId: draft.regionId
  }
});

const buildCanvasSelectorBundle = (
  selector: string,
  tag: string,
  attributes: Record<string, string>,
  a11y: AnnotationA11y,
  text?: string
): AnnotationSelectorBundle => buildSelectorBundle({
  selector,
  tag,
  text,
  attributes,
  a11y,
  transport: "canvas"
});

export function buildCanvasAnnotationPayload(options: {
  document: CanvasDocument;
  page: CanvasPage;
  drafts: CanvasAnnotationDraft[];
  context?: string;
}): AnnotationPayload {
  const nodesById = new Map(options.page.nodes.map((node) => [node.id, node]));
  const annotations = options.drafts.flatMap<AnnotationItem>((draft) => {
    if (draft.kind === "region") {
      const selector = `[data-canvas-region="${draft.regionId}"]`;
      const attributes = {
        "data-canvas-region": draft.regionId,
        "data-canvas-kind": "region"
      };
      const identity = buildCanvasRegionIdentity(options.document, options.page, draft);
      const annotation: AnnotationItem = {
        id: draft.regionId,
        selector,
        tag: "canvas-region",
        idAttr: draft.regionId,
        classes: ["canvas-region"],
        text: readString(draft.label) ?? undefined,
        rect: { ...draft.rect },
        attributes,
        a11y: {},
        styles: { position: "absolute" },
        note: readString(draft.note) ?? undefined,
        identity,
        selectorBundle: buildCanvasSelectorBundle(selector, "canvas-region", attributes, {}, draft.label)
      };
      return [annotation];
    }
    const node = nodesById.get(draft.nodeId);
    if (!node) {
      return [];
    }
    const tag = resolveCanvasTag(node);
    const bindingIdentity = resolveCanvasBindingIdentity(options.document, node);
    const selector = bindingIdentity?.selector ?? `[data-node-id="${node.id}"]`;
    const attributes = buildCanvasAttributes(node, bindingIdentity);
    const text = readCanvasNodeText(node);
    const a11y = {
      role: readString(isRecord(node.metadata.accessibility) ? node.metadata.accessibility.role : null) ?? undefined,
      label: readString(isRecord(node.metadata.accessibility) ? node.metadata.accessibility.label : null) ?? undefined
    };
    const identity = buildCanvasIdentity(options.document, options.page, node, bindingIdentity, selector);
    const annotation: AnnotationItem = {
      id: node.id,
      selector,
      tag,
      idAttr: node.id,
      classes: [`canvas-node`, `canvas-${node.kind}`],
      text,
      rect: { ...node.rect },
      attributes,
      a11y,
      styles: buildCanvasStyles(node),
      note: readString(draft.note) ?? undefined,
      identity,
      selectorBundle: buildCanvasSelectorBundle(selector, tag, attributes, a11y, text)
    };
    return [annotation];
  });
  const payload: AnnotationPayload = {
    schemaVersion: ANNOTATION_COMPACT_SCHEMA_VERSION,
    url: formatCanvasUrl(options.document.documentId, options.page),
    title: `${options.document.title} • ${options.page.name}`,
    timestamp: new Date().toISOString(),
    context: options.context,
    screenshotMode: "none",
    annotations
  };
  payload.compact = buildCompactAnnotationPayload(payload);
  return payload;
}

const candidateSides = (desired: AnnotationPlacementSide): AnnotationPlacementSide[] => {
  const ordered: AnnotationPlacementSide[] = [desired, "right", "left", "bottom", "top"];
  return ordered.filter((side, index) => ordered.indexOf(side) === index);
};

const rectForSide = (
  anchor: AnnotationRect,
  size: { width: number; height: number },
  side: AnnotationPlacementSide
): AnnotationRect => {
  if (side === "right") {
    return { x: anchor.x + anchor.width + PLACEMENT_GAP, y: anchor.y + anchor.height / 2 - size.height / 2, width: size.width, height: size.height };
  }
  if (side === "left") {
    return { x: anchor.x - size.width - PLACEMENT_GAP, y: anchor.y + anchor.height / 2 - size.height / 2, width: size.width, height: size.height };
  }
  if (side === "top") {
    return { x: anchor.x + anchor.width / 2 - size.width / 2, y: anchor.y - size.height - PLACEMENT_GAP, width: size.width, height: size.height };
  }
  return { x: anchor.x + anchor.width / 2 - size.width / 2, y: anchor.y + anchor.height + PLACEMENT_GAP, width: size.width, height: size.height };
};

const clampRect = (rect: AnnotationRect, viewport: { width: number; height: number }): { rect: AnnotationRect; clamped: boolean } => {
  const maxX = Math.max(PLACEMENT_MARGIN, viewport.width - rect.width - PLACEMENT_MARGIN);
  const maxY = Math.max(PLACEMENT_MARGIN, viewport.height - rect.height - PLACEMENT_MARGIN);
  const x = Math.min(Math.max(rect.x, PLACEMENT_MARGIN), maxX);
  const y = Math.min(Math.max(rect.y, PLACEMENT_MARGIN), maxY);
  return { rect: { ...rect, x, y }, clamped: x !== rect.x || y !== rect.y };
};

const intersects = (left: AnnotationRect, right: AnnotationRect): boolean => {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
};

const intersectionArea = (left: AnnotationRect, right: AnnotationRect): number => {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
};

const hasDominantExistingOverlap = (rect: AnnotationRect, existing: AnnotationRect[] | undefined): boolean => {
  const area = rect.width * rect.height;
  return area > 0 && (existing ?? []).some((entry) => intersectionArea(rect, entry) / area >= EXISTING_SIDE_BLOCK_RATIO);
};

const center = (rect: AnnotationRect): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2
});

const distance = (left: AnnotationRect, right: AnnotationRect): number => {
  const a = center(left);
  const b = center(right);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
};

const connectorTarget = (rect: AnnotationRect, side: AnnotationPlacementSide): { x: number; y: number } => {
  if (side === "right") {
    return { x: rect.x, y: rect.y + rect.height / 2 };
  }
  if (side === "left") {
    return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
  if (side === "top") {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  }
  return { x: rect.x + rect.width / 2, y: rect.y };
};

const inferPlacementSide = (anchor: AnnotationRect, rect: AnnotationRect): AnnotationPlacementSide => {
  const anchorCenter = center(anchor);
  const rectCenter = center(rect);
  const deltaX = rectCenter.x - anchorCenter.x;
  const deltaY = rectCenter.y - anchorCenter.y;
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX >= 0 ? "right" : "left";
  }
  return deltaY >= 0 ? "bottom" : "top";
};

export function computeAnnotationPlacement(input: AnnotationPlacementInput): AnnotationPlacementDecision {
  if (input.viewport.width <= MOBILE_PLACEMENT_MAX_WIDTH) {
    const width = Math.max(0, input.viewport.width - PLACEMENT_MARGIN * 2);
    const height = input.floatingSize.height;
    const yMax = Math.max(PLACEMENT_MARGIN, input.viewport.height - height - PLACEMENT_MARGIN);
    const y = Math.min(Math.max(input.anchorRect.y + input.anchorRect.height + PLACEMENT_GAP, PLACEMENT_MARGIN), yMax);
    return {
      x: PLACEMENT_MARGIN,
      y,
      width,
      height,
      side: "bottom",
      strategy: "mobile-side-panel",
      clamped: true,
      overlapsPanel: false,
      overlapsExisting: false,
      connector: { visible: true, from: center(input.anchorRect), to: { x: width / 2 + PLACEMENT_MARGIN, y } }
    };
  }

  const desired = input.desiredSide ?? "right";
  const buildDecision = (rect: AnnotationRect, side: AnnotationPlacementSide, index: number) => {
    const clamped = clampRect(rect, input.viewport);
    const overlapsPanel = (input.panels ?? []).some((panel) => intersects(clamped.rect, panel));
    const overlapsExisting = (input.existing ?? []).some((entry) => intersects(clamped.rect, entry));
    const score = distance(input.anchorRect, clamped.rect)
      + (overlapsPanel ? COLLISION_PENALTY : 0)
      + (overlapsExisting ? COLLISION_PENALTY : 0)
      + (clamped.clamped ? CLAMP_PENALTY : 0)
      + index * SIDE_ORDER_PENALTY;
    return { side, ...clamped, overlapsPanel, overlapsExisting, score };
  };
  const anchoredDecisions = candidateSides(desired).map((side, index) => {
    const base = rectForSide(input.anchorRect, input.floatingSize, side);
    return buildDecision(base, side, index);
  }).sort((left, right) => left.score - right.score);

  const existingBlockedSides = new Set(anchoredDecisions
    .filter((entry) => hasDominantExistingOverlap(entry.rect, input.existing))
    .map((entry) => entry.side));
  const bestAnchored = anchoredDecisions.find((entry) => !entry.overlapsPanel && !entry.overlapsExisting);
  const best = bestAnchored ?? buildGridPlacement(input, desired, buildDecision, existingBlockedSides) ?? anchoredDecisions[0];
  if (!best) {
    throw new Error("Annotation placement failed.");
  }
  return {
    x: best.rect.x,
    y: best.rect.y,
    width: best.rect.width,
    height: best.rect.height,
    side: best.side,
    strategy: "anchored",
    clamped: best.clamped,
    overlapsPanel: best.overlapsPanel,
    overlapsExisting: best.overlapsExisting,
    connector: {
      visible: true,
      from: center(input.anchorRect),
      to: connectorTarget(best.rect, best.side)
    }
  };
}

function buildGridPlacement(
  input: AnnotationPlacementInput,
  desired: AnnotationPlacementSide,
  buildDecision: (rect: AnnotationRect, side: AnnotationPlacementSide, index: number) => {
    side: AnnotationPlacementSide;
    rect: AnnotationRect;
    clamped: boolean;
    overlapsPanel: boolean;
    overlapsExisting: boolean;
    score: number;
  },
  existingBlockedSides: Set<AnnotationPlacementSide>
): ReturnType<typeof buildDecision> | null {
  const width = input.floatingSize.width;
  const height = input.floatingSize.height;
  const maxX = Math.max(PLACEMENT_MARGIN, input.viewport.width - width - PLACEMENT_MARGIN);
  const maxY = Math.max(PLACEMENT_MARGIN, input.viewport.height - height - PLACEMENT_MARGIN);
  const sides = candidateSides(desired);
  const candidates: ReturnType<typeof buildDecision>[] = [];
  for (let y = PLACEMENT_MARGIN; y <= maxY; y += PLACEMENT_GRID_STEP) {
    for (let x = PLACEMENT_MARGIN; x <= maxX; x += PLACEMENT_GRID_STEP) {
      const rect = { x, y, width, height };
      const side = inferPlacementSide(input.anchorRect, rect);
      const sideIndex = side === desired ? sides.length : Math.max(sides.indexOf(side), 0);
      const decision = buildDecision(rect, side, sideIndex);
      const sidePenalty = existingBlockedSides.has(side) ? COLLISION_PENALTY : 0;
      if (!decision.overlapsPanel && !decision.overlapsExisting) {
        candidates.push({ ...decision, clamped: true, score: decision.score + sidePenalty });
      }
    }
  }
  return candidates.sort((left, right) => left.score - right.score)[0] ?? null;
}
