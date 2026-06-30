import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_INBOX_SYSTEM_MARKER, AgentInbox } from "../src/annotate/agent-inbox";
import { AgentInboxStore } from "../src/annotate/agent-inbox-store";

const parseSystemItems = (block: string): Array<Record<string, unknown>> => {
  const lines = block.split("\n");
  expect(lines[0]).toBe(AGENT_INBOX_SYSTEM_MARKER);
  expect(lines.at(-1)).toBe(AGENT_INBOX_SYSTEM_MARKER);
  const payload = JSON.parse(lines.slice(2, -1).join("\n")) as { items?: Array<Record<string, unknown>> };
  return payload.items ?? [];
};

const createPayload = (overrides: Partial<Record<string, unknown>> = {}) => ({
  url: "https://example.com",
  title: "Example",
  timestamp: "2026-03-15T00:00:00.000Z",
  context: "Review the hero",
  screenshotMode: "visible" as const,
  screenshots: [{ id: "shot-1", label: "Hero", base64: "AAAA", mime: "image/png" as const }],
  annotations: [
    {
      id: "annotation-1",
      selector: "#hero",
      tag: "section",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      attributes: {},
      a11y: {},
      styles: {},
      screenshotId: "shot-1",
      note: "Hero spacing"
    }
  ],
  ...overrides
});

describe("AgentInbox", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("delivers scoped payloads, strips screenshots, and consumes them only after acknowledgement", () => {
    let now = Date.parse("2026-03-15T00:00:00.000Z");
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const inbox = new AgentInbox(root, () => now);

    inbox.registerScope("session-1", { agent: "codex" });
    const receipt = inbox.enqueue({
      payload: createPayload(),
      source: "popup_all",
      label: "Popup payload"
    });

    expect(receipt.deliveryState).toBe("delivered");
    expect(receipt.storedFallback).toBe(false);

    const latest = inbox.latestPayload();
    expect(latest?.screenshotMode).toBe("none");
    expect(latest?.screenshots).toBeUndefined();
    expect(latest?.annotations[0]).not.toHaveProperty("screenshotId");

    now += 1000;
    const injection = inbox.buildSystemInjection("session-1");
    expect(injection).not.toBeNull();
    expect(injection?.receiptIds).toHaveLength(1);

    const items = parseSystemItems(injection?.systemBlock ?? "");
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("Popup payload");
    expect((items[0]?.payload as { screenshotMode?: string }).screenshotMode).toBe("none");

    const entriesPath = join(root, ".opendevbrowser", "annotate", "agent-inbox.jsonl");
    const pendingEntry = JSON.parse(readFileSync(entriesPath, "utf8").trim()) as {
      deliveryState?: string;
      receipt?: { deliveryState?: string };
    };
    expect(pendingEntry.deliveryState).toBe("delivered");
    expect(pendingEntry.receipt?.deliveryState).toBe("delivered");

    inbox.acknowledge(injection?.receiptIds ?? []);
    expect(inbox.buildSystemInjection("session-1")).toBeNull();

    const storedEntry = JSON.parse(readFileSync(entriesPath, "utf8").trim()) as {
      deliveryState?: string;
      receipt?: { deliveryState?: string };
    };
    expect(storedEntry.deliveryState).toBe("consumed");
    expect(storedEntry.receipt?.deliveryState).toBe("consumed");
  });

  it("rebuilds compact metadata and blocks screenshot material from system injection", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const inbox = new AgentInbox(root, () => Date.parse("2026-03-15T00:30:00.000Z"));

    inbox.registerScope("session-redaction");
    inbox.enqueue({
      payload: createPayload({
        url: "https://example.com/path?token=sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
        title: "Secret owner person@example.com",
        context: "Context with apiKey=sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
        annotations: [
          {
            id: "annotation-1",
            selector: "[data-token=\"sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\"]",
            tag: "section",
            rect: { x: 0, y: 0, width: 320, height: 180 },
            attributes: { "data-testid": "secret-sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890" },
            a11y: { role: "region", label: "person@example.com" },
            styles: {},
            screenshotId: "shot-1",
            note: "Secret sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
          }
        ],
        compact: {
          schemaVersion: 2,
          screenshotMode: "none",
          screenshots: [{ id: "shot-1", base64: "AAAA" }],
          items: [{ id: "annotation-1", screenshotId: "shot-1", leaked: "AAAA" }]
        }
      }),
      source: "popup_all",
      label: "Malicious compact"
    });

    const injection = inbox.buildSystemInjection("session-redaction");
    expect(injection).not.toBeNull();
    const block = injection?.systemBlock ?? "";
    expect(block).toContain('"schemaVersion": 2');
    expect(block).toContain('"compact"');
    expect(block).not.toContain("AAAA");
    expect(block).not.toContain("shot-1");
    expect(block).not.toContain("screenshotId");
    expect(block).not.toContain("sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
    expect(block).not.toContain("person@example.com");
    expect(block).toContain("[redacted]");

    const entriesPath = join(root, ".opendevbrowser", "annotate", "agent-inbox.jsonl");
    const stored = readFileSync(entriesPath, "utf8");
    expect(stored).not.toContain("AAAA");
    expect(stored).not.toContain("shot-1");
    expect(stored).not.toContain("screenshotId");
    expect(stored).not.toContain("sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
    expect(stored).not.toContain("person@example.com");
  });

  it("rebuilds canonical compact metadata within byte budget for a huge url", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T00:45:00.000Z"));

    store.registerScope("session-huge-url");
    const entry = store.enqueue({
      payload: createPayload({
        url: `https://example.com/${"path/".repeat(8_000)}?token=sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`,
        screenshotMode: "none",
        screenshots: undefined
      }),
      source: "popup_all",
      label: "Huge URL payload"
    });

    const compact = entry.payloadSansScreenshots.compact;
    expect(compact).toBeDefined();
    expect(Buffer.byteLength(JSON.stringify(compact), "utf8")).toBeLessThanOrEqual(compact?.byteBudget ?? 0);
    expect(compact?.redaction.compactByteLength).toBeLessThanOrEqual(compact?.byteBudget ?? 0);
    expect(compact?.url).toBe("[redacted]");
    expect(compact?.redaction.removedFields).toContain("url");
  });

  it("degrades to stored_only for ambiguous scope and suppresses duplicates", () => {
    let now = Date.parse("2026-03-15T01:00:00.000Z");
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => now);

    store.registerScope("session-a");
    now += 1000;
    store.registerScope("session-b");

    const first = store.enqueue({
      payload: createPayload(),
      source: "canvas_all",
      label: "Canvas payload"
    });
    expect(first.receipt.deliveryState).toBe("stored_only");
    expect(first.receipt.reason).toBe("ambiguous_scope");

    now += 30_000;
    const duplicate = store.enqueue({
      payload: createPayload(),
      source: "canvas_all",
      label: "Canvas payload"
    });

    expect(duplicate.id).toBe(first.id);
    expect(store.latestEntry()?.id).toBe(first.id);
  });

  it("upgrades a stored-only duplicate to delivered when a concrete scope appears", () => {
    let now = Date.parse("2026-03-15T01:30:00.000Z");
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => now);

    const first = store.enqueue({
      payload: createPayload(),
      source: "canvas_all",
      label: "Retry payload"
    });
    expect(first.receipt.deliveryState).toBe("stored_only");
    expect(first.receipt.reason).toBe("no_active_scope");

    now += 30_000;
    store.registerScope("session-retry");
    const retry = store.enqueue({
      payload: createPayload(),
      source: "canvas_all",
      label: "Retry payload"
    });

    expect(retry.id).toBe(first.id);
    expect(retry.receipt.deliveryState).toBe("delivered");
    expect(retry.receipt.storedFallback).toBe(false);
    expect(retry.chatScopeKey).toBe("session-retry");
    expect(store.peekScope("session-retry").map((entry) => entry.id)).toEqual([first.id]);
  });

  it("prunes invalid and expired entries and scopes from disk", () => {
    const now = Date.parse("2026-03-15T02:00:00.000Z");
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => now);
    const annotateDir = join(root, ".opendevbrowser", "annotate");
    mkdirSync(annotateDir, { recursive: true });

    writeFileSync(join(annotateDir, "agent-scopes.json"), JSON.stringify({
      scopes: [
        123,
        { chatScopeKey: "active", updatedAt: new Date(now).toISOString() },
        { chatScopeKey: "expired", updatedAt: new Date(now - (11 * 60 * 1000)).toISOString() },
        { chatScopeKey: "", updatedAt: "not-a-date" }
      ]
    }));
    writeFileSync(join(annotateDir, "agent-inbox.jsonl"), [
      JSON.stringify(123),
      JSON.stringify({
        id: "entry-active",
        worktree: root,
        chatScopeKey: "active",
        source: "popup_all",
        label: "Active",
        createdAt: new Date(now).toISOString(),
        deliveryState: "delivered",
        payloadSansScreenshots: createPayload({ screenshotMode: "none", screenshots: undefined }),
        assetRefs: [],
        payloadHash: "hash-active",
        itemCount: 1,
        byteLength: 128,
        receipt: {
          receiptId: "entry-active",
          deliveryState: "delivered",
          storedFallback: false,
          createdAt: new Date(now).toISOString(),
          itemCount: 1,
          byteLength: 128,
          source: "popup_all",
          label: "Active"
        }
      }),
      JSON.stringify({
        id: "entry-expired",
        worktree: root,
        chatScopeKey: "expired",
        source: "popup_all",
        label: "Expired",
        createdAt: new Date(now - (8 * 24 * 60 * 60 * 1000)).toISOString(),
        deliveryState: "stored_only",
        payloadSansScreenshots: createPayload({ screenshotMode: "none", screenshots: undefined }),
        assetRefs: [],
        payloadHash: "hash-expired",
        itemCount: 1,
        byteLength: 128,
        receipt: {
          receiptId: "entry-expired",
          deliveryState: "stored_only",
          storedFallback: true,
          createdAt: new Date(now).toISOString(),
          itemCount: 1,
          byteLength: 128,
          source: "popup_all",
          label: "Expired"
        }
      }),
      JSON.stringify({
        id: "entry-bad-payload",
        worktree: root,
        chatScopeKey: "active",
        source: "popup_all",
        label: "Bad payload",
        createdAt: new Date(now).toISOString(),
        deliveryState: "delivered",
        payloadSansScreenshots: null,
        assetRefs: [],
        payloadHash: "hash-bad-payload",
        itemCount: 1,
        byteLength: 128,
        receipt: {
          receiptId: "entry-bad-payload",
          deliveryState: "delivered",
          storedFallback: false,
          createdAt: new Date(now).toISOString(),
          itemCount: 1,
          byteLength: 128,
          source: "popup_all",
          label: "Bad payload"
        }
      }),
      JSON.stringify({
        id: "entry-bad-receipt",
        worktree: root,
        chatScopeKey: "active",
        source: "popup_all",
        label: "Bad receipt",
        createdAt: new Date(now).toISOString(),
        deliveryState: "delivered",
        payloadSansScreenshots: createPayload({ screenshotMode: "none", screenshots: undefined }),
        assetRefs: [],
        payloadHash: "hash-bad-receipt",
        itemCount: 1,
        byteLength: 128,
        receipt: null
      }),
      "{bad-json}"
    ].join("\n"));

    expect(store.listActiveScopes().map((entry) => entry.chatScopeKey)).toEqual(["active"]);
    expect(store.latestEntry()?.id).toBe("entry-active");
  });

  it("truncates oversized system injections to summary-only payloads", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const inbox = new AgentInbox(root, () => Date.parse("2026-03-15T03:00:00.000Z"));

    inbox.registerScope("session-oversized");
    inbox.enqueue({
      payload: createPayload({
        context: "x".repeat(300_000),
        annotations: [
          {
            id: "annotation-big",
            selector: "#hero",
            tag: "section",
            rect: { x: 0, y: 0, width: 320, height: 180 },
            attributes: {},
            a11y: {},
            styles: {},
            note: "Huge payload"
          }
        ]
      }),
      source: "popup_all",
      label: "Huge payload"
    });

    const injection = inbox.buildSystemInjection("session-oversized");
    const items = parseSystemItems(injection?.systemBlock ?? "");

    expect(items).toHaveLength(1);
    expect(((items[0]?.payload as { annotations?: unknown[] }).annotations ?? []).length).toBe(0);
    expect(Buffer.byteLength(injection?.systemBlock ?? "", "utf8")).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.stringify(items[0]?.payload)).not.toContain("x".repeat(1000));
  });

  it("bounds summary-only injections when labels and page metadata are oversized", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const inbox = new AgentInbox(root, () => Date.parse("2026-03-15T03:30:00.000Z"));

    inbox.registerScope("session-oversized-summary");
    inbox.enqueue({
      payload: createPayload({
        url: `https://example.com/${"a".repeat(100_000)}`,
        title: "T".repeat(100_000),
        annotations: []
      }),
      source: "popup_all",
      label: "L".repeat(100_000)
    });

    const injection = inbox.buildSystemInjection("session-oversized-summary");
    const items = parseSystemItems(injection?.systemBlock ?? "");
    const payload = items[0]?.payload as { url?: string; title?: string; annotations?: unknown[] };

    expect(Buffer.byteLength(injection?.systemBlock ?? "", "utf8")).toBeLessThanOrEqual(256 * 1024);
    expect(items[0]?.label).toBe("L".repeat(120));
    expect(payload.url).toBe("[redacted]");
    expect(payload.title).toBeUndefined();
    expect(payload.annotations).toEqual([]);
  });

  it("caps injections at 20 items and defers oversized follow-up payloads", () => {
    const firstRoot = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(firstRoot);
    const firstInbox = new AgentInbox(firstRoot, () => Date.parse("2026-03-15T04:00:00.000Z"));

    firstInbox.registerScope("session-limit");
    for (let index = 0; index < 21; index += 1) {
      firstInbox.enqueue({
        payload: createPayload({
          timestamp: `2026-03-15T04:00:${String(index).padStart(2, "0")}.000Z`,
          context: `payload-${index}`
        }),
        source: "popup_all",
        label: `Payload ${index}`
      });
    }

    const firstPrepared = firstInbox.buildSystemInjection("session-limit");
    const firstInjection = parseSystemItems(firstPrepared?.systemBlock ?? "");
    firstInbox.acknowledge(firstPrepared?.receiptIds ?? []);
    const secondPrepared = firstInbox.buildSystemInjection("session-limit");
    const secondInjection = parseSystemItems(secondPrepared?.systemBlock ?? "");
    expect(firstInjection).toHaveLength(20);
    expect(secondInjection).toHaveLength(1);

    let secondNow = Date.parse("2026-03-15T05:00:00.000Z");
    const secondRoot = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(secondRoot);
    const secondInbox = new AgentInbox(secondRoot, () => secondNow);

    secondInbox.registerScope("session-oversized-follow-up");
    secondInbox.enqueue({
      payload: createPayload({ context: "small-payload" }),
      source: "popup_all",
      label: "Small payload"
    });
    secondNow += 1000;
    secondInbox.enqueue({
      payload: createPayload({
        timestamp: "2026-03-15T05:00:01.000Z",
        context: "x".repeat(300_000),
        annotations: [
          {
            id: "annotation-huge",
            selector: "#hero",
            tag: "section",
            rect: { x: 0, y: 0, width: 320, height: 180 },
            attributes: {},
            a11y: {},
            styles: {},
            note: "Huge payload"
          }
        ]
      }),
      source: "popup_all",
      label: "Huge follow-up"
    });

    const constrainedPreparedFirst = secondInbox.buildSystemInjection("session-oversized-follow-up");
    const constrainedFirst = parseSystemItems(constrainedPreparedFirst?.systemBlock ?? "");
    secondInbox.acknowledge(constrainedPreparedFirst?.receiptIds ?? []);
    const constrainedPreparedSecond = secondInbox.buildSystemInjection("session-oversized-follow-up");
    const constrainedSecond = parseSystemItems(constrainedPreparedSecond?.systemBlock ?? "");

    expect(constrainedFirst).toHaveLength(1);
    expect(constrainedFirst[0]?.label).toBe("Small payload");
    expect(constrainedSecond).toHaveLength(1);
    expect(constrainedSecond[0]?.label).toBe("Huge follow-up");
    expect(((constrainedSecond[0]?.payload as { annotations?: unknown[] }).annotations ?? []).length).toBe(0);
  });

  it("uses source-specific default labels when explicit labels are blank", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T06:00:00.000Z"));

    store.registerScope("session-default-labels");

    const cases = [
      ["popup_item", "Popup annotation item"],
      ["popup_all", "Popup annotation payload"],
      ["canvas_item", "Canvas annotation item"],
      ["canvas_all", "Canvas annotation payload"],
      ["annotate_item", "Annotation item"],
      ["annotate_all", "Annotation payload"]
    ] as const;

    for (const [source, expectedLabel] of cases) {
      const entry = store.enqueue({
        payload: createPayload({
          timestamp: `2026-03-15T06:00:00.${expectedLabel.length.toString().padStart(3, "0")}Z`,
          context: expectedLabel
        }),
        source,
        label: "   "
      });
      expect(entry.label).toBe(expectedLabel);
      expect(entry.receipt.label).toBe(expectedLabel);
    }
  });

  it("returns null for empty inbox lookups and falls back to the generic label for unexpected sources", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const inbox = new AgentInbox(root, () => Date.parse("2026-03-15T07:00:00.000Z"));
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T07:00:00.000Z"));

    expect(inbox.latestPayload()).toBeNull();
    expect(inbox.peekScope("missing-scope")).toEqual([]);
    expect(inbox.consumeScope("missing-scope")).toEqual([]);

    store.registerScope("session-fallback");
    const entry = store.enqueue({
      payload: createPayload({ context: "fallback-source" }),
      source: "unexpected_source" as never,
      label: ""
    });

    expect(entry.label).toBe("Annotation payload");
    expect(entry.receipt.label).toBe("Annotation payload");
  });

  it("keeps entries unchanged when consume is called without receipt ids", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T08:00:00.000Z"));

    store.registerScope("session-consume-empty");
    const entry = store.enqueue({
      payload: createPayload({ context: "consume-empty" }),
      source: "popup_all",
      label: "Consume empty"
    });

    store.consume([]);

    expect(store.latestEntry()?.id).toBe(entry.id);
    expect(store.latestEntry()?.deliveryState).toBe("delivered");
  });

  it("falls back to stored_only when the scope file is corrupt", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T09:00:00.000Z"));
    const annotateDir = join(root, ".opendevbrowser", "annotate");
    mkdirSync(annotateDir, { recursive: true });
    writeFileSync(join(annotateDir, "agent-scopes.json"), "{bad-json}");

    expect(store.listActiveScopes()).toEqual([]);

    const receipt = store.enqueue({
      payload: createPayload({ context: "corrupt-scope-file" }),
      source: "popup_all",
      label: "Corrupt scope file"
    }).receipt;

    expect(receipt.deliveryState).toBe("stored_only");
    expect(receipt.reason).toBe("no_active_scope");
  });

  it("skips sparse duplicate entries before accepting a new payload", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T10:00:00.000Z"));

    store.registerScope("session-sparse");
    const existing = store.enqueue({
      payload: createPayload({ context: "existing-payload" }),
      source: "popup_all",
      label: "Existing payload"
    });

    const sparseEntries: Array<typeof existing | undefined> = [];
    sparseEntries[1] = existing;
    (store as unknown as { readEntries: () => Array<typeof existing | undefined> }).readEntries = () => sparseEntries;

    const next = store.enqueue({
      payload: createPayload({ context: "new-payload" }),
      source: "popup_all",
      label: "New payload"
    });

    expect(next.id).not.toBe(existing.id);
    expect(next.label).toBe("New payload");
  });

  it("uses guard rails for blank scopes and allows explicit scope delivery without registrations", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root);

    expect(() => store.registerScope("   ")).toThrow("chatScopeKey is required");
    expect(store.peekScope("   ")).toEqual([]);

    const receipt = store.enqueue({
      payload: createPayload({ context: "explicit-scope-delivery" }),
      source: "annotate_all",
      label: "",
      explicitChatScopeKey: " explicit-session "
    }).receipt;

    expect(receipt.deliveryState).toBe("delivered");
    expect(receipt.chatScopeKey).toBe("explicit-session");
  });

  it("sorts active scopes deterministically and stores empty asset refs when screenshots are absent", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const now = Date.parse("2026-03-15T11:00:00.000Z");
    const store = new AgentInboxStore(root, () => now);
    const annotateDir = join(root, ".opendevbrowser", "annotate");
    mkdirSync(annotateDir, { recursive: true });
    writeFileSync(join(annotateDir, "agent-scopes.json"), JSON.stringify({
      scopes: [
        { chatScopeKey: "beta", updatedAt: new Date(now).toISOString() },
        { chatScopeKey: "alpha", updatedAt: new Date(now).toISOString() }
      ]
    }));

    expect(store.listActiveScopes().map((scope) => scope.chatScopeKey)).toEqual(["alpha", "beta"]);

    const entry = store.enqueue({
      payload: createPayload({
        screenshotMode: "none",
        screenshots: undefined,
        context: "no-screenshots"
      }),
      source: "annotate_all",
      label: "No screenshots",
      explicitChatScopeKey: "scope-without-assets"
    });

    expect(entry.assetRefs).toEqual([]);
  });

  it("handles sparse latest-entry and single-scope edge cases through the defensive nullish fallbacks", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T12:00:00.000Z"));

    (store as unknown as { readEntries: () => Array<undefined> }).readEntries = () => new Array(1);
    expect(store.latestEntry()).toBeNull();

    (store as unknown as { readScopes: () => Array<undefined> }).readScopes = () => new Array(1);
    const receipt = store.enqueue({
      payload: createPayload({ context: "sparse-single-scope" }),
      source: "annotate_all",
      label: "Sparse scope"
    }).receipt;

    expect(receipt.deliveryState).toBe("stored_only");
    expect(receipt.chatScopeKey).toBeNull();
    expect(receipt.reason).toBeUndefined();
  });

  it("treats valid scope JSON without a scopes array as empty and writes empty entry files cleanly", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T13:00:00.000Z"));
    const annotateDir = join(root, ".opendevbrowser", "annotate");
    mkdirSync(annotateDir, { recursive: true });
    writeFileSync(join(annotateDir, "agent-scopes.json"), JSON.stringify({ notScopes: [] }));

    expect(store.listActiveScopes()).toEqual([]);

    (store as unknown as { writeEntries: (entries: unknown[]) => void }).writeEntries([]);
    expect(readFileSync(join(annotateDir, "agent-inbox.jsonl"), "utf8")).toBe("");
  });

  it("covers comparator fallbacks for updatedAt-only and id-less normalized entries", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const now = Date.parse("2026-03-15T14:00:00.000Z");
    const store = new AgentInboxStore(root, () => now);
    const writeEntries = (store as unknown as { writeEntries: (entries: unknown[]) => void }).writeEntries.bind(store);
    const originalParse = Date.parse;

    Date.parse = ((value: string) => {
      if ((value as unknown) === undefined || value === "" || value === "updated-a" || value === "updated-b") {
        return now;
      }
      return originalParse(value);
    }) as typeof Date.parse;

    try {
      writeEntries([
        { updatedAt: "updated-b", id: "b", deliveryState: "stored_only" },
        { updatedAt: "updated-a", id: "a", deliveryState: "stored_only" }
      ]);
      expect(readFileSync(join(root, ".opendevbrowser", "annotate", "agent-inbox.jsonl"), "utf8")).toContain("\"updatedAt\":\"updated-a\"");
      writeEntries([
        { deliveryState: "stored_only" },
        { deliveryState: "stored_only" }
      ]);
    } finally {
      Date.parse = originalParse;
    }

    expect(readFileSync(join(root, ".opendevbrowser", "annotate", "agent-inbox.jsonl"), "utf8")).toContain("\"deliveryState\":\"stored_only\"");
  });

  it("keeps deterministic ordering when comparator timestamps parse to epoch zero", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const now = Date.parse("1970-01-01T00:00:00.000Z");
    const store = new AgentInboxStore(root, () => now);
    const writeEntries = (store as unknown as { writeEntries: (entries: unknown[]) => void }).writeEntries.bind(store);

    writeEntries([
      { createdAt: "1970-01-01T00:00:00.000Z", id: "b", deliveryState: "stored_only" },
      { createdAt: "1970-01-01T00:00:00.000Z", id: "a", deliveryState: "stored_only" }
    ]);

    const content = readFileSync(join(root, ".opendevbrowser", "annotate", "agent-inbox.jsonl"), "utf8");
    expect(content.indexOf("\"id\":\"a\"")).toBeLessThan(content.indexOf("\"id\":\"b\""));
  });

  it("redacts URL userinfo, sensitive query values, canvas identity, and selector bundle fields", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T15:00:00.000Z"));

    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature_part";
    const opaqueSecret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
    const prefixedSecret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

    store.registerScope("session-rich-redaction");
    const entry = store.enqueue({
      payload: createPayload({
        url: `https://user:${prefixedSecret}@example.com/path?plain=person@example.com&token=public-value`,
        title: `Title ${jwt}`,
        context: `Context ${opaqueSecret}`,
        annotations: [
          {
            id: "annotation-rich",
            selector: `#hero-${prefixedSecret}`,
            idAttr: jwt,
            classes: [prefixedSecret, opaqueSecret],
            tag: "section",
            rect: { x: 0, y: 0, width: 320, height: 180 },
            attributes: { "data-secret": prefixedSecret },
            a11y: {
              role: `region ${prefixedSecret}`,
              label: "person@example.com",
              labelledBy: jwt,
              describedBy: opaqueSecret,
              hidden: false
            },
            styles: { color: "red" },
            screenshotId: "shot-1",
            text: `Visible ${jwt}`,
            note: `Note ${opaqueSecret}`,
            identity: {
              source: "canvas",
              priority: 100,
              stableId: prefixedSecret,
              label: `Canvas ${jwt}`,
              canvas: {
                documentId: prefixedSecret,
                pageId: jwt,
                nodeId: opaqueSecret,
                regionId: prefixedSecret,
                bindingId: jwt,
                componentName: opaqueSecret
              }
            },
            selectorBundle: {
              primary: undefined,
              transport: "extension",
              candidates: [
                {
                  family: "css",
                  rank: 1,
                  confidence: "high",
                  scope: "document",
                  transport: "extension",
                  availability: "available",
                  value: prefixedSecret
                },
                {
                  family: "xpath",
                  rank: 2,
                  confidence: "low",
                  scope: "document",
                  transport: "extension",
                  availability: "unavailable",
                  unavailableReason: "missing_xpath_facts"
                }
              ],
              recoveryHints: [`Retry ${jwt}`]
            }
          }
        ]
      }),
      source: "annotate_all",
      label: "Rich redaction"
    });

    const serialized = JSON.stringify(entry.payloadSansScreenshots);
    expect(serialized).not.toContain(prefixedSecret);
    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain(opaqueSecret);
    expect(serialized).not.toContain("person@example.com");
    expect(entry.payloadSansScreenshots.url).toContain("[redacted]");
    expect(entry.payloadSansScreenshots.compact?.items[0]?.selectorBundle.primary).toBe("[redacted]");
    expect(entry.payloadSansScreenshots.compact?.items[0]?.identity.canvas?.documentId).toBe("[redacted]");
  });

  it("prunes compact overflow items without dropping all useful compact context", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-agent-inbox-"));
    tempRoots.push(root);
    const store = new AgentInboxStore(root, () => Date.parse("2026-03-15T16:00:00.000Z"));
    const annotationCount = 90;
    const longText = "detail ".repeat(120);

    store.registerScope("session-compact-overflow");
    const annotations = Array.from({ length: annotationCount }, (_value, index) => ({
      id: `annotation-${index}`,
      selector: `#item-${index}`,
      tag: "section",
      rect: { x: index, y: index, width: 320, height: 180 },
      attributes: { "data-index": String(index) },
      a11y: { label: `Item ${index}` },
      styles: { color: "red" },
      screenshotId: "shot-1",
      text: `${longText}${index}`,
      note: `${longText}${index}`
    }));

    const entry = store.enqueue({
      payload: createPayload({
        context: "context ".repeat(1_000),
        annotations
      }),
      source: "popup_all",
      label: "Compact overflow"
    });

    const compact = entry.payloadSansScreenshots.compact;
    expect(compact).toBeDefined();
    expect(compact?.items.length).toBeGreaterThan(0);
    expect(compact?.items.length).toBeLessThan(annotationCount);
    expect(compact?.redaction.removedFields).toContain("annotations.overflow_items");
    expect(compact?.redaction.compactByteLength).toBeLessThanOrEqual(compact?.byteBudget ?? 0);
  });

});
