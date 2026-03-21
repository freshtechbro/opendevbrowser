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
    if (duplicate) {
      return duplicate;
    }

    const createdAt = new Date(this.now()).toISOString();
    const scopeResolution = this.resolveScope(input.explicitChatScopeKey);
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
      assetRefs: buildAssetRefs(input.payload),
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

function stripPayloadScreenshots(payload: AnnotationPayload): AnnotationPayload {
  return {
    ...payload,
    screenshotMode: "none",
    screenshots: undefined,
    annotations: payload.annotations.map((annotation) => {
      const { screenshotId: _screenshotId, ...rest } = annotation;
      return rest;
    })
  };
}

function buildAssetRefs(payload: AnnotationPayload): AgentInboxAssetRef[] {
  return (payload.screenshots ?? []).map((screenshot) => ({
    id: screenshot.id,
    kind: "screenshot",
    label: screenshot.label,
    metadata: {
      mime: screenshot.mime,
      width: screenshot.width ?? null,
      height: screenshot.height ?? null
    }
  }));
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
