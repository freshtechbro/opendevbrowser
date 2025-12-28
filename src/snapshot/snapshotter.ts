import type { CDPSession, Page } from "playwright-core";
import type { RefStore } from "./refs";

export type SnapshotResult = {
  snapshotId: string;
  url?: string;
  title?: string;
  content: string;
  truncated: boolean;
  nextCursor?: string;
  refCount: number;
  timingMs: number;
  warnings?: string[];
};

export class Snapshotter {
  private refStore: RefStore;

  constructor(refStore: RefStore) {
    this.refStore = refStore;
  }

  async snapshot(page: Page, targetId: string, options: {
    mode: SnapshotMode;
    maxChars: number;
    cursor?: string;
    mainFrameOnly?: boolean;
    maxNodes?: number;
  }): Promise<SnapshotResult> {
    const startTime = Date.now();
    const session = await page.context().newCDPSession(page);
    let snapshotData: {
      entries: Array<{ ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>;
      lines: string[];
      warnings: string[];
    };
    try {
      snapshotData = await buildSnapshot(session, options.mode, options.mainFrameOnly ?? true, options.maxNodes);
    } finally {
      await session.detach();
    }

    const snapshot = this.refStore.setSnapshot(targetId, snapshotData.entries);
    const formatted = snapshotData.lines;

    const startIndex = parseCursor(options.cursor);
    const { content, truncated, nextCursor } = paginate(formatted, startIndex, options.maxChars);

    const timingMs = Date.now() - startTime;
    let url: string | undefined;
    let title: string | undefined;

    try {
      url = page.url();
      title = await page.title();
    } catch (_err) {
      // Page may be closed or navigating; safely ignore and return undefined
      void _err;
      url = undefined;
      title = undefined;
    }

    return {
      snapshotId: snapshot.snapshotId,
      url,
      title,
      content,
      truncated,
      nextCursor,
      refCount: snapshot.count,
      timingMs,
      warnings: snapshotData.warnings
    };
  }
}

type SnapshotMode = "outline" | "actionables";

type AxValue = {
  type?: string;
  value?: unknown;
};

type AxProperty = {
  name: string;
  value?: AxValue;
};

type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue;
  chromeRole?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: AxProperty[];
  backendDOMNodeId?: number;
  frameId?: string;
};

const DEFAULT_MAX_AX_NODES = 1000;
const ACTIONABLE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "textarea",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "switch",
  "tab",
  "slider",
  "spinbutton",
  "treeitem"
]);
const SEMANTIC_ROLES = new Set([
  "heading",
  "article",
  "main",
  "navigation",
  "region",
  "section",
  "form",
  "list",
  "listitem",
  "paragraph",
  "img",
  "table",
  "row",
  "cell",
  "columnheader",
  "rowheader",
  "banner",
  "contentinfo",
  "complementary"
]);

export const selectorFunction = function(this: Element): string | null {
  if (!(this instanceof Element)) return null;
  const escape = (value: string): string => {
    if (typeof CSS !== "undefined" && CSS.escape) {
      return CSS.escape(value);
    }
    return String(value).replace(/([^\w-])/g, "\\$1");
  };
  // Prefer stable attributes first
  const testId = this.getAttribute("data-testid");
  if (testId) {
    return '[data-testid="' + escape(testId) + '"]';
  }
  const ariaLabel = this.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.length < 50) {
    return '[aria-label="' + escape(ariaLabel) + '"]';
  }
  const buildPathSelector = (start: Element): string => {
    const parts: string[] = [];
    let current: Element | null = start;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        selector += "#" + escape(current.id);
        parts.unshift(selector);
        break;
      }
      const parentEl: Element | null = current.parentElement;
      if (!parentEl) {
        parts.unshift(selector);
        break;
      }
      let index = 1;
      let sibling: Element | null = current;
      while (sibling && sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        index += 1;
      }
      selector += ":nth-child(" + index + ")";
      parts.unshift(selector);
      current = parentEl;
    }
    return parts.join(" > ");
  };
  // Fallback to path-based selector
  return buildPathSelector(this);
};
const SELECTOR_FUNCTION = selectorFunction.toString();

async function buildSnapshot(session: CDPSession, mode: SnapshotMode, mainFrameOnly: boolean = true, maxNodes?: number): Promise<{
  entries: Array<{
    ref: string;
    selector: string;
    backendNodeId: number;
    frameId?: string;
    role?: string;
    name?: string;
  }>;
  lines: string[];
  warnings: string[];
}> {
  await session.send("Accessibility.enable");
  await session.send("DOM.enable");
  const result = await session.send("Accessibility.getFullAXTree") as { nodes?: AxNode[] };
  const nodes = Array.isArray(result.nodes) ? result.nodes : [];
  const entries: Array<{
    ref: string;
    selector: string;
    backendNodeId: number;
    frameId?: string;
    role?: string;
    name?: string;
  }> = [];
  const lines: string[] = [];
  const warnings: string[] = [];
  const maxEntries = typeof maxNodes === "number" ? maxNodes : DEFAULT_MAX_AX_NODES;
  let skippedFrameCount = 0;

  for (const node of nodes) {
    if (entries.length >= maxEntries) break;
    if (node.ignored) continue;
    if (typeof node.backendDOMNodeId !== "number") continue;
    if (mainFrameOnly && node.frameId) {
      skippedFrameCount += 1;
      continue;
    }
    const role = extractValue(node.role) || extractValue(node.chromeRole);
    if (!role) continue;
    if (!shouldInclude(role, mode)) continue;

    const selector = await resolveSelector(session, node.backendDOMNodeId);
    if (!selector) continue;

    const ref = `r${entries.length + 1}`;
    const name = redactText(extractValue(node.name));
    const value = redactText(extractValue(node.value));
    const disabled = isTruthyProperty(node.properties, "disabled");
    const checked = isTruthyProperty(node.properties, "checked");

    entries.push({
      ref,
      selector,
      backendNodeId: node.backendDOMNodeId,
      frameId: node.frameId,
      role,
      name
    });

    lines.push(formatNode({
      ref,
      role,
      name,
      value,
      disabled,
      checked
    }));
  }

  if (mainFrameOnly && skippedFrameCount > 0) {
    warnings.push(`Skipped ${skippedFrameCount} iframe nodes; snapshot limited to main frame.`);
  }

  return { entries, lines, warnings };
}

async function resolveSelector(session: CDPSession, backendNodeId: number): Promise<string | null> {
  const resolved = await session.send("DOM.resolveNode", { backendNodeId }) as { object?: { objectId?: string } };
  const objectId = resolved.object?.objectId;
  if (!objectId) return null;
  const result = await session.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: SELECTOR_FUNCTION,
    returnByValue: true
  }) as { result?: { value?: unknown } };
  const selector = result.result?.value;
  if (typeof selector !== "string" || selector.trim().length === 0) {
    return null;
  }
  return selector;
}

function shouldInclude(role: string, mode: SnapshotMode): boolean {
  const normalized = role.toLowerCase();
  if (ACTIONABLE_ROLES.has(normalized)) return true;
  if (mode === "actionables") return false;
  return SEMANTIC_ROLES.has(normalized);
}

function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function paginate(lines: string[], startIndex: number, maxChars: number): {
  content: string;
  truncated: boolean;
  nextCursor?: string;
} {
  let total = 0;
  const parts: string[] = [];
  let idx = startIndex;

  while (idx < lines.length) {
    const line = lines[idx];
    /* v8 ignore next -- @preserve */
    if (line === undefined) {
      break;
    }
    if (total + line.length + 1 > maxChars && parts.length > 0) {
      break;
    }
    parts.push(line);
    total += line.length + 1;
    idx += 1;
  }

  const truncated = idx < lines.length;
  const nextCursor = truncated ? String(idx) : undefined;
  return {
    content: parts.join("\n"),
    truncated,
    nextCursor
  };
}

function formatNode(node: {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
}): string {
  const name = redactText(node.name || "");
  const value = redactText(node.value || "");
  const parts: string[] = [];
  parts.push(`[${node.ref}]`);
  parts.push(node.role);

  if (node.disabled) {
    parts.push("disabled");
  }

  if (node.checked) {
    parts.push("checked");
  }

  if (name) {
    parts.push(`\"${name}\"`);
  }

  if (value) {
    parts.push(`value=\"${value}\"`);
  }

  return parts.join(" ");
}

function redactText(text?: string): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "";

  return trimmed.replace(/[A-Za-z0-9+/_-]{24,}/g, "[redacted]");
}

function extractValue(value?: AxValue): string {
  if (!value || typeof value.value === "undefined" || value.value === null) return "";
  if (typeof value.value === "string") return value.value;
  if (typeof value.value === "number" || typeof value.value === "boolean") {
    return String(value.value);
  }
  return "";
}

function isTruthyProperty(properties: AxProperty[] | undefined, name: string): boolean {
  if (!properties) return false;
  const found = properties.find((prop) => prop.name === name);
  if (!found || !found.value) return false;
  const value = found.value.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  if (typeof value === "number") return value !== 0;
  return false;
}
