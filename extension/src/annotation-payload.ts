import type {
  AgentInboxReceipt,
  AnnotationItem,
  AnnotationPayload,
  AnnotationStyle,
  AnnotationDispatchSource
} from "./types.js";
import type { CanvasDocument, CanvasNode, CanvasPage, CanvasRect } from "./canvas/model.js";

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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;

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
  return text.length > 0 ? text.slice(0, 240) : undefined;
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

const buildCanvasAttributes = (node: CanvasNode): Record<string, string> => {
  const propsAttributes = isRecord(node.props.attributes) ? node.props.attributes : {};
  const result: Record<string, string> = {
    "data-node-id": node.id,
    "data-canvas-kind": node.kind
  };
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

export function stripAnnotationPayloadScreenshots(payload: AnnotationPayload): AnnotationPayload {
  const { screenshots, annotations, ...rest } = payload;
  void screenshots;
  return {
    ...rest,
    screenshotMode: "none",
    annotations: annotations.map((annotation) => {
      const { screenshotId, ...next } = annotation;
      void screenshotId;
      return next;
    })
  };
}

export function filterAnnotationPayload(
  payload: AnnotationPayload,
  annotationIds: string[],
  options: { includeScreenshots?: boolean } = {}
): AnnotationPayload {
  const includeScreenshots = options.includeScreenshots ?? true;
  const wanted = new Set(annotationIds);
  const annotations = payload.annotations.filter((annotation) => wanted.has(annotation.id));
  if (annotations.length === payload.annotations.length && includeScreenshots) {
    return payload;
  }
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
  if (includeScreenshots) {
    filtered.screenshots = payload.screenshots?.filter((screenshot) => screenshotIds.has(screenshot.id));
    return filtered;
  }
  delete filtered.screenshots;
  return filtered;
}

export function describeAnnotationItem(item: AnnotationItem): string {
  const selector = item.selector?.trim().length ? item.selector : item.tag;
  const label = item.note?.trim().length ? item.note.trim() : item.text?.trim();
  return label ? `${selector} — ${label}` : selector;
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

export function buildCanvasAnnotationPayload(options: {
  document: CanvasDocument;
  page: CanvasPage;
  drafts: CanvasAnnotationDraft[];
  context?: string;
}): AnnotationPayload {
  const nodesById = new Map(options.page.nodes.map((node) => [node.id, node]));
  const annotations = options.drafts.flatMap<AnnotationItem>((draft) => {
    if (draft.kind === "region") {
      const annotation: AnnotationItem = {
        id: draft.regionId,
        selector: `[data-canvas-region="${draft.regionId}"]`,
        tag: "canvas-region",
        idAttr: draft.regionId,
        classes: ["canvas-region"],
        text: readString(draft.label) ?? undefined,
        rect: {
          x: draft.rect.x,
          y: draft.rect.y,
          width: draft.rect.width,
          height: draft.rect.height
        },
        attributes: {
          "data-canvas-region": draft.regionId,
          "data-canvas-kind": "region"
        },
        a11y: {},
        styles: {
          position: "absolute"
        },
        note: readString(draft.note) ?? undefined
      };
      return [annotation];
    }
    const node = nodesById.get(draft.nodeId);
    if (!node) {
      return [];
    }
    const tag = resolveCanvasTag(node);
    const annotation: AnnotationItem = {
      id: node.id,
      selector: `[data-node-id="${node.id}"]`,
      tag,
      idAttr: node.id,
      classes: [`canvas-node`, `canvas-${node.kind}`],
      text: readCanvasNodeText(node),
      rect: {
        x: node.rect.x,
        y: node.rect.y,
        width: node.rect.width,
        height: node.rect.height
      },
      attributes: buildCanvasAttributes(node),
      a11y: {
        role: readString(isRecord(node.metadata.accessibility) ? node.metadata.accessibility.role : null) ?? undefined,
        label: readString(isRecord(node.metadata.accessibility) ? node.metadata.accessibility.label : null) ?? undefined
      },
      styles: buildCanvasStyles(node),
      note: readString(draft.note) ?? undefined
    };
    return [annotation];
  });
  return {
    url: formatCanvasUrl(options.document.documentId, options.page),
    title: `${options.document.title} • ${options.page.name}`,
    timestamp: new Date().toISOString(),
    context: options.context,
    screenshotMode: "none",
    annotations
  };
}
