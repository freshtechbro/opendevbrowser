import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import type {
  AgentInboxDeliveryState,
  AgentInboxReceipt,
  AnnotationDispatchSource,
  AnnotationPayload
} from "../relay/protocol";
import { writeFileAtomic } from "../utils/fs";

const AGENT_INBOX_DIR = ".opendevbrowser/annotate";
const AGENT_INBOX_FILE = "agent-inbox.jsonl";
const AGENT_SCOPE_FILE = "agent-scopes.json";
const AGENT_INBOX_RETENTION_LIMIT = 200;
const AGENT_INBOX_UNREAD_LIMIT = 50;
const AGENT_INBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AGENT_INBOX_DUPLICATE_WINDOW_MS = 60 * 1000;
const AGENT_SCOPE_TTL_MS = 10 * 60 * 1000;
const AGENT_COMPACT_BYTE_BUDGET = 24 * 1024;

export type AgentInboxAssetRef = {
  id: string;
  kind: "screenshot";
  label?: string | null;
  metadata: Record<string, unknown>;
};

export type AgentInboxScopeRegistration = {
  chatScopeKey: string;
  updatedAt: string;
  messageId?: string | null;
  agent?: string | null;
  model?: {
    providerID: string;
    modelID: string;
  } | null;
  variant?: string | null;
};

export type AgentInboxEntry = {
  id: string;
  worktree: string;
  chatScopeKey: string | null;
  source: AnnotationDispatchSource;
  label: string;
  createdAt: string;
  deliveryState: AgentInboxDeliveryState;
  payloadSansScreenshots: AnnotationPayload;
  assetRefs: AgentInboxAssetRef[];
  payloadHash: string;
  itemCount: number;
  byteLength: number;
  receipt: AgentInboxReceipt;
};

type AgentInboxScopeFile = {
  scopes: AgentInboxScopeRegistration[];
};

type EnqueueInput = {
  payload: AnnotationPayload;
  source: AnnotationDispatchSource;
  label: string;
  explicitChatScopeKey?: string | null;
};

type ScopeResolution = {
  chatScopeKey: string | null;
  reason?: string;
};

export class AgentInboxStore {
  private readonly worktree: string;
  private readonly now: () => number;

  constructor(worktree: string, now: () => number = () => Date.now()) {
    this.worktree = worktree;
    this.now = now;
  }

  registerScope(
    chatScopeKey: string,
    registration: Omit<AgentInboxScopeRegistration, "chatScopeKey" | "updatedAt"> = {}
  ): AgentInboxScopeRegistration {
    const trimmed = chatScopeKey.trim();
    if (!trimmed) {
      throw new Error("chatScopeKey is required");
    }
    const scopes = this.readScopes().filter((entry) => entry.chatScopeKey !== trimmed);
    const next: AgentInboxScopeRegistration = {
      chatScopeKey: trimmed,
      updatedAt: new Date(this.now()).toISOString(),
      messageId: registration.messageId ?? null,
      agent: registration.agent ?? null,
      model: registration.model ?? null,
      variant: registration.variant ?? null
    };
    scopes.push(next);
    this.writeScopes(scopes);
    return next;
  }

  listActiveScopes(): AgentInboxScopeRegistration[] {
    return this.readScopes();
  }

  enqueue(input: EnqueueInput): AgentInboxEntry {
    const entries = this.readEntries();
    const sanitizedPayload = stripPayloadScreenshots(input.payload);
    const payloadJson = JSON.stringify(sanitizedPayload);
    const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
    const normalizedLabel = input.label.trim() || formatDispatchLabel(input.source);
    const duplicate = findDuplicateEntry(
      entries,
      {
        payloadHash,
        source: input.source,
        label: normalizedLabel
      },
      this.now()
    );
    const scopeResolution = this.resolveScope(input.explicitChatScopeKey);
    if (duplicate) {
      const upgraded = upgradeStoredOnlyDuplicate(entries, duplicate, scopeResolution, this.now());
      if (upgraded) {
        this.writeEntries(entries);
        return upgraded;
      }
      return duplicate;
    }

    const createdAt = new Date(this.now()).toISOString();
    const deliveryState: AgentInboxDeliveryState = scopeResolution.chatScopeKey ? "delivered" : "stored_only";
    const entryId = `agent_inbox_${randomUUID()}`;
    const receipt: AgentInboxReceipt = {
      receiptId: entryId,
      deliveryState,
      storedFallback: deliveryState !== "delivered",
      reason: scopeResolution.reason,
      chatScopeKey: scopeResolution.chatScopeKey,
      createdAt,
      itemCount: sanitizedPayload.annotations.length,
      byteLength: Buffer.byteLength(payloadJson, "utf-8"),
      source: input.source,
      label: normalizedLabel
    };
    const entry: AgentInboxEntry = {
      id: entryId,
      worktree: this.worktree,
      chatScopeKey: scopeResolution.chatScopeKey,
      source: input.source,
      label: normalizedLabel,
      createdAt,
      deliveryState,
      payloadSansScreenshots: sanitizedPayload,
      assetRefs: [],
      payloadHash,
      itemCount: sanitizedPayload.annotations.length,
      byteLength: receipt.byteLength,
      receipt
    };
    entries.push(entry);
    this.writeEntries(entries);
    return entry;
  }

  peekScope(chatScopeKey: string): AgentInboxEntry[] {
    const trimmed = chatScopeKey.trim();
    if (!trimmed) {
      return [];
    }
    return this.readEntries().filter((entry) =>
      entry.chatScopeKey === trimmed && entry.deliveryState === "delivered"
    );
  }

  latestEntry(): AgentInboxEntry | null {
    const entries = this.readEntries();
    return entries.length > 0 ? entries[entries.length - 1] ?? null : null;
  }

  consume(receiptIds: string[]): void {
    if (receiptIds.length === 0) {
      return;
    }
    const targetIds = new Set(receiptIds);
    const entries = this.readEntries().map((entry) => {
      if (!targetIds.has(entry.id)) {
        return entry;
      }
      const deliveryState: AgentInboxDeliveryState = "consumed";
      return {
        ...entry,
        deliveryState,
        receipt: {
          ...entry.receipt,
          deliveryState,
          storedFallback: false
        }
      };
    });
    this.writeEntries(entries);
  }

  private resolveScope(explicitChatScopeKey?: string | null): ScopeResolution {
    const trimmed = explicitChatScopeKey?.trim();
    if (trimmed) {
      return { chatScopeKey: trimmed };
    }
    const scopes = this.readScopes();
    if (scopes.length === 1) {
      return { chatScopeKey: scopes[0]?.chatScopeKey ?? null };
    }
    if (scopes.length > 1) {
      return { chatScopeKey: null, reason: "ambiguous_scope" };
    }
    return { chatScopeKey: null, reason: "no_active_scope" };
  }

  private readEntries(): AgentInboxEntry[] {
    const filePath = join(this.ensureInboxDir(), AGENT_INBOX_FILE);
    if (!existsSync(filePath)) {
      return [];
    }
    const raw = readFileSync(filePath, "utf-8");
    const parsed = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as AgentInboxEntry;
          return isAgentInboxEntry(value) ? [value] : [];
        } catch {
          return [];
        }
      });
    return pruneEntries(parsed, this.now());
  }

  private writeEntries(entries: AgentInboxEntry[]): void {
    const filePath = join(this.ensureInboxDir(), AGENT_INBOX_FILE);
    const normalized = pruneEntries(entries, this.now());
    const content = normalized.map((entry) => JSON.stringify(entry)).join("\n");
    writeFileAtomic(filePath, content.length > 0 ? `${content}\n` : "", { mode: 0o600 });
  }

  private readScopes(): AgentInboxScopeRegistration[] {
    const filePath = join(this.ensureInboxDir(), AGENT_SCOPE_FILE);
    if (!existsSync(filePath)) {
      return [];
    }
    try {
      const value = JSON.parse(readFileSync(filePath, "utf-8")) as AgentInboxScopeFile;
      const scopes = Array.isArray(value.scopes) ? value.scopes.filter(isScopeRegistration) : [];
      return pruneScopes(scopes, this.now());
    } catch {
      return [];
    }
  }

  private writeScopes(scopes: AgentInboxScopeRegistration[]): void {
    const filePath = join(this.ensureInboxDir(), AGENT_SCOPE_FILE);
    const normalized = pruneScopes(scopes, this.now());
    writeFileAtomic(filePath, `${JSON.stringify({ scopes: normalized }, null, 2)}\n`, { mode: 0o600 });
  }

  private ensureInboxDir(): string {
    const dir = join(this.worktree, AGENT_INBOX_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
  }
}


const REDACTED_VALUE = "[redacted]";
const URL_SENSITIVE_KEYS = /(?:token|secret|password|pass|api[_-]?key|apikey|auth|authorization|bearer|session|cookie|email)/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const KEYED_SECRET_PATTERN = /\b(token|secret|password|api[_-]?key|apikey|authorization|bearer|session|cookie)\b\s*[:=]?\s*([A-Za-z0-9._~+/=-]{8,})/gi;
const PREFIXED_SECRET_PATTERN = /\b(?:sk|pk|ghp|gho|github_pat|xox[abprs]|AKIA)[A-Za-z0-9_-]{12,}\b/g;
const OPAQUE_SECRET_PATTERN = /\b(?=[A-Za-z0-9+/_-]{32,}={0,2}\b)(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{32,}={0,2}\b/g;

type CompactPayload = NonNullable<AnnotationPayload["compact"]>;
type CompactItem = CompactPayload["items"][number];
type CompactRedaction = CompactPayload["redaction"];

function createRedaction(originalByteLength: number, screenshotBytesRemoved: boolean): CompactRedaction {
  return {
    removedFields: [],
    truncatedFields: [],
    screenshotBytesRemoved,
    originalByteLength,
    compactByteLength: 0
  };
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function markRedacted(redaction: CompactRedaction, fieldPath: string): void {
  pushUnique(redaction.truncatedFields, `redacted:${fieldPath}`);
}

function hasSensitiveText(value: string): boolean {
  return new RegExp(EMAIL_PATTERN).test(value)
    || new RegExp(JWT_PATTERN).test(value)
    || new RegExp(KEYED_SECRET_PATTERN).test(value)
    || new RegExp(PREFIXED_SECRET_PATTERN).test(value)
    || new RegExp(OPAQUE_SECRET_PATTERN).test(value);
}

function redactSensitiveUrl(value: string, redaction: CompactRedaction, fieldPath: string): string {
  try {
    const parsed = new URL(value);
    let changed = false;
    if (parsed.username) {
      parsed.username = REDACTED_VALUE;
      changed = true;
    }
    if (parsed.password) {
      parsed.password = REDACTED_VALUE;
      changed = true;
    }
    parsed.searchParams.forEach((paramValue, key) => {
      if (URL_SENSITIVE_KEYS.test(key) || hasSensitiveText(paramValue)) {
        parsed.searchParams.set(key, REDACTED_VALUE);
        changed = true;
      }
    });
    if (changed) {
      markRedacted(redaction, fieldPath);
      return parsed.toString();
    }
  } catch {
    return value;
  }
  return value;
}

function redactSensitiveString(value: string | undefined, redaction: CompactRedaction, fieldPath: string): string | undefined {
  if (!value) return undefined;
  const next = redactSensitiveUrl(value, redaction, fieldPath)
    .replace(EMAIL_PATTERN, REDACTED_VALUE)
    .replace(JWT_PATTERN, REDACTED_VALUE)
    .replace(KEYED_SECRET_PATTERN, (_match, key: string) => `${key}=${REDACTED_VALUE}`)
    .replace(PREFIXED_SECRET_PATTERN, REDACTED_VALUE)
    .replace(OPAQUE_SECRET_PATTERN, REDACTED_VALUE);
  if (next !== value) markRedacted(redaction, fieldPath);
  return next;
}

function redactA11y(a11y: AnnotationPayload["annotations"][number]["a11y"], redaction: CompactRedaction, prefix: string): AnnotationPayload["annotations"][number]["a11y"] {
  return {
    role: redactSensitiveString(a11y.role, redaction, `${prefix}.role`),
    label: redactSensitiveString(a11y.label, redaction, `${prefix}.label`),
    labelledBy: redactSensitiveString(a11y.labelledBy, redaction, `${prefix}.labelledBy`),
    describedBy: redactSensitiveString(a11y.describedBy, redaction, `${prefix}.describedBy`),
    hidden: a11y.hidden
  };
}

function redactSelectorBundle(bundle: CompactItem["selectorBundle"], redaction: CompactRedaction, prefix: string): CompactItem["selectorBundle"] {
  return {
    primary: redactSensitiveString(bundle.primary, redaction, `${prefix}.primary`) ?? REDACTED_VALUE,
    transport: bundle.transport,
    candidates: bundle.candidates.map((candidate, index) => ({
      ...candidate,
      value: redactSensitiveString(candidate.value, redaction, `${prefix}.candidates.${index}.value`)
    })),
    recoveryHints: bundle.recoveryHints.map((hint, index) => redactSensitiveString(hint, redaction, `${prefix}.recoveryHints.${index}`) ?? REDACTED_VALUE)
  };
}

function redactIdentity(identity: CompactItem["identity"], redaction: CompactRedaction, prefix: string): CompactItem["identity"] {
  return {
    ...identity,
    stableId: redactSensitiveString(identity.stableId, redaction, `${prefix}.stableId`) ?? REDACTED_VALUE,
    label: redactSensitiveString(identity.label, redaction, `${prefix}.label`),
    canvas: identity.canvas ? {
      ...identity.canvas,
      documentId: redactSensitiveString(identity.canvas.documentId, redaction, `${prefix}.canvas.documentId`),
      pageId: redactSensitiveString(identity.canvas.pageId, redaction, `${prefix}.canvas.pageId`),
      nodeId: redactSensitiveString(identity.canvas.nodeId, redaction, `${prefix}.canvas.nodeId`),
      regionId: redactSensitiveString(identity.canvas.regionId, redaction, `${prefix}.canvas.regionId`),
      bindingId: redactSensitiveString(identity.canvas.bindingId, redaction, `${prefix}.canvas.bindingId`),
      componentName: redactSensitiveString(identity.canvas.componentName, redaction, `${prefix}.canvas.componentName`)
    } : undefined
  };
}

function updateCompactByteLengths(compact: CompactPayload): CompactPayload {
  for (const item of compact.items) {
    item.redaction.compactByteLength = byteLength({ ...item, redaction: { ...item.redaction, compactByteLength: 0 } });
  }
  compact.redaction.compactByteLength = byteLength({ ...compact, redaction: { ...compact.redaction, compactByteLength: 0 } });
  return compact;
}

function trimStringField(holder: Record<string, unknown>, key: string, limit: number, redaction: CompactRedaction, fieldPath: string): void {
  const value = holder[key];
  if (typeof value === "string" && value.length > limit) {
    holder[key] = value.slice(0, limit);
    pushUnique(redaction.truncatedFields, fieldPath);
  }
}

function enforceCompactByteBudget(compact: CompactPayload): CompactPayload {
  updateCompactByteLengths(compact);
  if (compact.redaction.compactByteLength <= AGENT_COMPACT_BYTE_BUDGET) return compact;
  trimStringField(compact as unknown as Record<string, unknown>, "context", 240, compact.redaction, "context");
  trimStringField(compact as unknown as Record<string, unknown>, "title", 160, compact.redaction, "title");
  for (const item of compact.items) {
    trimStringField(item as unknown as Record<string, unknown>, "label", 120, item.redaction, "label");
    trimStringField(item as unknown as Record<string, unknown>, "note", 160, item.redaction, "note");
    trimStringField(item.target as unknown as Record<string, unknown>, "text", 120, item.redaction, "target.text");
    item.selectorBundle.candidates = item.selectorBundle.candidates.slice(0, 3);
  }
  updateCompactByteLengths(compact);
  while (compact.redaction.compactByteLength > AGENT_COMPACT_BYTE_BUDGET && compact.items.length > 1) {
    compact.items.pop();
    pushUnique(compact.redaction.removedFields, "annotations.overflow_items");
    updateCompactByteLengths(compact);
  }
  if (compact.redaction.compactByteLength > AGENT_COMPACT_BYTE_BUDGET && compact.items[0]) {
    const item = compact.items[0];
    item.note = undefined;
    item.target.text = undefined;
    item.target.a11y = undefined;
    item.selectorBundle.candidates = [];
    item.selectorBundle.recoveryHints = [];
    pushUnique(item.redaction.removedFields, "oversized_item_details");
    pushUnique(compact.redaction.removedFields, "annotations.oversized_item_details");
  }
  updateCompactByteLengths(compact);
  if (compact.redaction.compactByteLength > AGENT_COMPACT_BYTE_BUDGET) {
    compact.items = [];
    compact.context = undefined;
    compact.title = undefined;
    compact.url = REDACTED_VALUE;
    pushUnique(compact.redaction.removedFields, "annotations");
    pushUnique(compact.redaction.removedFields, "context");
    pushUnique(compact.redaction.removedFields, "title");
    pushUnique(compact.redaction.removedFields, "url");
  }
  return updateCompactByteLengths(compact);
}

function upgradeStoredOnlyDuplicate(
  entries: AgentInboxEntry[],
  duplicate: AgentInboxEntry,
  scopeResolution: ScopeResolution,
  nowMs: number
): AgentInboxEntry | null {
  if (!scopeResolution.chatScopeKey || duplicate.deliveryState !== "stored_only") return null;
  const index = entries.findIndex((entry) => entry.id === duplicate.id);
  if (index < 0) return null;
  const deliveryState: AgentInboxDeliveryState = "delivered";
  const upgraded: AgentInboxEntry = {
    ...duplicate,
    chatScopeKey: scopeResolution.chatScopeKey,
    deliveryState,
    receipt: {
      ...duplicate.receipt,
      deliveryState,
      storedFallback: false,
      reason: undefined,
      chatScopeKey: scopeResolution.chatScopeKey,
      createdAt: new Date(nowMs).toISOString()
    }
  };
  entries[index] = upgraded;
  return upgraded;
}

function stripPayloadScreenshots(payload: AnnotationPayload): AnnotationPayload {
  const payloadRedaction = createRedaction(byteLength(payload), Boolean(payload.screenshots?.length));
  const annotations = payload.annotations.map((annotation) => {
    const annotationRedaction = createRedaction(byteLength(annotation), Boolean(annotation.screenshotId));
    const { screenshotId: _screenshotId, debug: _debug, styles: _styles, attributes: _attributes, ...rest } = annotation;
    return {
      ...rest,
      selector: redactSensitiveString(rest.selector, annotationRedaction, "selector") ?? "[redacted]",
      idAttr: redactSensitiveString(rest.idAttr, annotationRedaction, "idAttr"),
      classes: rest.classes?.map((value, index) => redactSensitiveString(value, annotationRedaction, `classes.${index}`) ?? "[redacted]"),
      text: redactSensitiveString(rest.text, annotationRedaction, "text"),
      note: redactSensitiveString(rest.note, annotationRedaction, "note"),
      a11y: redactA11y(rest.a11y, annotationRedaction, "a11y"),
      identity: rest.identity ? redactIdentity(rest.identity, annotationRedaction, "identity") : undefined,
      selectorBundle: rest.selectorBundle ? redactSelectorBundle(rest.selectorBundle, annotationRedaction, "selectorBundle") : undefined,
      attributes: {},
      styles: {}
    };
  });
  const sanitized: AnnotationPayload = {
    schemaVersion: 2,
    url: redactSensitiveString(payload.url, payloadRedaction, "url") ?? "[redacted]",
    title: redactSensitiveString(payload.title, payloadRedaction, "title"),
    timestamp: payload.timestamp,
    context: redactSensitiveString(payload.context, payloadRedaction, "context"),
    screenshotMode: "none",
    annotations
  };
  return {
    ...sanitized,
    compact: enforceCompactByteBudget(buildCanonicalCompactPayload(sanitized, payload))
  };
}

function buildCanonicalCompactPayload(
  sanitized: AnnotationPayload,
  original: AnnotationPayload
): NonNullable<AnnotationPayload["compact"]> {
  const items: NonNullable<AnnotationPayload["compact"]>["items"] = sanitized.annotations.map((annotation, index) => {
    const originalAnnotation = original.annotations[index];
    const originalByteLength = byteLength(originalAnnotation ?? annotation);
    return {
      id: annotation.id,
      label: annotation.note ?? annotation.text ?? annotation.selector,
      text: annotation.text,
      note: annotation.note,
      target: {
        tag: annotation.tag,
        selector: annotation.selector,
        rect: annotation.rect,
        text: annotation.text,
        a11y: annotation.a11y
      },
      identity: annotation.identity ?? buildFallbackIdentity(annotation),
      selectorBundle: annotation.selectorBundle ?? buildFallbackSelectorBundle(annotation),
      redaction: {
        removedFields: buildAnnotationRemovedFields(originalAnnotation),
        truncatedFields: [],
        screenshotBytesRemoved: Boolean(originalAnnotation?.screenshotId),
        originalByteLength,
        compactByteLength: byteLength(annotation)
      }
    };
  });
  const compact: NonNullable<AnnotationPayload["compact"]> = {
    schemaVersion: 2,
    url: sanitized.url,
    title: sanitized.title,
    timestamp: sanitized.timestamp,
    context: sanitized.context,
    screenshotMode: "none",
    byteBudget: AGENT_COMPACT_BYTE_BUDGET,
    redaction: {
      removedFields: buildPayloadRemovedFields(original, items),
      truncatedFields: [],
      screenshotBytesRemoved: Boolean(original.screenshots?.length) || items.some((item) => item.redaction.screenshotBytesRemoved),
      originalByteLength: byteLength(original),
      compactByteLength: 0
    },
    items
  };
  return updateCompactByteLengths(compact);
}

function buildFallbackIdentity(annotation: AnnotationPayload["annotations"][number]): NonNullable<AnnotationPayload["compact"]>["items"][number]["identity"] {
  return {
    source: "selector",
    priority: 50,
    stableId: annotation.selector,
    label: annotation.text ?? annotation.note ?? annotation.selector
  };
}

function buildFallbackSelectorBundle(annotation: AnnotationPayload["annotations"][number]): NonNullable<AnnotationPayload["compact"]>["items"][number]["selectorBundle"] {
  return {
    primary: annotation.selector,
    transport: "unknown",
    candidates: [
      buildUnavailableSelector("backendNodeId", 10, "requires_cdp_capture"),
      buildUnavailableSelector("frameId", 20, "requires_cdp_capture"),
      buildUnavailableSelector("testId", 30, "missing_test_id"),
      buildUnavailableSelector("aria", 40, "missing_aria_role_or_name"),
      {
        family: "css",
        rank: 50,
        confidence: "medium",
        scope: "document",
        transport: "unknown",
        availability: "available",
        value: annotation.selector
      },
      buildUnavailableSelector("shadowChain", 60, "not_in_shadow_tree"),
      buildUnavailableSelector("xpath", 70, "insufficient_xpath_facts"),
      buildUnavailableSelector("text", 80, annotation.text ? "text_is_weak_fallback" : "missing_text")
    ],
    recoveryHints: ["Use the CSS selector as fallback when richer selector metadata is unavailable."]
  };
}

function buildUnavailableSelector(
  family: NonNullable<AnnotationPayload["compact"]>["items"][number]["selectorBundle"]["candidates"][number]["family"],
  rank: number,
  unavailableReason: string
): NonNullable<AnnotationPayload["compact"]>["items"][number]["selectorBundle"]["candidates"][number] {
  return {
    family,
    rank,
    confidence: "low",
    scope: family === "text" ? "text" : family === "shadowChain" ? "shadow" : "document",
    transport: "unknown",
    availability: "unavailable",
    unavailableReason
  };
}

function buildAnnotationRemovedFields(annotation: AnnotationPayload["annotations"][number] | undefined): string[] {
  if (!annotation) {
    return [];
  }
  return [
    ...(annotation.screenshotId ? ["screenshot_reference"] : []),
    ...(annotation.debug ? ["debug"] : []),
    ...(Object.keys(annotation.styles ?? {}).length > 0 ? ["styles"] : []),
    ...(Object.keys(annotation.attributes ?? {}).length > 0 ? ["attributes"] : [])
  ];
}

function buildPayloadRemovedFields(
  original: AnnotationPayload,
  items: NonNullable<AnnotationPayload["compact"]>["items"]
): string[] {
  return [
    ...(original.screenshots?.length ? ["screenshots"] : []),
    ...items.flatMap((item) => item.redaction.removedFields.map((field) => `annotations.${field}`))
  ];
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf-8");
}

function findDuplicateEntry(
  entries: AgentInboxEntry[],
  matcher: { payloadHash: string; source: AnnotationDispatchSource; label: string },
  nowMs: number
): AgentInboxEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    if (
      entry.payloadHash === matcher.payloadHash
      && entry.source === matcher.source
      && entry.label === matcher.label
      && nowMs - Date.parse(entry.createdAt) <= AGENT_INBOX_DUPLICATE_WINDOW_MS
    ) {
      return entry;
    }
  }
  return null;
}

function pruneEntries(entries: AgentInboxEntry[], nowMs: number): AgentInboxEntry[] {
  const unexpired = entries
    .filter((entry) => Number.isFinite(Date.parse(entry.createdAt)))
    .filter((entry) => nowMs - Date.parse(entry.createdAt) <= AGENT_INBOX_TTL_MS)
    .sort(compareByTimeAndId);
  const unread = unexpired.filter((entry) => entry.deliveryState !== "consumed");
  const unreadKeep = new Set(unread.slice(-AGENT_INBOX_UNREAD_LIMIT).map((entry) => entry.id));
  const limitedUnread = unexpired.filter((entry) => entry.deliveryState === "consumed" || unreadKeep.has(entry.id));
  return limitedUnread.slice(-AGENT_INBOX_RETENTION_LIMIT);
}

function pruneScopes(scopes: AgentInboxScopeRegistration[], nowMs: number): AgentInboxScopeRegistration[] {
  return scopes
    .filter((scope) => typeof scope.chatScopeKey === "string" && scope.chatScopeKey.trim().length > 0)
    .filter((scope) => Number.isFinite(Date.parse(scope.updatedAt)))
    .filter((scope) => nowMs - Date.parse(scope.updatedAt) <= AGENT_SCOPE_TTL_MS)
    .sort(compareByTimeAndId);
}

function compareByTimeAndId(
  left: { createdAt?: string; updatedAt?: string; id?: string; chatScopeKey?: string | null },
  right: { createdAt?: string; updatedAt?: string; id?: string; chatScopeKey?: string | null }
): number {
  const leftTime = Date.parse(left.createdAt ?? left.updatedAt ?? "") || 0;
  const rightTime = Date.parse(right.createdAt ?? right.updatedAt ?? "") || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return (left.id ?? left.chatScopeKey ?? "").localeCompare(right.id ?? right.chatScopeKey ?? "");
}

function isAgentInboxEntry(value: unknown): value is AgentInboxEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.worktree === "string"
    && typeof record.label === "string"
    && typeof record.createdAt === "string"
    && isAnnotationPayload(record.payloadSansScreenshots)
    && typeof record.payloadHash === "string"
    && typeof record.itemCount === "number"
    && typeof record.byteLength === "number"
    && isAgentInboxReceipt(record.receipt);
}

function isScopeRegistration(value: unknown): value is AgentInboxScopeRegistration {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.chatScopeKey === "string" && typeof record.updatedAt === "string";
}

function isAgentInboxReceipt(value: unknown): value is AgentInboxReceipt {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.receiptId === "string"
    && typeof record.deliveryState === "string"
    && typeof record.storedFallback === "boolean"
    && typeof record.createdAt === "string"
    && typeof record.itemCount === "number"
    && typeof record.byteLength === "number"
    && typeof record.source === "string"
    && typeof record.label === "string";
}

function isAnnotationPayload(value: unknown): value is AnnotationPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.url === "string"
    && typeof record.timestamp === "string"
    && typeof record.screenshotMode === "string"
    && Array.isArray(record.annotations);
}

function formatDispatchLabel(source: AnnotationDispatchSource): string {
  switch (source) {
    case "popup_item":
      return "Popup annotation item";
    case "popup_all":
      return "Popup annotation payload";
    case "canvas_item":
      return "Canvas annotation item";
    case "canvas_all":
      return "Canvas annotation payload";
    case "annotate_item":
      return "Annotation item";
    case "annotate_all":
      return "Annotation payload";
    default:
      return "Annotation payload";
  }
}
