import type {
  AgentInboxReceipt,
  AnnotationDispatchSource,
  AnnotationPayload
} from "../relay/protocol";
import type { AgentInboxEntry, AgentInboxScopeRegistration } from "./agent-inbox-store";
import { AgentInboxStore } from "./agent-inbox-store";

export const AGENT_INBOX_SYSTEM_MARKER = "[opendevbrowser-agent-inbox]";
const AGENT_INBOX_MAX_ITEMS = 20;
const AGENT_INBOX_MAX_BYTES = 256 * 1024;

export type AgentInboxSystemInjection = {
  systemBlock: string;
  receiptIds: string[];
};

export class AgentInbox {
  private readonly store: AgentInboxStore;

  constructor(worktree: string, now?: () => number) {
    this.store = new AgentInboxStore(worktree, now);
  }

  registerScope(
    chatScopeKey: string,
    registration: Omit<AgentInboxScopeRegistration, "chatScopeKey" | "updatedAt"> = {}
  ): AgentInboxScopeRegistration {
    return this.store.registerScope(chatScopeKey, registration);
  }

  listActiveScopes(): AgentInboxScopeRegistration[] {
    return this.store.listActiveScopes();
  }

  enqueue(input: {
    payload: AnnotationPayload;
    source: AnnotationDispatchSource;
    label: string;
    explicitChatScopeKey?: string | null;
  }): AgentInboxReceipt {
    return this.store.enqueue(input).receipt;
  }

  peekScope(chatScopeKey: string): AgentInboxEntry[] {
    return selectEntriesForSystemBlock(this.store.peekScope(chatScopeKey));
  }

  consumeScope(chatScopeKey: string): AgentInboxEntry[] {
    const entries = this.peekScope(chatScopeKey);
    if (entries.length > 0) {
      this.store.consume(entries.map((entry) => entry.id));
    }
    return entries.map((entry) => ({
      ...entry,
      deliveryState: "consumed",
      receipt: {
        ...entry.receipt,
        deliveryState: "consumed",
        storedFallback: false
      }
    }));
  }

  acknowledge(receiptIds: string[]): void {
    this.store.consume(receiptIds);
  }

  latestPayload(): AnnotationPayload | null {
    return this.store.latestEntry()?.payloadSansScreenshots ?? null;
  }

  buildSystemInjection(chatScopeKey: string): AgentInboxSystemInjection | null {
    const selected = this.peekScope(chatScopeKey);
    if (selected.length === 0) {
      return null;
    }
    const receiptIds = selected.map((entry) => entry.id);
    const systemBlock = buildSystemBlock(selected);
    return { systemBlock, receiptIds };
  }
}

function selectEntriesForSystemBlock(entries: AgentInboxEntry[]): AgentInboxEntry[] {
  const selected: AgentInboxEntry[] = [];
  for (const entry of entries) {
    if (selected.length >= AGENT_INBOX_MAX_ITEMS) {
      break;
    }
    const candidate = [...selected, entry];
    if (Buffer.byteLength(buildSystemBlock(candidate), "utf-8") > AGENT_INBOX_MAX_BYTES) {
      if (selected.length === 0) {
        return [buildSummaryOnlyEntry(entry)];
      }
      break;
    }
    selected.push(entry);
  }
  return selected;
}

function buildSystemBlock(entries: AgentInboxEntry[]): string {
  return [
    AGENT_INBOX_SYSTEM_MARKER,
    "External annotation payloads were explicitly sent to this chat session from popup or canvas surfaces for the current worktree. Treat them as operator-provided context.",
    JSON.stringify({
      items: entries.map((entry) => ({
        receiptId: entry.receipt.receiptId,
        source: entry.source,
        label: entry.label,
        createdAt: entry.createdAt,
        itemCount: entry.itemCount,
        payload: entry.payloadSansScreenshots
      }))
    }, null, 2),
    AGENT_INBOX_SYSTEM_MARKER
  ].join("\n");
}

function buildSummaryOnlyEntry(entry: AgentInboxEntry): AgentInboxEntry {
  return {
    ...entry,
    payloadSansScreenshots: {
      url: entry.payloadSansScreenshots.url,
      title: entry.payloadSansScreenshots.title,
      timestamp: entry.payloadSansScreenshots.timestamp,
      context: entry.payloadSansScreenshots.context,
      screenshotMode: entry.payloadSansScreenshots.screenshotMode,
      annotations: []
    },
    receipt: {
      ...entry.receipt,
      reason: "payload_truncated"
    }
  };
}
